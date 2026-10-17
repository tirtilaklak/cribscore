// Synthetic test inputs only; never imported by app code.
import assert from 'node:assert/strict';
import {serializeResearchSlate,preparePublicCase,prepareSlateMetadata,SUPPORTED_SCORE_POLICY} from '../../server/research-slate/research-slate.mjs';
export const at='2026-10-17T01:45:00.123Z',cutoff='2026-10-17T01:00:00.1Z',expiry='2026-10-18T00:00:00.12Z';
export const assessedAt='2026-10-17T01:30:00.2Z',metadataReviewedAt='2026-10-17T01:35:00.45Z',copyReviewedAt='2026-10-17T01:40:00.678Z';
const reviewExpiry='2026-10-24T00:00:00Z';
export function bindCase(input,c){
  const prepared=preparePublicCase(c);assert.equal(prepared.ok,true);
  c.public_review={state:'reviewed',audience:'owner_private',review_id:'SYNTHETIC-REVIEW',security_id:c.security_id,...input.window,
    source_cutoff_at:input.sourceCutoffAt,reviewed_at:copyReviewedAt,expires_at:reviewExpiry,content_sha256:prepared.sha256};
  return c;
}
export function bindMetadata(input){
  const prepared=prepareSlateMetadata(input.slateMetadata);assert.equal(prepared.ok,true);
  input.slateMetadata.review={state:'reviewed',audience:'owner_private',review_id:'SYNTHETIC-METADATA-REVIEW',...input.window,
    source_cutoff_at:input.sourceCutoffAt,reviewed_at:metadataReviewedAt,expires_at:reviewExpiry,content_sha256:prepared.sha256};
  return input;
}
export function fixture(scores=[75,75,50],horizonId='next_week'){
  const window={horizon_id:horizonId,entry_at:'2026-10-19T13:30:00Z',exit_at:horizonId==='next_day'?'2026-10-19T20:00:00Z':'2026-10-23T20:00:00Z'};
  const input={at,sourceCutoffAt:cutoff,window,displayExpiresAt:expiry,
    displayBounds:{authorization_expires_at:reviewExpiry,entitlement_expires_at:reviewExpiry,derived_review_expires_at:reviewExpiry,score_review_expires_at:reviewExpiry},
    assessmentContext:{universe_version:'SYNTHETIC-US-v2',assessed_at:assessedAt,price_session:{date:'2026-10-16',closed_at:'2026-10-16T20:00:00Z'}},
    slateMetadata:{universe_version:'SYNTHETIC-US-v2',counts:{roster:24,screened:scores.length+2,blocked:2,eligible:scores.length},
      price_session:{date:'2026-10-16',closed_at:'2026-10-16T20:00:00Z'},source_health:{state:'partial_at_cutoff',label:'Some roster sources remain incomplete; admitted cases were reviewed.'}},
    scorerResult:{policy_version:SUPPORTED_SCORE_POLICY,audience:'owner_private',predictive_status:'unvalidated',ranking_basis:'reviewed_research_evidence',limit:10,
      eligible_count:scores.length,withheld:[{security_id:'SYNTHETIC-BLOCKED-1',status:'withheld'},{security_id:'SYNTHETIC-BLOCKED-2',status:'withheld'}],
      rows:scores.map((score,i)=>({security_id:'SYNTHETIC-'+i,policy_version:SUPPORTED_SCORE_POLICY,audience:'owner_private',status:'scored',predictive_status:'unvalidated',
        expected_return:null,gain_probability:null,score,...window,source_cutoff_at:cutoff,research_rank:scores.indexOf(score)+1,display_order:i+1,tied_priority:scores.filter(value=>value===score).length>1}))}};
  input.publicCases=scores.map((_,i)=>{
    const source_url='https://investors.example.com/reports/'+i;
    return bindCase(input,{security_id:'SYNTHETIC-'+i,ticker:String.fromCharCode(65+i).repeat(3),company:'Synthetic Company '+i,
      thesis:'Improving operations could support this conditional case.',downside:'Weak demand would undermine the case.',
      invalidation_trigger:'Withdraw this case if the next report cuts full-year revenue guidance.',
      catalyst:{label:'Synthetic earnings webcast',kind:'scheduled_event',timing:{precision:'exact',at:'2026-10-20T20:45:00Z'},source_url},sources:[{label:'Issuer event page',url:source_url}]});
  });
  return bindMetadata(input);
}
export function proposal(scores,horizonId){const result=serializeResearchSlate(fixture(scores,horizonId));assert.equal(result.ok,true);return result;}
