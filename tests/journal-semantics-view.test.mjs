import test from 'node:test';
import assert from 'node:assert/strict';
import {renderJournalView} from '../dist/lib/journal-view.js';
const model=()=>({settings:{currency:'USD',paperNotional:'100.000000',commissionPerFill:'0.000000',slippageBps:5,benchmarkSymbol:'SPY'},storage:{state:'unsaved',message:'Synthetic unit test'},summary:{decisions:1,abstentions:0,pending:0,open:0,closed:0,noFill:1,actualConfirmations:1},entries:[{id:'test',date:'2026-10-17',symbol:'TEST',company:'Test fixture',status:'no_fill',horizonId:'next_day',reason:'Paper no fill',context:{},paper:null,actual:{confirmed:true,confirmedAt:'2026-10-17T15:00:00Z',realizedPnl:'1.000000',realizedTradingPnl:'1.000000',dividendAccrual:'0.250000',totalPnl:'1.250000',openPnl:null,fills:[{id:'fill',side:'buy',quantity:'1.000000',price:'10.000000',fee:'0.000000',occurredAt:'2026-10-17T14:00:00Z'}]},revisions:[]}],assumptions:[]});
test('confirmed actual record survives an unavailable or no-fill paper result',()=>{
  const html=renderJournalView(model());
  assert.match(html,/No fill/);assert.match(html,/Actual · confirmed by you/);assert.match(html,/USD 1.25/);
  assert.match(html,/data-journal-form="revise-fill"/);assert.doesNotMatch(html,/data-journal-action="confirm-actual"/);
  assert.match(html,/Realized trading P&amp;L<\/dt><dd>USD 1/);assert.match(html,/Dividend accrual<\/dt><dd>USD 0.25/);
  assert.match(html,/not confirmation of cash payment/);
});
test('commissions and slippage semantics stay distinct and dividend components remain inspectable',()=>{
  const m=model();m.entries[0].paper={status:'closed',quantity:'1.000000',entryPrice:'10.005000',exitPrice:'10.994500',costs:'0.010500',commissionCosts:'0.000000',slippageCosts:'0.010500',realizedPnl:'0.989500',realizedTradingPnl:'0.989500',dividendAccrual:'0.250000',totalPnl:'1.239500',openPnl:null,benchmarkPnl:null,excessPnl:null,pendingReasons:[],assumptions:{...m.settings},budgetPolicy:'Entry costs included; quantity rounded down to eight decimals.'};
  const html=renderJournalView(m);
  assert.match(html,/Commissions<\/dt><dd>USD 0/);assert.doesNotMatch(html,/<dt>Costs<\/dt>/);
  assert.match(html,/Paper fill prices include assumed slippage/);assert.match(html,/may be paid later/);
  assert.match(html,/USD 0.9895/);assert.match(html,/USD 0.25/);assert.match(html,/Entry costs included/);
});
