import { inspectAlpacaSetup } from './alpaca-daily.mjs';

const utc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);
const response = (status, body, extra = {}) => new Response(JSON.stringify(body), {status, headers:{
  'content-type':'application/json; charset=utf-8', 'cache-control':'private, no-store',
  vary:'oai-authenticated-user-id', 'x-content-type-options':'nosniff', ...extra,
}});

// Runtime configuration is server-owned. This endpoint accepts no credentials,
// source approvals or price requests from browser input and performs no fetch.
export function handleMarketDataSetupRequest(request, env = {}, {now = () => new Date().toISOString()} = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/market-data/setup') return response(404, {ok:false,error:'not_found'});
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner || owner.length > 512 || /[\u0000-\u001f\u007f]/.test(owner)) return response(401, {ok:false,error:'authentication_required'});
  if (request.method !== 'GET') return response(405, {ok:false,error:'method_not_allowed'}, {allow:'GET'});
  if (url.search) return response(400, {ok:false,error:'setup_parameters_not_supported'});
  let at;
  try { at = now(); } catch { return response(503, {ok:false,error:'setup_status_unavailable'}); }
  if (!utc(at)) return response(503, {ok:false,error:'setup_status_unavailable'});
  let authorization;
  const encoded = env.ALPACA_DATA_AUTHORIZATION_JSON;
  if (typeof encoded === 'string' && encoded.length <= 30_000) {
    try { authorization = JSON.parse(encoded); } catch { /* Report missing setup without returning configuration. */ }
  }
  const status = inspectAlpacaSetup({credentials:{keyId:env.ALPACA_API_KEY_ID,secretKey:env.ALPACA_API_SECRET_KEY},authorization,at});
  return response(200, {ok:true,checkedAt:at,provider:{
    id:'alpaca',status:status.status,reasons:[...status.reasons],connectionVerified:false,
    captureEnabled:false,displayEnabled:false,journalPricesEnabled:false,
  }});
}
