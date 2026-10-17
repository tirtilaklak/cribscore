// Wholly synthetic reviewed-calendar binding. No fetch or real permission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,window as week,options} from './fixtures.mjs';
import {scoreResearchCandidate} from './research-score.mjs';
const day={...week,horizon_id:'next_day',exit_at:'2026-10-19T20:00:00Z'};
function score(window,eventAt,opts=structuredClone(options)){
 const c=fixture();c.catalyst.interval={start:eventAt};
 for(const r of c.research_score_review.components)Object.assign(r,window,{source_cutoff_at:opts.cutoff});
 return scoreResearchCandidate(c,window,opts);
}
test('one and five-session controls use exact supplied open/close endpoints',()=>{
 assert.equal(score(day,'2026-10-19T15:00:00Z').status,'scored');
 assert.equal(score(week,'2026-10-20T20:45:00Z').status,'scored');
});
test('horizon labels cannot disagree with endpoint count or skip the first future session',()=>{
 for(const [window,eventAt] of [
  [{...week,horizon_id:'next_day'},'2026-10-20T20:45:00Z'],
  [{...day,horizon_id:'next_week'},'2026-10-19T15:00:00Z'],
  [{horizon_id:'next_day',entry_at:'2026-10-20T13:30:00Z',exit_at:'2026-10-20T20:00:00Z'},'2026-10-20T15:00:00Z'],
 ])assert.ok(score(window,eventAt).reasons.includes('holding_window_calendar_mismatch'));
});
test('fifth-session early close is preserved without a market-close constant',()=>{
 const opts=structuredClone(options);opts.priceCalendar.sessions.find(s=>s.date==='2026-10-23').closeAt='2026-10-23T17:00:00Z';
 assert.equal(score({...week,exit_at:'2026-10-23T17:00:00Z'},'2026-10-20T15:00:00Z',opts).status,'scored');
 assert.ok(score(week,'2026-10-20T15:00:00Z',opts).reasons.includes('holding_window_calendar_mismatch'));
});
test('insufficient supplied future sessions never become an assumed five-session week',()=>{
 const opts=structuredClone(options);opts.priceCalendar.sessions=opts.priceCalendar.sessions.filter(s=>s.date!=='2026-10-20');
 assert.ok(score(week,'2026-10-21T15:00:00Z',opts).reasons.includes('holding_window_calendar_mismatch'));
});
test('cutoff equal to a supplied open selects the strictly later session',()=>{
 const opts=structuredClone(options);opts.cutoff='2026-10-19T13:30:00Z';opts.at='2026-10-19T13:30:00.001Z';
 const next={horizon_id:'next_day',entry_at:'2026-10-20T13:30:00Z',exit_at:'2026-10-20T20:00:00Z'};
 assert.equal(score(next,'2026-10-20T15:00:00Z',opts).status,'scored');
});
test('a delayed assessment cannot roll a frozen missed entry into tomorrow',()=>{
 const opts=structuredClone(options);opts.cutoff='2026-10-19T13:29:59.999Z';opts.at='2026-10-19T13:30:00.001Z';
 assert.ok(score(day,'2026-10-19T15:00:00Z',opts).reasons.includes('window_not_upcoming'));
 const next={horizon_id:'next_day',entry_at:'2026-10-20T13:30:00Z',exit_at:'2026-10-20T20:00:00Z'};
 assert.ok(score(next,'2026-10-20T15:00:00Z',opts).reasons.includes('holding_window_calendar_mismatch'));
});
