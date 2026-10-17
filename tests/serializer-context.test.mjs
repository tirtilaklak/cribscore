// Synthetic context joins only; no company/source statements are actual reviews.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,options,window} from '../server/research-score/fixtures.mjs';
import {rankResearchCandidates} from '../server/research-score/research-score.mjs';
import {serializeResearchSlate,preparePublicCase,prepareSlateMetadata} from '../server/research-slate/research-slate.mjs';
const metadataAt='2026-10-17T04:51:00.123Z',copyAt='2026-10-17T04:52:00.234Z',serializerAt='2026-10-17T04:53:00.345Z',expires='2026-10-24T00:00:00Z';
function bindMetadata(input){
 const prepared=prepareSlateMetadata(input.slateMetadata);assert.equal(prepared.ok,true);
 input.slateMetadata.review={state:'reviewed',audience:'owner_private',review_id:'SYNTHETIC-context-metadata-review',
  ...input.window,source_cutoff_at:input.sourceCutoffAt,reviewed_at:metadataAt,expires_at:expires,content_sha256:prepared.sha256};
 return input;
}
function context(){
 const candidate=fixture('SYNTHETIC-context'),scorerResult=rankResearchCandidates([candidate],window,options);
 assert.equal(scorerResult.rows.length,1);
 const value={security_id:candidate.security_id,ticker:'SYNTHETIC',company:'Synthetic Company',thesis:'Synthetic reviewed operating case.',downside:'Synthetic reviewed downside.',
  invalidation_trigger:'Withdraw this synthetic case if the next report cuts full-year revenue guidance.',
  catalyst:{label:'Synthetic confirmed event',kind:'scheduled_event',timing:{precision:'exact',at:'2026-10-20T20:45:00Z'},source_url:'https://investors.example.com/synthetic'},
  sources:[{label:'Synthetic source',url:'https://investors.example.com/synthetic'}]};
 const prepared=preparePublicCase(value);assert.equal(prepared.ok,true);
 value.public_review={state:'reviewed',audience:'owner_private',review_id:'SYNTHETIC-public-case-review',security_id:candidate.security_id,
  ...window,source_cutoff_at:options.cutoff,reviewed_at:copyAt,expires_at:expires,content_sha256:prepared.sha256};
 // Record the supplied invocation clock and endpoint from that scorer's actual
 // reviewed calendar. Do not manufacture a close or derive assessment from review.
 const endpoint=options.priceCalendar.sessions.filter(s=>Date.parse(s.closeAt)<=Date.parse(options.cutoff)).at(-1);
 const price_session={date:endpoint.date,closed_at:endpoint.closeAt};
 return bindMetadata({scorerResult,publicCases:[value],window,sourceCutoffAt:options.cutoff,at:serializerAt,displayExpiresAt:'2026-10-18T00:00:00Z',
  displayBounds:{authorization_expires_at:expires,entitlement_expires_at:expires,derived_review_expires_at:expires,score_review_expires_at:expires},
  assessmentContext:{universe_version:'SYNTHETIC-context-v2',assessed_at:options.at,price_session:{...price_session}},
  slateMetadata:{universe_version:'SYNTHETIC-context-v2',counts:{roster:1,screened:1,blocked:scorerResult.withheld.length,eligible:scorerResult.eligible_count},
   price_session,source_health:{state:'reviewed_at_cutoff',label:'Synthetic single-case source review at cutoff.'}}});
}
test('canonical scorer and serializer share exact horizon/cutoff/audience with later presentation review and no raw lineage',()=>{
 const c=context(),r=serializeResearchSlate(c);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.status,'review_required');
 const payload=JSON.parse(r.serialized);assert.equal(payload.rows.length,1);assert.equal(payload.rows[0].research_score,87.5);assert.equal(payload.audience,'owner_private');
 assert.equal(payload.rows[0].tied_priority,false);assert.deepEqual(payload.metadata.counts,{roster:1,screened:1,blocked:0,eligible:1});
 assert.equal(payload.generated_at,serializerAt);assert.equal(payload.source_cutoff_at,options.cutoff);
 assert.ok(Date.parse(options.cutoff)<Date.parse(options.at)&&Date.parse(options.at)<Date.parse(metadataAt)&&Date.parse(metadataAt)<Date.parse(copyAt)&&Date.parse(copyAt)<Date.parse(serializerAt));
 assert.doesNotMatch(r.serialized,/security_id|source_ids|source_refs|responseSha256|ingestedAt|expected_return|gain_probability|components|"assessed_at"|"reviewed_at"|content_sha256/);
});
test('exact-string binding is enforced first by metadata review, then independently by each scored row',()=>{
 const c=context();c.sourceCutoffAt=c.sourceCutoffAt.replace('Z','.000Z');
 const staleMetadata=serializeResearchSlate(c);assert.equal(staleMetadata.ok,false);assert.deepEqual(staleMetadata.reasons,['slate_metadata_review_invalid']);
 // A separately rebound presentation review does not rebind the original scorer row.
 bindMetadata(c);
 const r=serializeResearchSlate(c);assert.equal(r.ok,true);assert.equal(JSON.parse(r.serialized).rows.length,0);
 assert.equal(r.withheld[0].reason,'scored_row_contract_invalid');
});
test('serializer cannot invent missing score-review deadlines from scored rows',()=>{
 const c=context();assert.equal(Object.hasOwn(c.scorerResult.rows[0],'expires_at'),false);
 delete c.displayBounds.score_review_expires_at;const r=serializeResearchSlate(c);assert.equal(r.ok,false);assert.deepEqual(r.reasons,['display_expiry_invalid']);
});
test('unknown exact catalyst timing is withheld rather than using price capture or midnight',()=>{
 const c=context();c.publicCases[0].catalyst.timing.at=null;assert.equal(preparePublicCase(c.publicCases[0]).ok,false);
 const r=serializeResearchSlate(c);assert.equal(r.ok,true);assert.equal(JSON.parse(r.serialized).rows.length,0);
 assert.equal(r.withheld[0].reason,'public_catalyst_invalid');
});
