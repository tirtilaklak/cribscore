// Synthetic offline benchmark comparisons; no provider or owner data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournal,enrollPublication,evaluatePaper,revisePaperEvaluation,projectJournal,validateJournal,checkAppendOnly,DEFAULT_PAPER_SETTINGS} from '../dist/lib/journal.js';
import {resolvePaperWindow,resolvePriceMark} from '../dist/lib/prices.js';
import {calendar,publication,price,review,START,PUBLISHED,ENROLL} from './fixtures/journal-observer.mjs';

const at='2026-12-01T22:10:00Z',revisedAt='2026-12-01T22:11:00Z',cal=calendar(),resolvers={resolvePaperWindow,resolvePriceMark};
const windowResolution=resolvePaperWindow({publishedAt:PUBLISHED,horizonSessions:5,calendar:cal,at:ENROLL});
const own=price('AAA'),benchmark=price('SPY'),seriesBySymbol={AAA:own,SPY:benchmark},reviewsBySymbol={AAA:review(own),SPY:review(benchmark)};
async function completed() {
 let result=await enrollPublication(createJournal({journalId:'synthetic-benchmark-boundary',at:START}),{id:'week',at:ENROLL,publication:publication({horizon:'next_week'}),windowResolution,settings:{...DEFAULT_PAPER_SETTINGS,slippageBps:0,benchmarkEntityId:'synthetic-SPY'}});
 assert.equal(result.ok,true,JSON.stringify(result));
 result=await evaluatePaper(result.journal,{at,eventIdPrefix:'complete',calendar:cal,seriesBySymbol,reviewsBySymbol,resolvers});assert.equal(result.ok,true,JSON.stringify(result));return result.journal;
}
function interim(input,symbol,session) {
 const resolved=resolvePriceMark(seriesBySymbol[symbol],{session,kind:'close',calendar:cal,review:reviewsBySymbol[symbol],window:windowResolution.window,at});
 assert.equal(resolved.status,'available',JSON.stringify(resolved));
 input.exitMark=null;input.mark=resolved.mark;input.actions=resolved.actions;
}
async function revise(journal,change) {
 const original=journal.events.at(-1),replacement=structuredClone(original.data);change(replacement);
 const result=await revisePaperEvaluation(journal,{id:'reviewed-correction',at:revisedAt,evaluationId:original.id,replacement,reason:'Synthetic correction retains only the reviewed observations.'});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal((await validateJournal(result.journal)).ok,true);assert.equal(checkAppendOnly(journal,result.journal).ok,true);return result.journal;
}

test('a closed own holding cannot compare against an earlier interim benchmark',async()=>{
 const journal=await completed(),corrected=await revise(journal,data=>{interim(data.benchmark,'SPY','2026-11-30');data.reasons=['benchmark_exit_pending'];});
 const paper=projectJournal(corrected).entries[0].paper;
 assert.equal(paper.status,'closed');assert.equal(paper.totalPnl,'5.000000');
 assert.equal(paper.benchmarkPnl,null);assert.equal(paper.excessPnl,null);
 const restored=await evaluatePaper(corrected,{at:'2026-12-01T22:12:00Z',eventIdPrefix:'benchmark-arrived',calendar:cal,seriesBySymbol,reviewsBySymbol,resolvers});
 assert.equal(restored.ok,true,JSON.stringify(restored));
 const complete=projectJournal(restored.journal).entries[0].paper;
 assert.equal(complete.totalPnl,'5.000000');assert.equal(complete.benchmarkPnl,'5.000000');assert.equal(complete.excessPnl,'0.000000');
 assert.deepEqual(restored.journal.events.at(-1).data.exitMark,journal.events.at(-1).data.exitMark);
});

test('two open holdings with different interim sessions cannot claim same-window performance',async()=>{
 const corrected=await revise(await completed(),data=>{interim(data,'AAA','2026-11-30');interim(data.benchmark,'SPY','2026-11-27');});
 const paper=projectJournal(corrected).entries[0].paper;
 assert.equal(paper.status,'open');assert.equal(paper.totalPnl,'4.000000');assert.equal(paper.benchmarkPnl,null);assert.equal(paper.excessPnl,null);
});

test('matching timestamps do not equate a closed own holding with an unclosed benchmark',async()=>{
 const corrected=await revise(await completed(),data=>interim(data.benchmark,'SPY','2026-12-01'));
 const paper=projectJournal(corrected).entries[0].paper;
 assert.equal(paper.status,'closed');assert.equal(paper.totalPnl,'5.000000');assert.equal(paper.benchmarkPnl,null);assert.equal(paper.excessPnl,null);
});

test('matching open marks with shortened action intervals retain comparable performance',async()=>{
 const corrected=await revise(await completed(),data=>{interim(data,'AAA','2026-11-30');interim(data.benchmark,'SPY','2026-11-30');});
 const data=corrected.events.at(-1).data.replacement,paper=projectJournal(corrected).entries[0].paper;
 assert.equal(data.actions.throughSession,'2026-11-30');assert.equal(data.benchmark.actions.throughSession,'2026-11-30');
 assert.equal(paper.status,'open');assert.equal(paper.totalPnl,'4.000000');assert.equal(paper.benchmarkPnl,'4.000000');assert.equal(paper.excessPnl,'0.000000');
});

test('either missing valuation endpoint keeps benchmark comparison unavailable',async()=>{
 for(const missing of ['own','benchmark']) {
  const corrected=await revise(await completed(),data=>{const input=missing==='own'?data:data.benchmark;input.exitMark=null;input.mark=null;});
  const paper=projectJournal(corrected).entries[0].paper;
  assert.equal(paper.totalPnl,missing==='own'?null:'5.000000');
  assert.equal(paper.benchmarkPnl,null);assert.equal(paper.excessPnl,null);
 }
});
