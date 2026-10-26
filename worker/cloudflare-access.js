// Cloudflare Access gate for the Cloudflare-hosted Worker.
//
// The wrapped Worker and the server modules take the owner from the request
// header `oai-authenticated-user-id`. OpenAI's host sets that header itself.
// On Cloudflare any client could send it, so this gate never trusts it:
// it deletes every client-supplied `oai-*` header, verifies the Cloudflare
// Access token, checks the email against OWNER_EMAILS, and only then sets the
// owner from the token's `sub` claim. Every failure answers 403 for every path
// and never reaches the wrapped Worker. No response may be framed by any site.

export const ACCESS_IDENTITY_MODE = 'cloudflare-access';
export const ACCESS_OWNER_PREFIX = 'cf-access:';
export const ACCESS_LIMITS = Object.freeze({
  tokenChars: 16_384, jwksChars: 131_072, jwksKeys: 32, claimChars: 512,
  clockSkewSeconds: 60, minModulusBytes: 256,
});
const DEFAULT_JWKS_TTL_MS = 5 * 60_000;
const DEFAULT_UNKNOWN_KID_REFETCH_MS = 30_000;
const DEFAULT_JWKS_TIMEOUT_MS = 5_000;

const DENIED_BODY = 'Access denied. Sign in through Cloudflare Access to open this site.\n';
const FRAME_ANCESTORS = "frame-ancestors 'none'";
const hostname = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const base64url = /^[A-Za-z0-9_-]+$/;
const controlChars = /[\u0000-\u001f\u007f]/;
// Access subs are UUIDs. Only a short plain ID becomes the owner, so the owner
// header carries it unchanged (no space for a header to trim, no character to
// re-encode) and stays far below the journal API's 512-character owner limit.
const accessSub = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const RSA = Object.freeze({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' });

class Denied extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const deny = reason => { throw new Denied(reason); };
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedString = value => typeof value === 'string' && value.length > 0
  && value.length <= ACCESS_LIMITS.claimChars && !controlChars.test(value);

function decodeSegment(segment) {
  if (!base64url.test(segment) || segment.length % 4 === 1) deny('token_malformed');
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((segment.length + 3) % 4);
  let binary;
  try { binary = atob(padded); } catch { deny('token_malformed'); }
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function decodeJson(segment) {
  let value;
  try { value = JSON.parse(decoder.decode(decodeSegment(segment))); } catch (error) {
    if (error instanceof Denied) throw error;
    deny('token_malformed');
  }
  if (!plainObject(value)) deny('token_malformed');
  return value;
}

// Configuration is read on every request. Missing, empty or malformed values
// fail closed: the gate answers 403 and contacts nothing.
export function readAccessConfig(env) {
  const source = env !== null && typeof env === 'object' ? env : {};
  if (source.IDENTITY_MODE !== ACCESS_IDENTITY_MODE) return null;
  const teamDomain = typeof source.ACCESS_TEAM_DOMAIN === 'string' ? source.ACCESS_TEAM_DOMAIN.trim().toLowerCase() : '';
  const audience = typeof source.ACCESS_AUD === 'string' ? source.ACCESS_AUD.trim() : '';
  if (!hostname.test(teamDomain) || !audience || audience.length > ACCESS_LIMITS.claimChars || controlChars.test(audience)) return null;
  // OWNER_EMAILS is the second lock and is always required. Wrangler checks
  // only that the secret exists, so an unset, empty or blank list must never
  // switch the check off: a list that names nobody admits nobody.
  if (typeof source.OWNER_EMAILS !== 'string') return null;
  const owners = new Set(source.OWNER_EMAILS.split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
  if (!owners.size) return null;
  return Object.freeze({ teamDomain, issuer: `https://${teamDomain}`, audience,
    certsUrl: `https://${teamDomain}/cdn-cgi/access/certs`, owners });
}

async function importJwks(text) {
  if (typeof text !== 'string' || text.length > ACCESS_LIMITS.jwksChars) deny('jwks_unavailable');
  let body;
  try { body = JSON.parse(text); } catch { deny('jwks_unavailable'); }
  if (!plainObject(body) || !Array.isArray(body.keys) || body.keys.length > ACCESS_LIMITS.jwksKeys) deny('jwks_unavailable');
  const keys = new Map();
  for (const jwk of body.keys) {
    if (!plainObject(jwk) || !boundedString(jwk.kid) || keys.has(jwk.kid) || jwk.kty !== 'RSA'
      || (jwk.alg !== undefined && jwk.alg !== 'RS256') || (jwk.use !== undefined && jwk.use !== 'sig')
      || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') continue;
    try {
      if (decodeSegment(jwk.n).length < ACCESS_LIMITS.minModulusBytes) continue;
      keys.set(jwk.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, RSA, false, ['verify']));
    } catch { /* An unusable key is skipped; it can never verify a token. */ }
  }
  if (!keys.size) deny('jwks_unavailable');
  return keys;
}

export function withCloudflareAccess(app, {
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  jwksTtlMs = DEFAULT_JWKS_TTL_MS,
  unknownKidRefetchMs = DEFAULT_UNKNOWN_KID_REFETCH_MS,
  jwksTimeoutMs = DEFAULT_JWKS_TIMEOUT_MS,
  log = reason => console.warn(`cloudflare-access: request denied (${reason})`),
} = {}) {
  if (!app || typeof app.fetch !== 'function') throw TypeError('withCloudflareAccess needs a Worker with a fetch handler');
  // One verified key set per isolate, and the latest key download. Requests that
  // need keys while a download runs share it, so a burst of requests starts one
  // download, not one each. The download settles to plain CryptoKeys; no response
  // or stream crosses requests. It runs in the context of the request that began
  // it, and the runtime drops it if that request is cancelled. So every request
  // waits on its own timer and fails closed when the timer ends first.
  let cache = null, download = null;

  async function refreshKeys(config) {
    let response;
    try {
      const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(jwksTimeoutMs) : undefined;
      response = await fetchImpl(config.certsUrl, { method: 'GET', redirect: 'manual', headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) });
    } catch { deny('jwks_unavailable'); }
    if (!response || response.status !== 200) deny('jwks_unavailable');
    let text;
    try { text = await response.text(); } catch { deny('jwks_unavailable'); }
    const keys = await importJwks(text);
    cache = { teamDomain: config.teamDomain, keys, fetchedAt: now() };
    return cache;
  }

  // A download stops counting as under way once it settles or has run for the
  // full time limit. A newer request then starts a fresh one.
  const running = config => download?.teamDomain === config.teamDomain && !download.settled
    && now() - download.startedAt < jwksTimeoutMs;

  function loadKeys(config) {
    if (!running(config)) {
      const current = { teamDomain: config.teamDomain, startedAt: now(), settled: false };
      current.promise = refreshKeys(config).finally(() => { current.settled = true; });
      download = current;
    }
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Denied('jwks_unavailable')), jwksTimeoutMs); });
    return Promise.race([download.promise, late]).finally(() => clearTimeout(timer));
  }

  async function keyFor(config, kid) {
    let entry = cache?.teamDomain === config.teamDomain && now() - cache.fetchedAt < jwksTtlMs ? cache : null;
    let fetched = false;
    if (!entry) {
      // An expired or missing set is never reused. A failed download fails closed.
      cache = null;
      entry = await loadKeys(config); fetched = true;
    }
    if (entry.keys.has(kid)) return entry.keys.get(kid);
    // An unknown kid may mean the team rotated its key. Download again at most
    // once per request. Join a download already under way. Otherwise wait out the
    // cool-down after the last download began, whether it worked or not, so stray
    // kids cannot flood the endpoint, one at a time or all at once.
    const lastStart = Math.max(entry.fetchedAt, download?.teamDomain === config.teamDomain ? download.startedAt : -Infinity);
    if (fetched || (!running(config) && now() - lastStart < unknownKidRefetchMs)) deny('kid_unknown');
    entry = await loadKeys(config);
    return entry.keys.get(kid) ?? deny('kid_unknown');
  }

  async function verify(request, config) {
    const token = (request.headers.get('cf-access-jwt-assertion') || '').trim();
    if (!token) deny('token_missing');
    if (token.length > ACCESS_LIMITS.tokenChars) deny('token_malformed');
    const parts = token.split('.');
    if (parts.length !== 3) deny('token_malformed');
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJson(encodedHeader);
    // Only RS256 is accepted. This rejects alg "none", every HS* variant and
    // any other algorithm before a key is chosen.
    if (header.alg !== 'RS256') deny('alg_rejected');
    if (!boundedString(header.kid)) deny('kid_missing');
    if (header.crit !== undefined) deny('token_malformed');
    const payload = decodeJson(encodedPayload);
    const signature = decodeSegment(encodedSignature);
    const key = await keyFor(config, header.kid);
    let valid = false;
    try { valid = await crypto.subtle.verify(RSA, key, signature, encoder.encode(`${encodedHeader}.${encodedPayload}`)); }
    catch { valid = false; }
    if (!valid) deny('signature_invalid');

    if (payload.iss !== config.issuer) deny('iss_mismatch');
    const audiences = typeof payload.aud === 'string' ? [payload.aud] : payload.aud;
    if (!Array.isArray(audiences) || !audiences.includes(config.audience)) deny('aud_mismatch');
    const seconds = now() / 1000;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= seconds) deny('expired');
    for (const claim of ['nbf', 'iat']) {
      if (payload[claim] === undefined) continue;
      if (typeof payload[claim] !== 'number' || !Number.isFinite(payload[claim])
        || payload[claim] > seconds + ACCESS_LIMITS.clockSkewSeconds) deny('not_yet_valid');
    }
    if (!boundedString(payload.email) || !payload.email.includes('@')) deny('email_missing');
    if (typeof payload.sub !== 'string' || !payload.sub) deny('sub_missing');
    if (!accessSub.test(payload.sub)) deny('sub_invalid');
    if (!config.owners.has(payload.email.trim().toLowerCase())) deny('owner_not_allowed');
    return { sub: payload.sub, email: payload.email };
  }

  return Object.freeze({
    async fetch(request, env, ctx) {
      let identity;
      try {
        const config = readAccessConfig(env);
        if (!config) deny('config_missing');
        identity = await verify(request, config);
      } catch (error) {
        try { log(error instanceof Denied ? error.reason : 'verification_error'); } catch { /* Logging never opens the gate. */ }
        return forbidden(request);
      }
      // Client-supplied platform headers never reach the wrapped Worker.
      const headers = new Headers(request.headers);
      for (const name of [...headers.keys()]) if (name.toLowerCase().startsWith('oai-')) headers.delete(name);
      headers.set('oai-authenticated-user-id', ACCESS_OWNER_PREFIX + identity.sub);
      return guardFraming(await app.fetch(new Request(request, { headers }), env, ctx));
    },
  });
}

// The Access cookie rides along when another site frames this one, so the
// signed-in app must never render inside a frame (clickjacking). The copy keeps
// status, body and headers. An inner policy stays and the framing rule is added
// as a second policy, so both apply.
function guardFraming(response) {
  const guarded = new Response(response.body, response);
  guarded.headers.append('content-security-policy', FRAME_ANCESTORS);
  guarded.headers.set('x-frame-options', 'DENY');
  return guarded;
}

export function forbidden(request) {
  return new Response(request?.method === 'HEAD' ? null : DENIED_BODY, { status: 403, headers: {
    'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': FRAME_ANCESTORS, 'x-frame-options': 'DENY',
  } });
}
