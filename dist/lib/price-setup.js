const safeStates = new Set(['setup_required','configured_unverified']);
const knownReasons = new Set(['credentials_missing_or_invalid','rights_review_missing','rights_review_stale','operation_not_authorized','terms_review_missing','source_rights_review_missing','account_entitlement_missing','audience_not_authorized']);
const utc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);
const copy = value => ({...value, reasons:[...value.reasons]});
const maxResponseBytes = 8192;

async function readStatusResponse(reply, signal, deadline) {
  const contentType = reply.headers?.get('content-type') ?? '';
  const contentLength = reply.headers?.get('content-length');
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)
    || (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxResponseBytes))) throw Error('invalid_setup_response');
  const reader = reply.body?.getReader();
  if (!reader) throw Error('invalid_setup_response');
  const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} };
  let rejectAbort;
  const aborted = new Promise((_,reject) => { rejectAbort = reject; });
  const onAbort = () => { cancel(); rejectAbort(Error('setup_aborted')); };
  signal.addEventListener('abort',onAbort,{once:true});
  try {
    if (signal.aborted) throw Error('setup_aborted');
    const decoder = new TextDecoder('utf-8',{fatal:true});
    let bytes = 0, text = '', chunks = 0;
    while (true) {
      const {done,value} = await Promise.race([reader.read(),aborted]);
      if (signal.aborted || performance.now() >= deadline) throw Error('setup_aborted');
      if (done) break;
      // Bound empty fragments too, without rejecting a valid one-byte-per-chunk
      // response within the 8 KiB byte limit. A stream cannot starve the timer.
      if (++chunks > 16_384) throw Error('invalid_setup_response');
      if (!(value instanceof Uint8Array) || (bytes += value.byteLength) > maxResponseBytes) throw Error('invalid_setup_response');
      text += decoder.decode(value,{stream:true});
    }
    const body = JSON.parse(text + decoder.decode());
    if (signal.aborted || performance.now() >= deadline) throw Error('setup_aborted');
    return body;
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort',onAbort); try { reader.releaseLock(); } catch {} }
}

// A read-only configuration check. It never tests a provider connection, reads
// credential values, imports prices, or changes the journal.
export function createPriceSetupClient({fetch:request = globalThis.fetch,onChange = () => {},timeoutMs = 5000} = {}) {
  if (typeof request !== 'function' || typeof onChange !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw Error('invalid_price_setup_client');
  let state = {status:'unchecked',checkedAt:null,reasons:[]}, pending = null, controller = null, disposed = false;
  const changed = () => { if (!disposed) onChange(copy(state)); };
  const refresh = () => {
    if (disposed) return Promise.resolve(copy(state));
    if (pending) return pending;
    state = {status:'loading',checkedAt:null,reasons:[]};
    controller = new AbortController();
    const signal = controller.signal;
    const deadline = performance.now() + timeoutMs;
    let timer;
    pending = (async () => {
      try {
        const result = await Promise.race([
          (async () => {
            const reply = await request('/api/market-data/setup',{method:'GET',credentials:'same-origin',cache:'no-store',signal});
            // No platform identity: the status belongs to the signed-in owner. This is not a Site outage.
            if (reply.status === 401) { try { await reply.body?.cancel?.(); } catch {} return {status:'owner_only',checkedAt:null,reasons:[]}; }
            if (reply.ok !== true || reply.status !== 200) throw Error('setup_unavailable');
            const body = await readStatusResponse(reply,signal,deadline), p = body?.provider;
            if (body?.ok !== true || !utc(body.checkedAt) || p?.id !== 'alpaca' || !safeStates.has(p.status)
              || !Array.isArray(p.reasons) || p.reasons.length > 16 || p.reasons.some(reason => !knownReasons.has(reason))
              || new Set(p.reasons).size !== p.reasons.length || p.connectionVerified !== false || p.captureEnabled !== false
              || p.displayEnabled !== false || p.journalPricesEnabled !== false
              || (p.status === 'configured_unverified' ? p.reasons.length !== 0 : p.reasons.length === 0)) throw Error('invalid_setup_status');
            return {status:p.status,checkedAt:body.checkedAt,reasons:[...p.reasons]};
          })(),
          new Promise((_,reject) => { timer = setTimeout(() => {controller?.abort();reject(Error('setup_timeout'));},timeoutMs); }),
        ]);
        if (!disposed) state = result;
      } catch { if (!disposed) state = {status:'unavailable',checkedAt:null,reasons:[]}; }
      finally { clearTimeout(timer); controller = null; pending = null; changed(); }
      return copy(state);
    })();
    changed();
    return pending;
  };
  return Object.freeze({refresh,state:() => copy(state),dispose(){disposed = true;controller?.abort();}});
}

export function renderPriceSetup(state = {status:'unchecked',reasons:[]}) {
  const status = ['unchecked','loading','unavailable','owner_only',...safeStates].includes(state?.status) ? state.status : 'unavailable';
  const message = {
    unchecked:'Check whether a server-side price source has been configured.',
    loading:'Checking price-feed setup…',
    unavailable:'Price-feed setup could not be checked. Try again when the Site is available.',
    owner_only:'Price-feed setup is visible to the signed-in site owner only.',
    setup_required:'Alpaca setup is incomplete. Source-backed price capture remains off.',
    configured_unverified:'Alpaca configuration is present. Its connection has not been tested, and price capture remains off.',
  }[status];
  const reasons = new Set(Array.isArray(state?.reasons) ? state.reasons : []);
  const items = [];
  if (reasons.has('credentials_missing_or_invalid')) items.push('Owner-provided data credentials are missing or invalid.');
  if ([...reasons].some(reason => reason !== 'credentials_missing_or_invalid')) items.push('A current source-access and account-entitlement review is required.');
  return `<details class="desk-disclosure" data-state-key="prices:setup"><summary>Price-feed setup</summary><p data-price-setup-status="${status}">${message}</p>${items.length?`<ul>${items.map(item=>`<li>${item}</li>`).join('')}</ul>`:''}<p>Journal valuation also requires reviewed identity, calendar, price basis and corporate-action coverage. Supplied chart data cannot establish those inputs.</p><button id="price-check-setup" class="desk-button" type="button" data-price-action="check-setup"${status==='loading'?' aria-disabled="true" aria-busy="true"':''}>${status==='loading'?'Checking setup…':'Check data setup'}</button> <a href="./help/market-data-setup.html" target="_blank" rel="noopener noreferrer">Setup steps<span class="sr-only"> (opens in a new tab)</span> ↗</a></details>`;
}
