import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,window,options} from './fixtures.mjs';
import {scoreResearchCandidate,rankResearchCandidates} from './research-score.mjs';

// All records and provider IDs are synthetic. No source acquisition or publication.
const priceReview=c=>c.research_score_review.components.find(r=>r.id==='price_action');

test('price session must be the actual latest completed session at the cutoff',()=>{
  const results=['2026-10-15','2026-10-18','2026-10-23'].map(priceSession=>{
    const c=fixture();priceReview(c).price_session=priceSession;
    const result=scoreResearchCandidate(c,window,{...options,priceSession});
    return {priceSession,status:result.status,score:result.score};
  });
  assert.ok(results.every(r=>r.status==='withheld'),JSON.stringify(results));
});

test('fresh review cannot make observations predating the price window into current prices',()=>{
  const c=fixture(),r=priceReview(c);
  r.observation_at='2026-10-15T20:00:00Z';
  r.source_available_at='2026-10-15T20:01:00Z';
  r.ingested_at='2026-10-15T20:02:00Z';
  const result=scoreResearchCandidate(c,window,options);
  assert.equal(result.status,'withheld',JSON.stringify({observation_at:r.observation_at,price_session:r.price_session,reviewed_at:r.reviewed_at,result}));
});

test('score-display permission must bind the requested owner-private audience',()=>{
  const c=fixture();
  c.research_score_review.publication_rights_review.audience='provider_internal_only';
  const result=scoreResearchCandidate(c,window,{...options,audience:'owner_private'});
  assert.equal(result.status,'withheld',JSON.stringify(result));
});

test('non-string permanent identities are withheld before ranking can call localeCompare',()=>{
  const c=fixture(123),single=scoreResearchCandidate(c,window,options);
  let rankingError=null;
  try{rankResearchCandidates([c,fixture(456)],window,options,5);}catch(error){rankingError=String(error);}
  assert.equal(single.status,'withheld',JSON.stringify({single,rankingError}));
  assert.equal(rankingError,null,'malformed IDs must not crash tied ranking');
});

test('declared component-provider omissions block publication and caller scores cannot override arithmetic',()=>{
  const c=fixture();
  priceReview(c).source_ids.push('SYNTHETIC-SECOND-PROVIDER');
  assert.equal(scoreResearchCandidate(c,window,options).status,'withheld');
  const valid=fixture();valid.research_score_review.score=100;valid.expected_return=999;valid.gain_probability=1;
  const result=scoreResearchCandidate(valid,window,options);
  assert.equal(result.score,87.5);assert.equal(result.expected_return,null);assert.equal(result.gain_probability,null);
});

test('duplicate IDs are withheld and limit-boundary ties retain one economic rank',()=>{
  const duplicates=rankResearchCandidates([fixture('A'),fixture('A')],window,options,5);
  assert.equal(duplicates.rows.length,0);assert.ok(duplicates.withheld.every(r=>r.reasons.includes('duplicate_security_id')));
  const cs=['F','E','D','C','B','A'].map(fixture);
  const result=rankResearchCandidates(cs,window,options,5);
  assert.equal(result.eligible_count,6);assert.deepEqual(result.rows.map(r=>r.security_id),['A','B','C','D','E']);
  assert.ok(result.rows.every(r=>r.research_rank===1&&r.tied_priority));
  assert.deepEqual(rankResearchCandidates(cs.toReversed(),window,options,5),result);
});

test('calendar coverage includes the cutoff-frozen holding-window exit without inventing an expiry time',()=>{
  const opts=structuredClone(options);opts.priceCalendar.validThrough=window.exit_at.slice(0,10);
  assert.equal(scoreResearchCandidate(fixture(),window,opts).status,'scored');
  for(const validThrough of ['2026-10-16','2026-10-17','2026-10-22','2027-02-30','2026-10-23T23:59:59Z']){
    opts.priceCalendar.validThrough=validThrough;
    assert.equal(scoreResearchCandidate(fixture(),window,opts).status,'withheld',validThrough);
  }
});

test('actual fractional capture clocks pass without rounding; invalid dates and hours fail',()=>{
  const c=fixture(),opts=structuredClone(options),r=priceReview(c);
  r.observation_at='2026-10-16T20:00:00.000Z';
  r.source_available_at='2026-10-16T20:01:00.123Z';
  r.ingested_at='2026-10-16T20:02:00.234Z';
  r.target_available_at=r.benchmark_available_at=r.source_available_at;
  r.target_ingested_at=r.benchmark_ingested_at=r.ingested_at;
  r.calculated_at='2026-10-16T20:03:00.345Z';
  r.reviewed_at='2026-10-17T00:23:39.000Z';
  r.measurement_start_at='2026-10-09T20:00:00.0Z';
  r.measurement_end_at='2026-10-16T20:00:00.00Z';
  opts.cutoff='2026-10-17T00:23:39.000Z';opts.at='2026-10-17T04:50:00.456Z';
  opts.priceCalendar.observedAt='2026-10-16T21:00:00.789Z';
  const result=scoreResearchCandidate(c,window,opts);
  assert.equal(result.status,'scored');assert.equal(result.source_cutoff_at,opts.cutoff);
  assert.equal(r.source_available_at,'2026-10-16T20:01:00.123Z');
  const badHour=structuredClone(c),badPrice=priceReview(badHour);
  badPrice.source_available_at='2026-10-16T24:00:00Z';badPrice.ingested_at='2026-10-17T00:01:00Z';
  assert.equal(scoreResearchCandidate(badHour,window,opts).status,'withheld');
  const badDate=structuredClone(opts);badDate.priceCalendar.observedAt='2026-02-30T12:00:00Z';
  assert.equal(scoreResearchCandidate(c,window,badDate).status,'withheld');
});
