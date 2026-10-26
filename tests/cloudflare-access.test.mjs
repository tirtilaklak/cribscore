// Cloudflare Access gate for the Cloudflare-hosted Worker (worker/cloudflare.js).
// Keys are generated here with WebCrypto and the team's JWKS endpoint is a local
// stub. No request leaves the process. Addresses use the reserved .test domain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withCloudflareAccess, readAccessConfig, ACCESS_LIMITS } from '../worker/cloudflare-access.js';
import cloudflareWorker from '../worker/cloudflare.js';
import originalWorker from '../worker/index.js';
import { createJournal } from '../dist/lib/journal.js';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';

const TEAM = 'cribscore-test.cloudflareaccess.com';
const ISSUER = `https://${TEAM}`;
const CERTS = `https://${TEAM}/cdn-cgi/access/certs`;
const AUD = '4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2';
const SUB = '7c3a0e8e-5d1f-4a43-9a52-0d5a7f1b2c01';
const EMAIL = 'owner@example.test';
const origin = 'https://cribscore.co';
const NOW = Date.parse('2026-10-25T12:00:00Z');
const DENIED = 'Access denied. Sign in through Cloudflare Access to open this site.\n';
const encoder = new TextEncoder();
const b64url = bytes => Buffer.from(bytes).toString('base64url');
const json64 = value => b64url(encoder.encode(JSON.stringify(value)));

async function rsaKey(kid, modulusLength = 2048) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  return { kid, privateKey: pair.privateKey, pem: `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`,
    jwk: { kty: 'RSA', alg: 'RS256', use: 'sig', kid, n: jwk.n, e: jwk.e } };
}
const keyA = await rsaKey('kid-a');
const keyB = await rsaKey('kid-b');
const impostor = await rsaKey('kid-a'); // Same kid as keyA, different private key.
const weak = await rsaKey('kid-weak', 1024);

const claims = (over = {}, at = NOW) => ({ iss: ISSUER, aud: [AUD], sub: SUB, email: EMAIL, type: 'app',
  iat: Math.floor(at / 1000) - 30, nbf: Math.floor(at / 1000) - 30, exp: Math.floor(at / 1000) + 600, country: 'US', ...over });
async function sign(payload, { key = keyA, header = {} } = {}) {
  const head = json64({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const body = json64(payload);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, encoder.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
}
async function hmacToken(alg, secret, payload) {
  const head = json64({ alg, kid: keyA.kid, typ: 'JWT' }), body = json64(payload);
  const hash = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' }[alg];
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash }, false, ['sign']);
  return `${head}.${body}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${head}.${body}`))))}`;
}
const accessEnv = (over = {}) => ({ IDENTITY_MODE: 'cloudflare-access', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAILS: EMAIL, ...over });
const request = (path = '/api/journal', { method = 'GET', token, headers = {}, body } = {}) => new Request(origin + path, {
  method, headers: { ...(token ? { 'cf-access-jwt-assertion': token } : {}), ...headers }, ...(body === undefined ? {} : { body }),
});

// A local stand-in for https://<team>/cdn-cgi/access/certs.
function jwksEndpoint({ keys = [keyA.jwk] } = {}) {
  const state = { keys, mode: 'ok', calls: [], hold: null };
  const fetch = async (url, init = {}) => {
    state.calls.push({ url: String(url), init });
    // While `hold` is set the endpoint answers only once it settles, so a burst of requests overlaps the download.
    if (state.hold) await state.hold;
    if (state.mode === 'throw') throw new TypeError('network unavailable');
    // Even a well-formed key set is refused unless it comes with a plain 200.
    const body = JSON.stringify({ keys: state.keys });
    if (state.mode === 'status') return new Response(body, { status: 503, headers: { 'content-type': 'application/json' } });
    if (state.mode === 'redirect') return new Response(body, { status: 302, headers: { location: 'https://attacker.example.test/certs', 'content-type': 'application/json' } });
    if (state.mode === 'json') return new Response('{"keys":[', { status: 200 });
    return Response.json({ keys: state.keys, public_cert: {}, public_certs: [] });
  };
  return { state, fetch };
}
// Gate around a recording stand-in Worker, with a controllable clock.
function harness({ jwks = jwksEndpoint(), app, options = {} } = {}) {
  const clock = { now: NOW }, seen = [], reasons = [];
  const inner = app ?? { async fetch(forwarded, env) { seen.push({ request: forwarded, env }); return new Response('inner reached', { status: 200 }); } };
  const gate = withCloudflareAccess(inner, { fetch: jwks.fetch, now: () => clock.now, log: reason => reasons.push(reason), ...options });
  return { gate, jwks, clock, seen, reasons };
}
// Holds the stand-in endpoint until the returned function is called.
function holdEndpoint(jwks) {
  let release;
  jwks.state.hold = new Promise(resolve => { release = resolve; });
  return () => { jwks.state.hold = null; release(); };
}
// Sends every request before the endpoint answers, then waits for all responses.
async function burst(gate, jwks, tokens, path = '/') {
  const release = holdEndpoint(jwks);
  const pending = tokens.map(token => gate.fetch(request(path, { token }), accessEnv()));
  release();
  return Promise.all(pending);
}
// No response may be shown inside another site's frame (clickjacking).
function assertFrameGuard(response, label) {
  assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'", label);
  assert.equal(response.headers.get('x-frame-options'), 'DENY', label);
}
async function assertDenied(response, method = 'GET') {
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assertFrameGuard(response, 'denied');
  assert.equal(await response.text(), method === 'HEAD' ? '' : DENIED);
}
const oaiHeaders = forwarded => [...forwarded.headers.entries()].filter(([name]) => name.toLowerCase().startsWith('oai-'));

test('a valid Access token reaches the journal API and the owner comes from the token', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const network = t.mock.method(globalThis, 'fetch', () => { throw Error('Only the stubbed JWKS endpoint may be contacted'); });
  const { gate, jwks, reasons } = harness({ app: originalWorker });
  const token = await sign(claims());
  const env = { ...accessEnv(), DB: db };
  const empty = await gate.fetch(request('/api/journal', { token }), env);
  assert.equal(empty.status, 200); assert.deepEqual(await empty.json(), { ok: true, journal: null, revision: 0 });
  const journal = createJournal({ journalId: 'cloudflare-access-journal', at: new Date(Date.now() - 10_000).toISOString() });
  const saved = await gate.fetch(request('/api/journal', { method: 'POST', token, headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 0, journal }) }), env);
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.deepEqual(db.sqlite.prepare('SELECT owner_id FROM journal_heads').all().map(row => row.owner_id), [`cf-access:${SUB}`]);
  const readBack = await (await gate.fetch(request('/api/journal', { token }), env)).json();
  assert.equal(readBack.journal.journalId, 'cloudflare-access-journal');
  const setup = await gate.fetch(request('/api/market-data/setup', { token }), accessEnv());
  assert.equal(setup.status, 200); assert.equal((await setup.json()).ok, true);
  assert.deepEqual(jwks.state.calls.map(call => call.url), [CERTS], 'One JWKS fetch serves the cached key set');
  assert.equal(jwks.state.calls[0].init.redirect, 'manual');
  assert.deepEqual(reasons, []); assert.equal(network.mock.callCount(), 0);
});

test('a forged oai header without a token gets 403 on every route of the Cloudflare entry', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const network = t.mock.method(globalThis, 'fetch', () => { throw Error('A request without a token must not fetch keys'); });
  const warn = t.mock.method(console, 'warn', () => {});
  const forged = { 'oai-authenticated-user-id': 'victim-owner', 'OAI-Sites-Authorization': 'Bearer forged', origin, 'content-type': 'application/json' };
  // The original host's entry trusts this header; that is exactly what the gate prevents.
  assert.equal((await originalWorker.fetch(request('/api/market-data/setup', { headers: forged }), {})).status, 200);
  for (const [method, path, body] of [['GET', '/api/journal'], ['POST', '/api/journal', '{"expectedRevision":0}'], ['POST', '/api/journal/observe', '{}'],
    ['GET', '/api/market-data/setup'], ['POST', '/mcp', '{}'], ['GET', '/'], ['GET', '/app.js'], ['GET', '/not-found']]) {
    await assertDenied(await cloudflareWorker.fetch(request(path, { method, headers: forged, body }), { ...accessEnv(), DB: db }), method);
  }
  assert.equal(db.calls.length, 0, 'The database is never touched');
  assert.equal(network.mock.callCount(), 0);
  assert.ok(warn.mock.calls.every(call => /request denied \(token_missing\)/.test(call.arguments[0])));
  // Same check against the recording stand-in: nothing is forwarded.
  const { gate, seen, reasons, jwks } = harness();
  for (const name of ['oai-authenticated-user-id', 'OAI-Authenticated-User-Id']) {
    await assertDenied(await gate.fetch(request('/api/journal', { headers: { [name]: 'victim-owner' } }), accessEnv()));
  }
  await assertDenied(await gate.fetch(request('/api/journal', { token: '', headers: { 'oai-authenticated-user-id': 'victim-owner' } }), accessEnv()));
  assert.equal(seen.length, 0); assert.deepEqual(reasons, ['token_missing', 'token_missing', 'token_missing']); assert.equal(jwks.state.calls.length, 0);
});

test('a forged oai header with a valid token is replaced by the token identity', async t => {
  const { gate, seen } = harness();
  const token = await sign(claims());
  const response = await gate.fetch(request('/api/journal', { method: 'POST', token, body: '{"expectedRevision":0}', headers: {
    'oai-authenticated-user-id': 'victim-owner', 'OAI-Sites-Authorization': 'Bearer forged', 'Oai-Extra': 'x', 'x-kept': 'kept',
    origin, 'content-type': 'application/json',
  } }), accessEnv());
  assert.equal(response.status, 200);
  assert.equal(seen.length, 1);
  const forwarded = seen[0].request;
  assert.deepEqual(oaiHeaders(forwarded), [['oai-authenticated-user-id', `cf-access:${SUB}`]]);
  assert.equal(forwarded.headers.get('x-kept'), 'kept');
  assert.equal(forwarded.method, 'POST'); assert.equal(forwarded.url, origin + '/api/journal');
  assert.equal(await forwarded.text(), '{"expectedRevision":0}', 'The body is forwarded unchanged');

  // End to end: the forged owner never receives the write.
  const db = new SQLiteD1(); t.after(() => db.close());
  const { gate: real } = harness({ app: originalWorker });
  const journal = createJournal({ journalId: 'forged-header-journal', at: new Date(Date.now() - 10_000).toISOString() });
  const saved = await real.fetch(request('/api/journal', { method: 'POST', token, body: JSON.stringify({ expectedRevision: 0, journal }),
    headers: { 'oai-authenticated-user-id': 'victim-owner', origin, 'content-type': 'application/json' } }), { ...accessEnv(), DB: db });
  assert.equal(saved.status, 200);
  assert.deepEqual(db.sqlite.prepare('SELECT owner_id FROM journal_heads').all().map(row => row.owner_id), [`cf-access:${SUB}`]);
  // Even when the allowlist admits a second address, that user cannot claim the owner by header.
  const otherToken = await sign(claims({ sub: 'second-access-user', email: 'second@example.test' }));
  const other = await (await real.fetch(request('/api/journal', { token: otherToken, headers: { 'oai-authenticated-user-id': `cf-access:${SUB}` } }),
    { ...accessEnv({ OWNER_EMAILS: `${EMAIL},second@example.test` }), DB: db })).json();
  assert.equal(other.journal, null, 'Another Access user cannot claim the owner by header');
});

test('claims are checked: audience, issuer, expiry, not-before, issued-at, email and subject', async () => {
  const seconds = NOW / 1000;
  const cases = [
    ['aud_mismatch', claims({ aud: ['another-application-aud'] })],
    ['aud_mismatch', claims({ aud: [] })],
    ['aud_mismatch', claims({ aud: undefined })],
    ['iss_mismatch', claims({ iss: 'https://attacker.cloudflareaccess.com' })],
    ['iss_mismatch', claims({ iss: `${ISSUER}/` })],
    ['iss_mismatch', claims({ iss: TEAM })],
    ['iss_mismatch', claims({ iss: undefined })],
    ['expired', claims({ exp: seconds - 1 })],
    ['expired', claims({ exp: seconds })],
    ['expired', claims({ exp: undefined })],
    ['expired', claims({ exp: String(seconds + 600) })],
    ['not_yet_valid', claims({ nbf: seconds + ACCESS_LIMITS.clockSkewSeconds + 1 })],
    ['not_yet_valid', claims({ iat: seconds + 3600 })],
    ['not_yet_valid', claims({ nbf: 'soon' })],
    ['email_missing', claims({ email: undefined })],
    ['email_missing', claims({ email: '' })],
    ['email_missing', claims({ email: undefined, common_name: 'service-token.access' })],
    ['sub_missing', claims({ sub: undefined })],
    ['sub_missing', claims({ sub: '' })],
  ];
  for (const [reason, payload] of cases) {
    const { gate, seen, reasons } = harness();
    await assertDenied(await gate.fetch(request('/api/journal', { token: await sign(payload) }), accessEnv()));
    assert.equal(seen.length, 0); assert.deepEqual(reasons, [reason], JSON.stringify(payload));
  }
  // Within the 60 s skew, a slightly early nbf/iat is accepted; a string aud equal to ACCESS_AUD is accepted.
  for (const payload of [claims({ nbf: seconds + 59, iat: seconds + 59 }), claims({ aud: AUD }), claims({ aud: ['other', AUD] }), claims({ nbf: undefined, iat: undefined })]) {
    const { gate, seen } = harness();
    assert.equal((await gate.fetch(request('/', { token: await sign(payload) }), accessEnv())).status, 200, JSON.stringify(payload));
    assert.equal(seen.length, 1);
  }
});

test('the token sub becomes the owner only as a short plain ID that the owner header carries unchanged', async t => {
  // Each of these is signed by the team key for an allowed email, so only the sub decides.
  for (const [label, sub] of [
    ['leading space', ` ${SUB}`], ['trailing space', `${SUB} `], ['surrounding whitespace', `\t${SUB}\n`],
    ['129 characters', 'a'.repeat(129)], ['over the 512-character owner limit', 'a'.repeat(600)],
    ['control character', `${SUB}\u0007`], ['NUL', `${SUB}\u0000`], ['DEL', `${SUB}\u007f`],
    ['non-ASCII letter', `${SUB}é`], ['zero-width space', `${SUB}​`], ['fullwidth digit', `１${SUB}`],
    ['inner space', '7c3a0e8e 5d1f'], ['comma', `${SUB},other`], ['slash', `${SUB}/x`], ['leading hyphen', `-${SUB}`],
  ]) {
    const { gate, seen, reasons } = harness();
    await assertDenied(await gate.fetch(request('/api/journal', { token: await sign(claims({ sub })) }), accessEnv()));
    assert.equal(seen.length, 0, label); assert.deepEqual(reasons, ['sub_invalid'], label);
  }
  for (const sub of [42, ['a'], null]) {
    const { gate, reasons } = harness();
    await assertDenied(await gate.fetch(request('/', { token: await sign(claims({ sub })) }), accessEnv()));
    assert.deepEqual(reasons, ['sub_missing'], JSON.stringify(sub));
  }
  // A UUID passes, in either case, as do the longest allowed ID and other plain IDs. Each reaches the inner Worker exactly.
  for (const sub of [SUB, SUB.toUpperCase(), 'a'.repeat(128), 'x', 'user_1.test:id@team-2']) {
    const { gate, seen, reasons } = harness();
    assert.equal((await gate.fetch(request('/api/journal', { token: await sign(claims({ sub })) }), accessEnv())).status, 200, sub);
    assert.deepEqual(oaiHeaders(seen[0].request), [['oai-authenticated-user-id', `cf-access:${sub}`]]); assert.deepEqual(reasons, []);
  }
  // End to end: the longest allowed ID is stored as the journal owner unchanged.
  const db = new SQLiteD1(); t.after(() => db.close());
  const { gate } = harness({ app: originalWorker });
  const longest = 'b'.repeat(128);
  const journal = createJournal({ journalId: 'longest-sub-journal', at: new Date(Date.now() - 10_000).toISOString() });
  const saved = await gate.fetch(request('/api/journal', { method: 'POST', token: await sign(claims({ sub: longest })),
    body: JSON.stringify({ expectedRevision: 0, journal }), headers: { origin, 'content-type': 'application/json' } }), { ...accessEnv(), DB: db });
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.deepEqual(db.sqlite.prepare('SELECT owner_id FROM journal_heads').all().map(row => row.owner_id), [`cf-access:${longest}`]);
});

test('alg none, HS256 with the public key as secret, other algorithms and a missing kid are rejected before any key fetch', async () => {
  const payload = claims();
  const none = `${json64({ alg: 'none', kid: keyA.kid, typ: 'JWT' })}.${json64(payload)}.`;
  const tokens = [
    ['alg_rejected', none],
    ['alg_rejected', `${json64({ alg: 'none', kid: keyA.kid })}.${json64(payload)}.${b64url(encoder.encode('x'))}`],
    ['alg_rejected', `${json64({ alg: 'NONE', kid: keyA.kid })}.${json64(payload)}.`],
    ['alg_rejected', await hmacToken('HS256', keyA.pem, payload)],
    ['alg_rejected', await hmacToken('HS256', JSON.stringify(keyA.jwk), payload)],
    ['alg_rejected', await hmacToken('HS384', keyA.pem, payload)],
    ['alg_rejected', await hmacToken('HS512', keyA.pem, payload)],
    ['alg_rejected', await sign(payload, { header: { alg: 'PS256' } })],
    ['alg_rejected', await sign(payload, { header: { alg: 'ES256' } })],
    ['alg_rejected', await sign(payload, { header: { alg: undefined } })],
    ['kid_missing', await sign(payload, { header: { kid: undefined } })],
    ['kid_missing', await sign(payload, { header: { kid: '' } })],
    ['kid_missing', await sign(payload, { header: { kid: 7 } })],
  ];
  for (const [reason, token] of tokens) {
    const { gate, seen, reasons, jwks } = harness();
    await assertDenied(await gate.fetch(request('/api/journal', { token }), accessEnv()));
    assert.equal(seen.length, 0); assert.deepEqual(reasons, [reason]); assert.equal(jwks.state.calls.length, 0);
  }
});

test('malformed tokens and critical header extensions are rejected', async () => {
  const good = await sign(claims());
  const [head, body, signature] = good.split('.');
  for (const token of [`${head}.${body}`, `${good}.extra`, `${head}.${body}.${signature}*`, `${head}.${body}.`, `!!.${body}.${signature}`,
    `${b64url(encoder.encode('not json'))}.${body}.${signature}`, `${json64(['RS256'])}.${body}.${signature}`,
    `${head}.${b64url(encoder.encode('[1]'))}.${signature}`, `${head}.${body}.${signature}${'A'.repeat(ACCESS_LIMITS.tokenChars)}`]) {
    const { gate, seen, reasons } = harness();
    await assertDenied(await gate.fetch(request('/', { token }), accessEnv()));
    assert.equal(seen.length, 0); assert.deepEqual(reasons, ['token_malformed'], token.slice(0, 60));
  }
  const { gate, reasons } = harness();
  await assertDenied(await gate.fetch(request('/', { token: await sign(claims(), { header: { crit: ['exp'] } }) }), accessEnv()));
  assert.deepEqual(reasons, ['token_malformed']);
});

test('a tampered signature, a swapped payload or a key that is not the team key fails verification', async () => {
  const good = await sign(claims());
  const [head, body, signature] = good.split('.');
  const flipped = signature.slice(0, -2) + (signature.at(-2) === 'A' ? 'B' : 'A') + signature.at(-1);
  const swapped = `${head}.${json64(claims({ sub: 'someone-else', email: 'someone@example.test' }))}.${signature}`;
  for (const token of [`${head}.${body}.${flipped}`, swapped, await sign(claims(), { key: impostor }), `${head}.${body}.${signature.slice(0, 40)}`]) {
    const { gate, seen, reasons } = harness();
    await assertDenied(await gate.fetch(request('/api/journal', { token }), accessEnv()));
    assert.equal(seen.length, 0); assert.deepEqual(reasons, ['signature_invalid']);
  }
});

test('an unknown kid refetches the JWKS at most once, then finds a rotated key', async () => {
  // Cold cache: the first fetch already lacks the kid, so there is no second fetch.
  const cold = harness();
  await assertDenied(await cold.gate.fetch(request('/', { token: await sign(claims(), { key: keyB }) }), accessEnv()));
  assert.equal(cold.jwks.state.calls.length, 1); assert.deepEqual(cold.reasons, ['kid_unknown']);

  const { gate, jwks, clock, reasons, seen } = harness();
  assert.equal((await gate.fetch(request('/', { token: await sign(claims()) }), accessEnv())).status, 200);
  assert.equal(jwks.state.calls.length, 1);
  // Right after a fetch, an unknown kid is refused without another fetch.
  await assertDenied(await gate.fetch(request('/', { token: await sign(claims(), { key: keyB }) }), accessEnv()));
  assert.equal(jwks.state.calls.length, 1);
  // After the cool-down, one refetch; the kid is still unknown, so 403.
  clock.now += 31_000;
  await assertDenied(await gate.fetch(request('/', { token: await sign(claims({}, clock.now), { key: keyB }) }), accessEnv()));
  assert.equal(jwks.state.calls.length, 2);
  // The team rotates to keyB. After the cool-down, one refetch picks it up.
  jwks.state.keys = [keyA.jwk, keyB.jwk];
  clock.now += 31_000;
  assert.equal((await gate.fetch(request('/', { token: await sign(claims({}, clock.now), { key: keyB }) }), accessEnv())).status, 200);
  assert.equal(jwks.state.calls.length, 3);
  assert.equal((await gate.fetch(request('/', { token: await sign(claims({}, clock.now), { key: keyB }) }), accessEnv())).status, 200);
  assert.equal(jwks.state.calls.length, 3, 'Known kids use the cache');
  assert.deepEqual(reasons, ['kid_unknown', 'kid_unknown']); assert.equal(seen.length, 3);
});

test('a burst of requests shares one key download, even from forged tokens with unknown kids', async () => {
  const { gate, jwks, clock, seen, reasons } = harness();
  const downloads = () => jwks.state.calls.length;
  // Cold cache: twenty valid requests at once start one download.
  for (const response of await burst(gate, jwks, Array(20).fill(await sign(claims())))) assert.equal(response.status, 200);
  assert.equal(downloads(), 1); assert.equal(seen.length, 20);

  // Past the cool-down, fifty forged tokens arrive at once: RS256, a kid the team never issued, a signature that is no signature.
  // No private key is needed to send them. Together they start one download, and every one is refused.
  clock.now += 31_000;
  const forged = Array.from({ length: 50 }, (_, i) =>
    `${json64({ alg: 'RS256', kid: `stray-${i}`, typ: 'JWT' })}.${json64(claims({}, clock.now))}.${b64url(encoder.encode('not a signature'))}`);
  for (const response of await burst(gate, jwks, forged, '/api/journal')) await assertDenied(response);
  assert.equal(downloads(), 2, 'one download for the whole burst');
  // Within the cool-down after that download, the same burst starts none.
  for (const response of await burst(gate, jwks, forged)) await assertDenied(response);
  assert.equal(downloads(), 2);

  // The cool-down counts from the last download that began, even one that failed.
  clock.now += 31_000;
  jwks.state.mode = 'status';
  await assertDenied(await gate.fetch(request('/', { token: forged[0] }), accessEnv()));
  assert.equal(downloads(), 3);
  jwks.state.mode = 'ok';
  for (const response of await burst(gate, jwks, forged)) await assertDenied(response);
  assert.equal(downloads(), 3, 'a failed download does not open the way to the next one');

  // The team rotates to keyB. Its tokens arrive together after the cool-down, share one download and are all let in.
  jwks.state.keys = [keyA.jwk, keyB.jwk];
  clock.now += 31_000;
  for (const response of await burst(gate, jwks, Array(10).fill(await sign(claims({}, clock.now), { key: keyB })))) assert.equal(response.status, 200);
  assert.equal(downloads(), 4);

  // When the key set expires, the next burst shares one download too.
  clock.now += 5 * 60_000 + 1;
  for (const response of await burst(gate, jwks, Array(20).fill(await sign(claims({}, clock.now))))) assert.equal(response.status, 200);
  assert.equal(downloads(), 5);
  assert.equal(seen.length, 50);
  assert.deepEqual(reasons, [...Array(100).fill('kid_unknown'), 'jwks_unavailable', ...Array(50).fill('kid_unknown')]);
  // The runbook describes this limit.
  assert.match(readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8'),
    /share one download[^\n]*at most one download every 30 seconds, however many arrive at once/);
});

test('with no key set cached, a failed download holds off the next one for 5 seconds, so a failing endpoint is not flooded', async () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  const forged = Array.from({ length: 25 }, (_, i) =>
    `${json64({ alg: 'RS256', kid: `stray-${i}`, typ: 'JWT' })}.${json64(claims())}.${b64url(encoder.encode('not a signature'))}`);
  // Cold cache and a failing endpoint. Forged tokens arrive one after another and no time passes between them.
  for (const mode of ['status', 'throw', 'json']) {
    const { gate, jwks, clock, seen, reasons } = harness();
    jwks.state.mode = mode;
    for (const token of forged) await assertDenied(await gate.fetch(request('/api/journal', { token }), accessEnv()));
    assert.equal(jwks.state.calls.length, 1, `${mode}: one download for 25 requests`);
    // The owner's own token waits out the back-off too.
    clock.now += 4_999;
    await assertDenied(await gate.fetch(request('/', { token: await sign(claims({}, clock.now)) }), accessEnv()));
    assert.equal(jwks.state.calls.length, 1, `${mode}: no download within 5 seconds of the failed one`);
    // 5 seconds after the failed download began, the next request tries again. It fails too, so the wait starts over.
    clock.now += 1;
    for (const token of forged) await assertDenied(await gate.fetch(request('/api/journal', { token }), accessEnv()));
    assert.equal(jwks.state.calls.length, 2, `${mode}: one more download`);
    // Once the endpoint recovers, the first request after the wait gets in and fills the cache.
    jwks.state.mode = 'ok';
    clock.now += 5_000;
    assert.equal((await gate.fetch(request('/', { token: await sign(claims({}, clock.now)) }), accessEnv())).status, 200);
    assert.equal((await gate.fetch(request('/', { token: await sign(claims({}, clock.now)) }), accessEnv())).status, 200);
    assert.equal(jwks.state.calls.length, 3); assert.equal(seen.length, 2);
    assert.deepEqual(reasons, Array(51).fill('jwks_unavailable'), mode);
  }
  // A full minute of failure, one request every 100 ms: one download every 5 seconds, never more.
  {
    const { gate, jwks, clock } = harness();
    jwks.state.mode = 'status';
    const token = await sign(claims());
    for (let elapsed = 0; elapsed < 60_000; elapsed += 100) {
      clock.now = NOW + elapsed;
      await assertDenied(await gate.fetch(request('/', { token }), accessEnv()));
    }
    assert.equal(jwks.state.calls.length, 12);
  }
  // The back-off applies only when no key set is cached. A failed refetch for an unknown kid leaves the cached keys in use.
  {
    const { gate, jwks, clock, seen, reasons } = harness();
    assert.equal((await gate.fetch(request('/', { token: await sign(claims()) }), accessEnv())).status, 200);
    clock.now += 31_000;
    jwks.state.mode = 'status';
    await assertDenied(await gate.fetch(request('/', { token: forged[0] }), accessEnv()));
    assert.equal(jwks.state.calls.length, 2);
    assert.equal((await gate.fetch(request('/', { token: await sign(claims({}, clock.now)) }), accessEnv())).status, 200);
    assert.equal(jwks.state.calls.length, 2); assert.equal(seen.length, 2); assert.deepEqual(reasons, ['jwks_unavailable']);
  }
  // The runbook states both limits: with a cached key set and without one.
  assert.match(runbook, /while a key set is cached, tokens with unknown keys cause at most one download every 30 seconds/);
  assert.match(runbook, /starts no other download until 5 seconds after the failed one began/);
  assert.match(runbook, /at most one download every 5 seconds/);
});

test('a key download that never answers fails closed on each request\'s own timer, and a later request starts afresh', async () => {
  const jwks = jwksEndpoint();
  const { gate, clock, seen, reasons } = harness({ jwks, options: { jwksTimeoutMs: 40 } });
  // The runtime drops a download when the request that began it is cancelled; the stand-in never answers at all.
  jwks.state.hold = new Promise(() => {});
  const token = await sign(claims());
  const startedAt = performance.now();
  const responses = await Promise.all(Array.from({ length: 5 }, () => gate.fetch(request('/', { token }), accessEnv())));
  for (const response of responses) await assertDenied(response);
  assert.ok(performance.now() - startedAt < 2_000, 'no request waits past its own time limit');
  assert.equal(jwks.state.calls.length, 1); assert.deepEqual(reasons, Array(5).fill('jwks_unavailable')); assert.equal(seen.length, 0);
  // Once the stuck download has run past the time limit, it no longer counts as under way. It counts as failed, so the
  // next download waits until 5 seconds after the stuck one began. Then a later request starts afresh.
  jwks.state.hold = null;
  clock.now += 41;
  await assertDenied(await gate.fetch(request('/', { token }), accessEnv()));
  assert.equal(jwks.state.calls.length, 1);
  clock.now = NOW + 5_000;
  assert.equal((await gate.fetch(request('/', { token }), accessEnv())).status, 200);
  assert.equal(jwks.state.calls.length, 2); assert.equal(seen.length, 1);
});

test('OWNER_EMAILS admits only the listed addresses, case-insensitively, and a missing or blank list admits nobody', async () => {
  const token = await sign(claims());
  for (const [owners, status, reason] of [
    ['second@example.test,third@example.test', 403, 'owner_not_allowed'],
    ['owner@example.test.attacker.test', 403, 'owner_not_allowed'],
    [' , ', 403, 'config_missing'],
    [42, 403, 'config_missing'],
    [' Owner@Example.TEST , second@example.test ', 200, null],
    ['owner@example.test', 200, null],
    // The second lock can never be switched off by leaving the secret unset or blank.
    [undefined, 403, 'config_missing'],
    [null, 403, 'config_missing'],
    ['', 403, 'config_missing'],
    ['   ', 403, 'config_missing'],
    ['\n', 403, 'config_missing'],
  ]) {
    const { gate, seen, reasons } = harness();
    const response = await gate.fetch(request('/api/journal', { token }), accessEnv({ OWNER_EMAILS: owners }));
    assert.equal(response.status, status, String(owners));
    if (status === 403) { await assertDenied(response); assert.equal(seen.length, 0); assert.deepEqual(reasons, [reason], String(owners)); }
    else assert.deepEqual(oaiHeaders(seen[0].request), [['oai-authenticated-user-id', `cf-access:${SUB}`]]);
  }
});

test('without OWNER_EMAILS the deployed entry refuses even a valid token and never touches the database', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const warn = t.mock.method(console, 'warn', () => {});
  const network = t.mock.method(globalThis, 'fetch', () => { throw Error('A gate without its allowlist must not fetch keys'); });
  const token = await sign(claims({ email: 'intruder@example.test', sub: 'intruder' }, Date.now()));
  for (const owners of [undefined, '', '   ']) {
    for (const [method, path, body] of [['GET', '/'], ['GET', '/api/journal'], ['POST', '/api/journal', '{"expectedRevision":0}'], ['POST', '/', '{}']]) {
      const env = { ...accessEnv({ OWNER_EMAILS: owners }), DB: db };
      await assertDenied(await cloudflareWorker.fetch(request(path, { method, token, body, headers: { origin, 'content-type': 'application/json' } }), env), method);
    }
  }
  assert.equal(db.calls.length, 0); assert.equal(network.mock.callCount(), 0);
  assert.equal(warn.mock.callCount(), 12);
  assert.ok(warn.mock.calls.every(call => /request denied \(config_missing\)/.test(call.arguments[0])));
});

test('a JWKS fetch failure fails closed and is not cached; expired key sets are never reused', async () => {
  const token = await sign(claims());
  for (const mode of ['throw', 'status', 'redirect', 'json']) {
    const { gate, jwks, clock, seen, reasons } = harness();
    jwks.state.mode = mode;
    await assertDenied(await gate.fetch(request('/api/journal', { token }), accessEnv()));
    assert.equal(seen.length, 0); assert.deepEqual(reasons, ['jwks_unavailable'], mode);
    jwks.state.mode = 'ok';
    // The failure is not cached as a key set. The next download waits out the 5-second back-off, then succeeds.
    await assertDenied(await gate.fetch(request('/api/journal', { token }), accessEnv()));
    assert.equal(jwks.state.calls.length, 1, `${mode}: no download during the back-off`);
    clock.now += 5_000;
    assert.equal((await gate.fetch(request('/api/journal', { token }), accessEnv())).status, 200, `${mode}: recovers on the next request after the back-off`);
    assert.equal(jwks.state.calls.length, 2);
  }
  for (const keys of [[], [{ ...keyA.jwk, kty: 'EC' }], [{ ...keyA.jwk, alg: 'RS512' }], [{ ...keyA.jwk, use: 'enc' }], [{ ...keyA.jwk, n: 'not*base64' }], [weak.jwk]]) {
    const { gate, seen, reasons } = harness({ jwks: jwksEndpoint({ keys }) });
    await assertDenied(await gate.fetch(request('/', { token: keys[0]?.kid === 'kid-weak' ? await sign(claims(), { key: weak }) : token }), accessEnv()));
    assert.equal(seen.length, 0); assert.deepEqual(reasons, ['jwks_unavailable'], JSON.stringify(keys).slice(0, 80));
  }
  // A warm cache past its TTL is refetched; if that fetch fails, the old keys are not used.
  const { gate, jwks, clock, reasons } = harness();
  assert.equal((await gate.fetch(request('/', { token }), accessEnv())).status, 200);
  clock.now += 5 * 60_000 + 1;
  jwks.state.mode = 'throw';
  await assertDenied(await gate.fetch(request('/', { token: await sign(claims({}, clock.now)) }), accessEnv()));
  assert.deepEqual(reasons, ['jwks_unavailable']); assert.equal(jwks.state.calls.length, 2);
});

test('missing or malformed Access settings answer 403 without contacting anything', async () => {
  const token = await sign(claims());
  for (const env of [undefined, null, {}, accessEnv({ ACCESS_TEAM_DOMAIN: '' }), accessEnv({ ACCESS_TEAM_DOMAIN: '   ' }), accessEnv({ ACCESS_TEAM_DOMAIN: undefined }),
    accessEnv({ ACCESS_AUD: '' }), accessEnv({ ACCESS_AUD: '  ' }), accessEnv({ ACCESS_AUD: undefined }),
    accessEnv({ IDENTITY_MODE: undefined }), accessEnv({ IDENTITY_MODE: 'oai' }), accessEnv({ IDENTITY_MODE: 'none' }),
    accessEnv({ ACCESS_TEAM_DOMAIN: ISSUER }), accessEnv({ ACCESS_TEAM_DOMAIN: `${TEAM}/cdn-cgi` }), accessEnv({ ACCESS_TEAM_DOMAIN: 'localhost' }),
    accessEnv({ OWNER_EMAILS: undefined }), accessEnv({ OWNER_EMAILS: null }), accessEnv({ OWNER_EMAILS: '' }), accessEnv({ OWNER_EMAILS: '  \t ' }),
    accessEnv({ OWNER_EMAILS: ',' }), accessEnv({ OWNER_EMAILS: [EMAIL] })]) {
    const { gate, seen, reasons, jwks } = harness();
    await assertDenied(await gate.fetch(request('/', { token }), env));
    assert.equal(seen.length, 0); assert.deepEqual(reasons, ['config_missing'], JSON.stringify(env)); assert.equal(jwks.state.calls.length, 0);
    assert.equal(readAccessConfig(env), null);
  }
  const config = readAccessConfig(accessEnv({ ACCESS_TEAM_DOMAIN: ` ${TEAM.toUpperCase()} `, OWNER_EMAILS: ` ${EMAIL.toUpperCase()} ,, second@example.test ` }));
  assert.deepEqual({ ...config, owners: [...config.owners] },
    { teamDomain: TEAM, issuer: ISSUER, audience: AUD, certsUrl: CERTS, owners: [EMAIL, 'second@example.test'] });
});

test('every response, allowed or refused, forbids framing by any site', async t => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [keyA.jwk] }));
  const db = new SQLiteD1(); t.after(() => db.close());
  const token = await sign(claims({}, Date.now()));
  const env = { ...accessEnv(), DB: db };
  // What a hostile page's iframe sends: the browser adds the Access token cookie, so the gate admits it.
  const framed = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site', origin };
  for (const [method, path, status] of [['GET', '/', 200], ['GET', '/index.html', 200], ['GET', '/app.js', 200], ['GET', '/help/price-import.html', 200],
    ['HEAD', '/', 200], ['GET', '/api/journal', 200], ['GET', '/api/market-data/setup', 200], ['GET', '/not-found', 404], ['POST', '/', 405]]) {
    const response = await cloudflareWorker.fetch(request(path, { method, token, headers: framed }), env);
    assert.equal(response.status, status, `${method} ${path}`);
    assertFrameGuard(response, `${method} ${path}`);
  }
  for (const path of ['/', '/api/journal']) await assertDenied(await cloudflareWorker.fetch(request(path, { headers: framed }), env));

  // The inner response keeps its status, body and headers. An inner policy stays and the framing rule is added as its own
  // policy, so both apply. An inner X-Frame-Options cannot loosen the rule. Immutable inner headers are no obstacle.
  const inner = [
    new Response('kept', { status: 201, headers: { 'content-security-policy': "default-src 'self'", 'x-frame-options': 'ALLOWALL', 'x-inner': 'yes' } }),
    Response.redirect(`${origin}/#journal`, 302),
  ];
  const { gate } = harness({ app: { async fetch() { return inner.shift(); } } });
  const first = await gate.fetch(request('/', { token: await sign(claims()) }), accessEnv());
  assert.equal(first.status, 201); assert.equal(await first.text(), 'kept'); assert.equal(first.headers.get('x-inner'), 'yes');
  assert.equal(first.headers.get('content-security-policy'), "default-src 'self', frame-ancestors 'none'");
  assert.equal(first.headers.get('x-frame-options'), 'DENY');
  const second = await gate.fetch(request('/', { token: await sign(claims()) }), accessEnv());
  assert.equal(second.status, 302); assert.equal(second.headers.get('location'), `${origin}/#journal`);
  assertFrameGuard(second, 'redirect');
});

test('static assets are 403 without a token and served with one', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const network = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url), CERTS); return Response.json({ keys: [keyA.jwk] });
  });
  for (const path of ['/', '/index.html', '/app.js', '/style.css', '/data/stock-evidence.json', '/help/price-import.html', '/favicon.ico']) {
    const response = await cloudflareWorker.fetch(request(path), accessEnv());
    await assertDenied(response);
  }
  assert.equal(network.mock.callCount(), 0); assert.equal(warn.mock.callCount(), 7);
  const token = await sign(claims({}, Date.now()));
  const served = await cloudflareWorker.fetch(request('/app.js', { token }), accessEnv());
  const original = await originalWorker.fetch(request('/app.js'), {});
  assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(await served.text(), await original.text());
  assert.ok(network.mock.callCount() <= 1);
});

test('HEAD and OPTIONS are gated like every other method', async t => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [keyA.jwk] }));
  const preflight = { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type', origin: 'https://attacker.example.test', 'oai-authenticated-user-id': 'victim-owner' };
  await assertDenied(await cloudflareWorker.fetch(request('/', { method: 'HEAD' }), accessEnv()), 'HEAD');
  await assertDenied(await cloudflareWorker.fetch(request('/app.js', { method: 'HEAD', headers: { 'oai-authenticated-user-id': 'victim-owner' } }), accessEnv()), 'HEAD');
  await assertDenied(await cloudflareWorker.fetch(request('/api/journal', { method: 'OPTIONS', headers: preflight }), accessEnv()), 'OPTIONS');
  await assertDenied(await cloudflareWorker.fetch(request('/mcp', { method: 'OPTIONS', headers: preflight }), accessEnv()), 'OPTIONS');

  const token = await sign(claims({}, Date.now()));
  const head = await cloudflareWorker.fetch(request('/', { method: 'HEAD', token }), accessEnv());
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const staticOptions = await cloudflareWorker.fetch(request('/', { method: 'OPTIONS', token }), accessEnv());
  assert.equal(staticOptions.status, 405);
  const apiOptions = await cloudflareWorker.fetch(request('/api/journal', { method: 'OPTIONS', token, headers: preflight }), accessEnv());
  assert.equal(apiOptions.status, 405); assert.equal((await apiOptions.json()).error, 'method_not_allowed');
});

test('wrangler.jsonc deploys the gated entry with no public address, routes or owner address', () => {
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  let json = '', inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) { json += c; if (c === '\\') json += text[++i]; else if (c === '"') inString = false; continue; }
    if (c === '"') { inString = true; json += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; json += '\n'; continue; }
    json += c;
  }
  const config = JSON.parse(json);
  assert.equal(config.name, 'cribscore'); assert.equal(config.main, 'worker/cloudflare.js');
  assert.match(config.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(config.build.command, 'npm run build');
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  for (const key of ['routes', 'route', 'custom_domains']) assert.equal(config[key], undefined, key);
  assert.equal(config.d1_databases.length, 1);
  assert.deepEqual({ ...config.d1_databases[0], database_id: undefined }, { binding: 'DB', database_name: 'cribscore', database_id: undefined, migrations_dir: 'drizzle' });
  // Every deploy sends these committed values, so a clean checkout must carry real, well-formed ones.
  assert.match(config.d1_databases[0].database_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(Object.keys(config.vars).sort(), ['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'IDENTITY_MODE']);
  assert.equal(config.vars.IDENTITY_MODE, 'cloudflare-access');
  assert.match(config.vars.ACCESS_TEAM_DOMAIN, /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/);
  assert.match(config.vars.ACCESS_AUD, /^[0-9a-f]{64}$/);
  // The committed vars pass the gate's own checks once the OWNER_EMAILS secret is present, and admit nobody without it.
  assert.notEqual(readAccessConfig({ ...config.vars, OWNER_EMAILS: EMAIL }), null);
  assert.equal(readAccessConfig(config.vars), null);
  // Wrangler refuses a first deploy without this secret and a later deploy after it was deleted.
  assert.deepEqual(config.secrets.required, ['OWNER_EMAILS']);
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
  assert.doesNotMatch(text, email, 'No email address belongs in wrangler.jsonc');
  assert.doesNotMatch(readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8'), email, 'No email address belongs in the runbook');
});

test('local secret files that Wrangler suggests are ignored by git', t => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  if (spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).stdout?.trim() !== 'true') {
    t.skip('not a git checkout'); return;
  }
  for (const path of ['.dev.vars', '.dev.vars.production', '.env', '.env.local', '.env.production', 'cribscore-secrets.env', 'worker/.dev.vars', '.wrangler/state/v3/d1/db.sqlite']) {
    assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', path]).status, 0, `${path} must be ignored`);
  }
  for (const path of ['wrangler.jsonc', 'worker/cloudflare.js', 'docs/cloudflare-hosting.md']) {
    assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', path]).status, 1, `${path} must stay tracked`);
  }
});

test('the runbook gives a version rollback, safe cookie settings and a local check without a secrets file', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  assert.match(runbook, /npx wrangler@4 rollback/);
  assert.match(runbook, /SameSite[^\n]*\*\*Lax\*\*/);
  assert.match(runbook, /OWNER_EMAILS=nobody npx wrangler@4 dev --port 8787/);
  assert.match(runbook, /request denied \(token_missing\)/);
  // The runbook names the test failures that do not block a deploy, so a red run is never waved through blindly.
  assert.match(runbook, /tests\/adversarial\.test\.mjs/); assert.match(runbook, /tests\/independent-fill-a11y\.test\.mjs/);
  assert.match(runbook, /tests\/cloudflare-access\.test\.mjs/);
});

// Splits the runbook into its "## " sections and returns the one whose heading starts with `prefix`.
function runbookSection(runbook, prefix) {
  const hits = runbook.split(/^## /m).slice(1).map(part => [part.slice(0, part.indexOf('\n')), part.slice(part.indexOf('\n') + 1)]).filter(([heading]) => heading.startsWith(prefix));
  assert.equal(hits.length, 1, `exactly one runbook section starts with "${prefix}"`);
  return { heading: hits[0][0], body: hits[0][1] };
}

test('the runbook audits the live Access application before cribscore.co moves, and keeps creation in an appendix', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  const step1 = runbookSection(runbook, 'Step 1.'), step2 = runbookSection(runbook, 'Step 2.'), appendix = runbookSection(runbook, 'Appendix');
  // Zero Trust and the application already exist, so steps 1 and 2 check them instead of creating them.
  assert.match(step1.heading, /^Step 1\. Check /); assert.match(step2.heading, /^Step 2\. Check /);
  // The checks name the live team and application, and the team is the one the committed config trusts.
  const team = /"ACCESS_TEAM_DOMAIN":\s*"([^"]+)"/.exec(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))[1];
  assert.ok(step1.body.includes(`\`${team}\``), 'step 1 names the team domain from wrangler.jsonc');
  assert.match(step2.body, /application id is `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`/);
  // Every hardening setting is checked on the live application, including the ones it is known to lack.
  for (const pattern of [/`cribscore\.co` and `www\.cribscore\.co`/, /path is empty on both/, /Action: \*\*Allow\*\*/, /Include: \*\*Emails\*\*/,
    /no \*\*Everyone\*\* rule/, /no \*\*Bypass\*\* or \*\*Service Auth\*\* policy/, /IP range/, /no other application covers/, /One-time PIN/,
    /live application keeps you signed in for 24 hours\. Keep it at 24 hours\./, /A shorter session limits how long a stolen sign-in cookie works\./,
    /"Owner only" policy\. Its session duration must be \*\*Same as application session timeout\*\*/,
    /Set \*\*SameSite\*\* to \*\*Lax\*\*/, /Keep \*\*HttpOnly\*\* on/, /Turn on \*\*Binding cookie\*\*/]) {
    assert.match(step2.body, pattern);
  }
  // The audit gates the DNS switch, and its check line asks for the live values, never assumes them.
  assert.match(step2.body, /Finish this step before step 7\./);
  assert.match(step2.body, /^Check: you looked at every item above on the live application\./m);
  // The session is 24 hours everywhere, and a policy-level duration cannot quietly replace it.
  const check = step2.body.slice(step2.body.indexOf('\nCheck: '));
  assert.match(check.slice(0, check.indexOf('\n', 1)), /The session duration is 24 hours\. The session duration of the "Owner only" policy is \*\*Same as application session timeout\*\*\./);
  assert.doesNotMatch(runbook, /\b1 hour\b/);
  assert.match(appendix.body, /Set the session duration to 24 hours/);
  assert.match(appendix.body, /Leave its session duration at \*\*Same as application session timeout\*\*/);
  // Creating Zero Trust or the application belongs only in the appendix, which comes after the last step.
  const steps = runbook.slice(0, runbook.indexOf('## Appendix'));
  assert.ok(runbook.indexOf('## Appendix') > runbook.indexOf('## Step 9.'));
  for (const create of [/Pick a team name/, /add an application/, /Choose \*\*Self-hosted\*\*/]) {
    assert.doesNotMatch(steps, create); assert.match(appendix.body, create);
  }
});

test('the journal is exported right before the old records go, and the restore is checked against counts written down then', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  const step7 = runbookSection(runbook, 'Step 7.').body, step8 = runbookSection(runbook, 'Step 8.').body;
  // An earlier export would miss what is recorded during steps 1 to 6, and those records would stay on the old host.
  assert.doesNotMatch(runbook.slice(0, runbook.indexOf('## Step 7.')), /Export journal/);
  const countsAt = step7.indexOf('Write down the counts'), exportAt = step7.indexOf('**Export journal**'), deleteAt = step7.indexOf('Delete the apex');
  assert.ok(countsAt > -1 && exportAt > countsAt && deleteAt > exportAt, 'counts, then export, then the old records are deleted');
  const beforeDelete = step7.slice(0, deleteAt);
  assert.match(beforeDelete, /record nothing on the old site/);
  // The restore is checked against the counts from the export, and a shortfall stops the move.
  const applyAt = step8.indexOf('**Apply reviewed backup**'), compareAt = step8.indexOf('Compare the counts with the ones you wrote down in step 7 Part A');
  assert.ok(applyAt > -1 && compareAt > applyAt, 'the counts are compared after the backup is applied');
  assert.match(step8, /file from step 7 Part A/);
  assert.match(step8, /count is lower[^\n]*roll back \(step 9\)/);
  for (const label of ['Entries', 'Abstentions', 'Real trades you confirmed']) {
    assert.ok(beforeDelete.includes(`**${label}**`), `step 7 writes down ${label}`); assert.ok(step8.includes(`**${label}**`), `step 8 compares ${label}`);
  }
  // Every journal label the runbook names exists on the journal page.
  const view = readFileSync(new URL('../dist/lib/journal-view.js', import.meta.url), 'utf8');
  for (const label of ["'Entries'", "'Abstentions'", 'Real trades you confirmed:', '>Daily record<', '>History<', '>Backup and restore<', '>Export journal<', '>Review backup<', '>Apply reviewed backup<']) {
    assert.ok(view.includes(label), `journal page shows ${label}`);
  }
});

test('the custom domains attach for Production only, because no config file controls their Preview setting', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const step7 = runbookSection(runbook, 'Step 7.').body, partC = step7.slice(step7.indexOf('**Part C.'));
  for (const domain of ['`cribscore.co`', '`www.cribscore.co`']) {
    assert.ok(partC.includes(`Add a **Custom domain**: ${domain}. For **Enable for**, choose **Production** only.`), domain);
  }
  assert.match(partC, /Do not choose \*\*Preview\*\* or \*\*Production and Preview\*\*/);
  // The check looks for what a preview would leave behind: the setting itself and its wildcard records.
  const check = partC.slice(partC.indexOf('Check:'));
  assert.match(check, /Production only, with Preview off/);
  assert.ok(check.includes('`*.cribscore.co`') && check.includes('`*.www.cribscore.co`'));
  assert.match(check, /does not control Preview on a custom domain/);
  // `preview_urls` covers only workers.dev. Neither the runbook nor the config may say it closes every preview address.
  const intro = runbookSection(runbook, 'How the site stays private').body;
  assert.doesNotMatch(intro, /no preview addresses/);
  assert.match(intro, /`preview_urls` setting covers only `workers\.dev`/);
  assert.match(intro, /Each custom domain has its own \*\*Preview\*\* setting, and `wrangler\.jsonc` does not control it\./);
  assert.doesNotMatch(runbook, /preview URLs are off\. `wrangler\.jsonc` turns both off/);
  const comments = config.split('\n').filter(line => line.trim().startsWith('//')).map(line => line.trim().slice(2).trim()).join(' ');
  assert.match(comments, /preview_urls covers only workers\.dev\. Each custom domain has its own Preview setting, which this file does not control/);
  assert.match(comments, /Production only/);
});

test('every later deploy installs, builds, tests and dry-runs before it uploads', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  // A clean checkout has no node_modules, so a bare deploy fails at the build and skips the gate tests.
  assert.doesNotMatch(runbook, /need only `npx wrangler@4 deploy`/);
  const step6 = runbookSection(runbook, 'Step 6.').body;
  assert.ok(step6.includes('**Every later deploy.**'));
  const later = step6.slice(step6.indexOf('**Every later deploy.**'));
  let at = -1;
  // `wrangler deploy` never applies D1 migrations, so a new file in drizzle/ is applied to the remote database before the upload.
  for (const command of ['\nnpm ci\n', '\nnpm run build\n', '\nnpm test\n', '\nnpm run validate:worker\n', '\nnpx wrangler@4 deploy --dry-run --outdir /tmp/cribscore-dry-run\n',
    '\nnpx wrangler@4 d1 migrations list cribscore --remote\n', '\nnpx wrangler@4 d1 migrations apply cribscore --remote\n', '\nnpx wrangler@4 deploy\n']) {
    const next = later.indexOf(command, at + 1);
    assert.ok(next > at, `${command.trim()} comes next`); at = next;
  }
  assert.match(later, /only the known failures from item 1 above\. Any other failure stops the deploy\./);
  assert.match(later, /`npx wrangler@4 deploy` does not apply database migrations\./);
  // The old code serves requests while a migration runs, and a rollback does not undo one.
  assert.match(later, /must keep working with the code that runs now/);
  assert.match(later, /A rollback does not undo a migration\./);
});

test('the runbook says when the journal owner ID changes, how to keep it, and how to move the journal in a rebuild', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  const notes = runbookSection(runbook, 'Notes').body, appendix = runbookSection(runbook, 'Appendix').body;
  const identity = notes.slice(notes.indexOf('**Owner identity.**'));
  // The two cases Cloudflare documents for a new `sub`, and what the owner then sees.
  assert.match(identity, /removed from the Zero Trust organization and later signs in again/);
  assert.match(identity, /sign in through a different Zero Trust organization/);
  assert.match(identity, /journal opens empty/);
  for (const pattern of [/Do not remove your own user/, /Leave \*\*Remove inactive users from seats\*\* off/, /Export the journal regularly/,
    /Do not delete the old records in D1/]) assert.match(identity, pattern);
  // A rebuild saves the journal before anything else and checks it once the new setup is live.
  const saveAt = appendix.indexOf('**First, save the journal.**'), zeroTrustAt = appendix.indexOf('**Turn on Zero Trust.**'), thenAt = appendix.indexOf('**Then:**');
  assert.ok(saveAt > -1 && zeroTrustAt > saveAt && thenAt > zeroTrustAt, 'save first, rebuild, then check');
  assert.match(appendix.slice(saveAt, zeroTrustAt), /\*\*Export journal\*\*/);
  assert.match(appendix.slice(thenAt), /If it is empty, restore the file[^\n]*step 8, check 3/);
});

test('each kept login method is checked to open the same journal', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  const step2 = runbookSection(runbook, 'Step 2.').body, step8 = runbookSection(runbook, 'Step 8.').body;
  assert.match(step2, /If you keep both, step 8 check 5 confirms that both open the same journal\./);
  const check5 = step8.slice(step8.indexOf('5. **Each login method opens the same journal.**'));
  assert.ok(step8.includes('5. **Each login method opens the same journal.**'));
  assert.match(check5, /sign in now with the method you did not use in check 3/i);
  assert.match(check5, /do not start or restore a journal there/);
  assert.match(check5, /turn that login method off/);
});

test('the way back to the old host is marked as lasting only days', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  const step9 = runbookSection(runbook, 'Step 9.').body;
  const leave = step9.slice(step9.indexOf('**To leave Cloudflare and go back to the old host:**'));
  assert.match(leave, /works only for a short time/);
  assert.match(leave, /After 7 days in that state, Cloudflare deletes it\./);
  assert.match(leave, /old host would have to add the domain again/);
  assert.match(leave, /Keep the export file from step 7 Part A until the new site has worked for more than 7 days/);
  // The warning comes before the DNS steps it limits.
  assert.ok(leave.indexOf('7 days') < leave.indexOf('add back the old records'));
});

test('the rollback step reads the log first, sends allowlist refusals to secret put and covers the first deploy', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  const step9 = runbookSection(runbook, 'Step 9.').body;
  const log = step9.slice(step9.indexOf('**First, read the log.**'), step9.indexOf('**If only the latest deploy is bad**'));
  assert.ok(step9.indexOf('**First, read the log.**') > -1 && log.length > 0, 'the log check comes before the rollback');
  for (const text of ['`npx wrangler@4 tail`', '`owner_not_allowed`', '`config_missing`', 'Do not roll back for that.', '`npx wrangler@4 secret put OWNER_EMAILS`']) {
    assert.ok(log.includes(text), text);
  }
  // Both refusals name reasons the gate really logs.
  const gate = readFileSync(new URL('../worker/cloudflare-access.js', import.meta.url), 'utf8');
  for (const reason of ['owner_not_allowed', 'config_missing', 'sub_invalid']) assert.ok(gate.includes(`deny('${reason}')`), reason);
  // Wrangler asks before a rollback across a changed secret, and refuses `secret put` while the newest upload is not live.
  const rollback = step9.slice(step9.indexOf('**If only the latest deploy is bad**'), step9.indexOf('**To leave Cloudflare'));
  assert.match(rollback, /If a secret changed after the version you pick, Wrangler names it and asks first\./);
  assert.match(rollback, /After a rollback, Wrangler refuses `secret put` until you deploy again/);
  assert.match(rollback, /To change `OWNER_EMAILS` after a rollback, first deploy the last good commit as in step 6\. Then run `npx wrangler@4 secret put OWNER_EMAILS`\./);
  // The first deploy has no earlier version to go back to.
  assert.match(rollback, /After the first deploy there is no earlier version, so a rollback cannot help\. Fix the problem and deploy again \(step 6\)\./);
  assert.match(rollback, /use "To leave Cloudflare" below/);
});

test('a rollback always names the version to go back to, because a secret change is a deployment too', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  const step9 = runbookSection(runbook, 'Step 9.').body;
  const rollback = step9.slice(step9.indexOf('**If only the latest deploy is bad**'), step9.indexOf('**To leave Cloudflare'));
  // Without an id, Wrangler goes back to the previous deployment. After a `secret put` that is the bad code again, with the
  // old secret. So every rollback command in the runbook names a version id.
  const commands = runbook.match(/npx wrangler@4 rollback[^\n`]*/g) ?? [];
  assert.ok(commands.length > 0, 'the runbook shows a rollback command');
  for (const command of commands) assert.equal(command, 'npx wrangler@4 rollback <version-id>');
  assert.doesNotMatch(runbook, /picks the version uploaded before the latest one/);
  assert.match(rollback, /`secret put` makes a deployment too/);
  // The id comes from the deployment list, and a secret change after the bad deploy still runs the bad code.
  const listAt = rollback.search(/\n *npx wrangler@4 deployments list\n/), rollbackAt = rollback.search(/\n *npx wrangler@4 rollback <version-id>\n/);
  assert.ok(listAt > -1 && rollbackAt > listAt, 'list the deployments, then roll back to a named version');
  assert.match(rollback, /\*\*Source\*\* is \*\*Secret Change\*\*[^\n]*still runs the code of the deployment before it/);
  // A rollback across a changed OWNER_EMAILS would bring back the old list. The runbook says to refuse it and deploy the good
  // commit instead, which keeps the secrets you have now.
  const noAt = rollback.indexOf('answer **no**'), deployAt = rollback.indexOf('check out the last good commit and deploy it as in step 6');
  assert.ok(noAt > rollbackAt && deployAt > noAt, 'refuse the secret prompt, then deploy the good commit');
  assert.match(rollback, /A deploy keeps the secrets you have now\./);
  assert.doesNotMatch(runbook, /fix `OWNER_EMAILS` first, before any rollback/);
});

test('the runbook uses no em dashes', () => {
  const runbook = readFileSync(new URL('../docs/cloudflare-hosting.md', import.meta.url), 'utf8');
  assert.doesNotMatch(runbook, /—/);
});
