import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCandidate} from '../../dist/lib/candidates.js';
import {fixture,window,options} from './fixtures.mjs';
import {scoreResearchCandidate,rankResearchCandidates} from './research-score.mjs';

// All candidates, clocks, reviews and sources are synthetic. These checks establish
// readable required fields, never the truth or financial sufficiency of their prose.
const unreadable=[undefined,null,false,1,{},[],'',' \n\t ','\u200b','\u0000\u0007\u0085','\u200c\u200d\u2060\ufe0f','\u115f\u3164'];
const visible='\u200c改善条件：営業利益と資金繰りを確認。\u200d';
function routeA(){
  const candidate=fixture();delete candidate.catalyst;
  candidate.research_score_review.components.find(r=>r.id==='catalyst').rating='none_or_known';
  const review={reviewer_id:'SYNTHETIC-REVIEWER',source_refs:['SYNTHETIC'],reviewed_at:options.cutoff,expires_at:'2026-10-24T00:00:00Z'};
  candidate.guidance={before_basis:'adjusted_diluted_eps',after_basis:'adjusted_diluted_eps',before_period:'FY2026',after_period:'FY2026',currency:'USD',before_currency:'USD',after_currency:'USD',eps_before:1,eps_after:1.1,revenue_before:100,revenue_after:101,operating_explanation:'SYNTHETIC operating improvement',adjustments_reconciled:true,source_refs:['SYNTHETIC'],published_interval:{start:'2026-10-16T20:30:00Z',end:'2026-10-16T20:30:00Z'},metric_review:{...review,metric:'diluted_eps',share_class_id:'SYNTHETIC-CLASS',before_share_basis:'diluted-class',after_share_basis:'diluted-class',effective_at:'2026-10-01T00:00:00Z'},operating_driver_review:{...review,status:'verified_operating_contribution',solely_non_operating:false}};
  const assessedWith={...options,completedSessions:options.priceCalendar.sessions.map(s=>({open:s.openAt,close:s.closeAt})),completedSessionCoverage:{state:'complete',from:'2026-10-09T00:00:00Z',through:options.cutoff,reviewed_at:options.cutoff,source_refs:['SYNTHETIC-CALENDAR'],session_count:6}};
  return {candidate,assessedWith};
}

test('missing readable thesis, counter-case or invalidation cannot receive a research score or rank',()=>{
  assert.equal(scoreResearchCandidate(fixture(),window,options).status,'scored');
  for(const field of ['positive_case','counter_case','invalidation_trigger'])for(const value of unreadable){
    const c=fixture();c[field]=value;
    const result=scoreResearchCandidate(c,window,options);
    assert.equal(result.status,'withheld',`${field}: ${JSON.stringify(value)}`);
    assert.equal(result.score,null);assert.ok(result.reasons.includes('mechanism_incomplete'));
    assert.equal(rankResearchCandidates([c],window,options,5).rows.length,0);
  }
});

test('route B requires readable expected information, favorable/adverse tests and company reference',()=>{
  assert.equal(classifyCandidate(fixture(),window,options).route,'B');
  for(const field of ['expected_information','positive','adverse','company_reference'])for(const value of unreadable){
    const c=fixture();c.catalyst[field]=value;
    const result=classifyCandidate(c,window,options);
    assert.equal(result.eligible,false,`${field}: ${JSON.stringify(value)}`);
    assert.ok(result.reasons.includes('no_qualifying_route'));
  }
});

test('route A requires readable operating explanation even when typed metric/driver reviews pass',()=>{
  const control=routeA();assert.equal(classifyCandidate(control.candidate,window,control.assessedWith).route,'A');
  assert.equal(scoreResearchCandidate(control.candidate,window,control.assessedWith).status,'scored');
  for(const value of unreadable){
    const {candidate,assessedWith}=routeA();candidate.guidance.operating_explanation=value;
    const result=scoreResearchCandidate(candidate,window,assessedWith);
    assert.equal(result.status,'withheld',JSON.stringify(value));assert.ok(result.reasons.includes('no_qualifying_route'));
  }
});

test('component rationales and directional macro transmission cannot be invisible placeholders',()=>{
  for(const field of ['fundamentals','catalyst','price_action','macro'])for(const value of unreadable){
    const c=fixture();c.research_score_review.components.find(r=>r.id===field).rationale=value;
    const result=scoreResearchCandidate(c,window,options);
    assert.equal(result.status,'withheld',`${field}: ${JSON.stringify(value)}`);assert.ok(result.reasons.includes(`${field}_review_invalid`));
  }
  for(const rating of ['headwind','tailwind'])for(const value of unreadable){
    const c=fixture(),r=c.research_score_review.components.find(r=>r.id==='macro');r.rating=rating;r.company_transmission=value;
    const result=scoreResearchCandidate(c,window,options);
    assert.equal(result.status,'withheld',`${rating}: ${JSON.stringify(value)}`);assert.ok(result.reasons.includes('macro_company_transmission_required'));
  }
});

test('valid route A cannot bypass unreadable prose when awarding future-catalyst credit',()=>{
  for(const [rating,fields] of [['confirmed_two_sided',['positive','adverse']],['incremental_company_test',['expected_information','company_reference']]])for(const field of fields){
    const {candidate,assessedWith}=routeA();candidate.catalyst=fixture().catalyst;
    candidate.research_score_review.components.find(r=>r.id==='catalyst').rating=rating;
    assert.equal(scoreResearchCandidate(candidate,window,assessedWith).status,'scored');
    candidate.catalyst[field]='\u200b';
    const result=scoreResearchCandidate(candidate,window,assessedWith);
    assert.equal(result.status,'withheld',`${rating}: ${field}`);
    assert.ok(result.reasons.includes(rating==='confirmed_two_sided'?'catalyst_not_confirmed_in_window':'incremental_information_unreviewed'));
  }
});

test('visible multilingual prose and meaningful joiners remain valid without rewriting input',()=>{
  const c=fixture();
  for(const field of ['positive_case','counter_case','invalidation_trigger'])c[field]=visible;
  for(const field of ['expected_information','positive','adverse','company_reference'])c.catalyst[field]=visible;
  for(const r of c.research_score_review.components)r.rationale=visible;
  const macro=c.research_score_review.components.find(r=>r.id==='macro');macro.rating='tailwind';macro.company_transmission=visible;
  const before=structuredClone(c),result=scoreResearchCandidate(c,window,options);
  assert.equal(result.status,'scored');assert.equal(result.score,100);assert.deepEqual(c,before);
  const {candidate,assessedWith}=routeA();candidate.guidance.operating_explanation=visible;
  assert.equal(classifyCandidate(candidate,window,assessedWith).route,'A');
});
