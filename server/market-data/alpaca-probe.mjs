// Owner-only, one-shot connection probe. It asks the Alpaca transport for one
// fixed symbol over the most recent completed New York day, reports a bounded
// outcome and keeps nothing. It cannot enable capture, display or journal prices.
import {fetchAlpacaDailyBars} from './alpaca-daily.mjs';
import {readAlpacaConfiguration} from './setup-status.mjs';

export const PROBE_PATH='/api/market-data/probe';
export const PROBE_SYMBOL='SPY';
export const PROBE_RATE_LIMIT_MS=60_000;
const MAX_BODY_BYTES=4096, MAX_TRACKED_OWNERS=1024, MAX_REASONS=16, DAY_MS=86_400_000;
// The transport requires a security mapping. These labels mark the probe's
// discarded series as unreconciled; they are not an identity review.
const PROBE_SECURITY=Object.freeze({symbol:PROBE_SYMBOL,originalSymbol:PROBE_SYMBOL,entityId:'probe-unreconciled',currency:'USD',exchange:'unverified',sessionTimezone:'America/New_York'});
const utc=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
const machineCode=value=>typeof value==='string'&&/^[a-z][a-z0-9_:-]{0,119}$/.test(value);
const response=(status,body,extra={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',vary:'oai-authenticated-user-id','x-content-type-options':'nosniff',...extra}});
const fail=(status,error,extra)=>response(status,{ok:false,error},extra);
const iso=ms=>new Date(ms).toISOString().replace(/\.000Z$/,'Z');
const NEW_YORK=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
// The New York wall clock of a UTC instant, expressed as UTC milliseconds.
function wallClock(ms) {
  const parts=NEW_YORK.formatToParts(new Date(ms));
  const get=type=>Number(parts.find(part=>part.type===type).value);
  return Date.UTC(get('year'),get('month')-1,get('day'),get('hour')%24,get('minute'),get('second'));
}
const newYorkDate=ms=>new Date(wallClock(ms)).toISOString().slice(0,10);
const shiftDay=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY_MS).toISOString().slice(0,10);
// The UTC instant at which New York reaches 00:00:00 on `date`. Two passes settle
// the offset; New York never changes its offset at local midnight.
function newYorkMidnight(date) {
  const local=Date.parse(date+'T00:00:00Z');
  let guess=local;
  for (let pass=0;pass<2;pass++) guess=local-(wallClock(guess)-guess);
  return guess;
}

/** The most recent completed New York day the transport accepts at `at`: the
 * previous New York date, or the one before it during the first fifteen minutes
 * of a New York day, while that day's final second is still too recent. */
export function probeWindow(at) {
  const ms=Date.parse(at);
  let session=shiftDay(newYorkDate(ms),-1), end=newYorkMidnight(shiftDay(session,1))-1000;
  if (end>ms-15*60_000) { session=shiftDay(session,-1); end=newYorkMidnight(shiftDay(session,1))-1000; }
  return {session,request:{symbols:[PROBE_SYMBOL],feed:'sip',timeframe:'1Day',adjustment:'raw',asof:session,currency:'USD',start:iso(newYorkMidnight(session)),end:iso(end)}};
}

// Best effort only: the map lives in one Worker instance and resets with it.
// Returns the seconds to wait, or 0 when this probe is admitted and recorded.
const recentProbes=new Map();
function admit(map,owner,ms) {
  for (const [key,seen] of map) if (ms-seen>=PROBE_RATE_LIMIT_MS) map.delete(key);
  const last=map.get(owner);
  if (last!==undefined&&ms-last<PROBE_RATE_LIMIT_MS) return Math.ceil((PROBE_RATE_LIMIT_MS-(ms-last))/1000);
  if (map.size>=MAX_TRACKED_OWNERS) map.delete(map.keys().next().value);
  map.set(owner,ms);
  return 0;
}

export async function handleMarketDataProbeRequest(request,env={},{now=()=>new Date().toISOString(),fetchImpl=fetch,recent=recentProbes}={}) {
  const url=new URL(request.url);
  if (url.pathname!==PROBE_PATH) return fail(404,'not_found');
  const owner=request.headers.get('oai-authenticated-user-id');
  if (!owner||owner.length>512||/[\u0000-\u001f\u007f]/.test(owner)) return fail(401,'authentication_required');
  if (request.method!=='POST') return fail(405,'method_not_allowed',{allow:'POST'});
  if (request.headers.get('origin')!==url.origin||['cross-site','same-site'].includes(request.headers.get('sec-fetch-site'))) return fail(403,'same_origin_required');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||'')) return fail(415,'json_content_type_required');
  if (url.search) return fail(400,'probe_parameters_not_supported');
  const declared=request.headers.get('content-length');
  if (declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BODY_BYTES)) return fail(413,'probe_request_too_large');
  // The body is never read. Symbol, day and credentials are server-owned.
  let at;
  try { at=now(); } catch { return fail(503,'probe_unavailable'); }
  if (!utc(at)) return fail(503,'probe_unavailable');
  const wait=admit(recent,owner,Date.parse(at));
  if (wait) return fail(429,'probe_rate_limited',{'retry-after':String(wait)});
  let attempted=0,httpStatus=null;
  const observed=async(target,init)=>{attempted++;const reply=await fetchImpl(target,init);if(Number.isInteger(reply?.status)&&reply.status>=100&&reply.status<=599)httpStatus=reply.status;return reply;};
  let result=null;
  try { result=await fetchAlpacaDailyBars({...readAlpacaConfiguration(env),request:probeWindow(at).request,security:PROBE_SECURITY,captureId:'alpaca-connection-probe',at,fetchImpl:observed,clock:now}); }
  catch { /* A bounded failure below; no transport detail is returned. */ }
  const succeeded=result?.ok===true&&Array.isArray(result.series?.bars);
  const probe=succeeded?'succeeded':!attempted&&result?.status==='setup_required'?'setup_required':'failed';
  const reasons=Array.isArray(result?.reasons)?result.reasons.filter(machineCode).slice(0,MAX_REASONS):['probe_failed'];
  return response(200,{ok:true,checkedAt:at,provider:{id:'alpaca',probe,httpStatus,reasons,barsReturned:succeeded?result.series.bars.length:null,responseSha256:succeeded?result.capture.responseSha256:null}});
}
