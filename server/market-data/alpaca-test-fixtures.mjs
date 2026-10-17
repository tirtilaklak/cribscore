import {ALPACA_TERMS} from './alpaca-daily.mjs';
// SYNTHETIC ONLY: these are not keys, rights approvals, securities or observations.
export const at='2026-10-17T12:00:00.123Z', done='2026-10-17T12:00:00.456Z';
const window={reviewedAt:'2026-10-17T10:00:00Z',expiresAt:'2026-10-18T00:00:00Z'};
export function syntheticAlpacaOptions() {
  let tick=0;
  return {at,clock:()=>tick++?done:at,captureId:'SYNTHETIC-ALPACA-TEST',
    credentials:{keyId:'SYNTHETIC-KEY-ID-NOT-REAL',secretKey:'SYNTHETIC-SECRET-NOT-REAL'},
    authorization:{schemaVersion:'cribscore-alpaca-rights-v1',provider:'alpaca',dataset:'historical-stock-bars',feed:'sip',approved:true,reviewId:'SYNTHETIC-NOT-PERMISSION',...window,operations:['fetch','normalize'],audience:'owner_private',terms:{url:ALPACA_TERMS,sha256:'a'.repeat(64),evidenceId:'SYNTHETIC-TERMS-HASH',reviewedAt:window.reviewedAt},sourceRights:{...window,approved:true,providerAndExchangeTermsReviewed:true,scope:'delayed_sip_historical_personal_research',evidenceId:'SYNTHETIC-SOURCE-RIGHTS'},entitlement:{...window,active:true,delayedSipHistorical:true,evidenceId:'SYNTHETIC-ENTITLEMENT'}},
    request:{symbols:['TEST'],feed:'sip',timeframe:'1Day',adjustment:'raw',asof:'2026-10-16',currency:'USD',start:'2026-10-16T04:00:00Z',end:'2026-10-17T03:59:59Z'},
    security:{symbol:'TEST',originalSymbol:'TEST',entityId:'SYNTHETIC-PERMANENT-ID',currency:'USD',exchange:'NYSE',sessionTimezone:'America/New_York'}};
}
