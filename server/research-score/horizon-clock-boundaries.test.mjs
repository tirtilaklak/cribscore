// Independent offline combinations. Every security, calendar and review is synthetic.
// Portable independent regression against the reviewed production scorer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,options as originalOptions,window as originalWindow} from './fixtures.mjs';
const {scoreResearchCandidate}=await import('./research-score.mjs');

function assess(window,options){
 const candidate=fixture('SYNTHETIC-clock-combination');
 for(const record of candidate.research_score_review.components)Object.assign(record,window,{source_cutoff_at:options.cutoff});
 return scoreResearchCandidate(candidate,window,options);
}
const cloneOptions=()=>structuredClone(originalOptions);
const addMonday=options=>{
 options.priceCalendar.sessions.push({date:'2026-10-26',openAt:'2026-10-26T13:30:00Z',closeAt:'2026-10-26T20:00:00Z'});
 options.priceCalendar.validThrough='2026-10-27';
};

test('reviewed early close governs the fifth exit, including when review records repeat an incorrect regular close',()=>{
 const options=cloneOptions();options.priceCalendar.sessions.at(-1).closeAt='2026-10-23T18:00:00Z';
 const valid={...originalWindow,exit_at:'2026-10-23T18:00:00Z'};
 assert.equal(assess(valid,options).status,'scored','positive control uses the actual supplied early close');
 const wrong=assess(originalWindow,options);
 assert.equal(wrong.status,'withheld',JSON.stringify({calendarExit:valid.exit_at,claimedExit:originalWindow.exit_at,result:wrong}));
});

test('five sessions follow the explicit calendar across a missing date without a weekday inference',()=>{
 const options=cloneOptions();options.priceCalendar.sessions=options.priceCalendar.sessions.filter(s=>s.date!=='2026-10-21');addMonday(options);
 const valid={...originalWindow,exit_at:'2026-10-26T20:00:00Z'};
 assert.equal(assess(valid,options).status,'scored','five supplied future sessions end on the following Monday');
 const wrong=assess(originalWindow,options);
 assert.equal(wrong.status,'withheld',JSON.stringify({futureSessionDates:options.priceCalendar.sessions.filter(s=>s.date>'2026-10-17').map(s=>s.date),result:wrong}));
});

test('a frozen cutoff cannot silently roll past an opening crossed before assessment',()=>{
 const options=cloneOptions();addMonday(options);
 options.at='2026-10-19T13:30:00.001Z';options.cutoff='2026-10-19T13:30:00Z';
 const following={...originalWindow,entry_at:'2026-10-20T13:30:00Z',exit_at:'2026-10-26T20:00:00Z'};
 assert.equal(assess(following,options).status,'scored','cutoff exactly at open follows the established strictly-later-open rule');
 options.cutoff='2026-10-19T13:29:59.999Z';
 const wrong=assess(following,options);
 assert.equal(wrong.status,'withheld',JSON.stringify({cutoff:options.cutoff,at:options.at,result:wrong}));
});

test('future session rows beyond the reviewed inclusive calendar coverage cannot establish the holding window',()=>{
 const options=cloneOptions();options.priceCalendar.validThrough='2026-10-23';
 assert.equal(assess(originalWindow,options).status,'scored','coverage exactly through the exit date is sufficient');
 for(const validThrough of ['2026-10-17','2026-10-22']){
  options.priceCalendar.validThrough=validThrough;
  const wrong=assess(originalWindow,options);
  assert.equal(wrong.status,'withheld',JSON.stringify({validThrough,exit:originalWindow.exit_at,result:wrong}));
 }
});
