// Synthetic review-contract checks. No provider permission, economic review or live score.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,window,options} from './fixtures.mjs';
import {PRICE_REVIEW_POLICY,scoreResearchCandidate} from './research-score.mjs';
const price=c=>c.research_score_review.components.find(r=>r.id==='price_action');
const score=c=>scoreResearchCandidate(c,window,options);

test('price review binds the declared zero-tolerance calculation and independently reviewed grade',()=>{
 const c=fixture(),r=price(c);assert.equal(score(c).status,'scored');
 for(const key of Object.keys(PRICE_REVIEW_POLICY)) {
  const changed=structuredClone(c);delete price(changed)[key];
  assert.equal(score(changed).status,'withheld',key);
 }
 for(const edit of [r=>r.tolerance_bps=10,r=>r.grade_rule_version='absolute-and-relative-sign-tolerance-v1',r=>r.calculated_grade='weak',r=>r.calculation_record_id='']) {
  const changed=structuredClone(c);edit(price(changed));assert.equal(score(changed).status,'withheld');
 }
 r.rating='mixed';r.calculated_grade='mixed';assert.equal(score(c).score,75);
});

test('target and benchmark require distinct captured snapshots and a distinct benchmark security',()=>{
 for(const edit of [r=>r.benchmark_snapshot_id=r.target_snapshot_id,r=>r.target_snapshot_id='',r=>r.benchmark_snapshot_id='',(r,c)=>r.benchmark_id=c.security_id]) {
  const c=fixture();edit(price(c),c);assert.equal(score(c).status,'withheld');
 }
});

test('benchmark source cannot disappear between calculation review and publication rights',()=>{
 const c=fixture(),r=price(c);r.benchmark_source_ids=['SYNTHETIC-OTHER-PROVIDER'];
 assert.equal(score(c).status,'withheld');
 r.source_ids.push('SYNTHETIC-OTHER-PROVIDER');assert.equal(score(c).status,'withheld');
 c.research_score_review.publication_rights_review.source_ids.push('SYNTHETIC-OTHER-PROVIDER');
 assert.equal(score(c).status,'scored');
});

test('missing or duplicated source bindings withhold instead of inventing calculation lineage',()=>{
 for(const edit of [r=>r.target_source_ids=[],r=>r.benchmark_source_ids=[],r=>delete r.calculated_grade,r=>r.target_source_ids=['SYNTHETIC-SOURCE','SYNTHETIC-SOURCE']]) {
  const c=fixture();edit(price(c));const result=score(c);
  assert.equal(result.status,'withheld');assert.equal(result.score,null);
 }
});
