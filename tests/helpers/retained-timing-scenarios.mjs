import assert from 'node:assert/strict';
import {boot,stock} from './continued-stock-harness.mjs';
const scenarios={
  async 'shifted-offset-window-retains-precise-utc'(){
    const shifted=structuredClone(stock);Object.assign(shifted.event_evidence.horizons,{entry_at_utc:'2026-10-26T09:30:15.250-04:00',day_exit_at_utc:'2026-10-26T16:00:45.750-04:00',week_exit_at_utc:'2026-10-30T16:00:00-04:00'});
    const before=JSON.stringify(shifted);const app=await boot({stockPayload:shifted});app.click(app.query('[data-view="evidence"]'));app.click(app.query('[data-detail="timing"]'));let content=app.query('#detail-content').textContent;
    assert.match(content,/2026-10-26 13:30:15\.250 UTC/);assert.match(content,/2026-10-26 20:00:45\.750 UTC/);assert.doesNotMatch(content,/October 19|October 23|October 16|2026-10-19|2026-10-23|EDT/);assert.match(content,/no close-to-open gap is earned/);
    app.click(app.query('#close-detail'));app.click(app.query('[data-horizon="next_week"]'));app.click(app.query('[data-detail="timing"]'));content=app.query('#detail-content').textContent;assert.match(content,/2026-10-30 20:00:00\.000 UTC/);assert.match(content,/5-session target/);assert.doesNotMatch(content,/2026-10-26 20:00:45/);assert.equal(JSON.stringify(shifted),before);
  },
  async 'missing-selected-window-never-borrows-dates'(){
    const partial=structuredClone(stock);delete partial.event_evidence.horizons.week_exit_at_utc;
    const app=await boot({stockPayload:partial});app.click(app.query('[data-horizon="next_week"]'));app.click(app.query('[data-view="evidence"]'));app.click(app.query('[data-detail="timing"]'));assert.match(app.query('#detail-content').textContent,/timing unavailable for the selected horizon/);assert.match(app.query('#detail-content').textContent,/Entry and exit timestamps are unavailable/);assert.doesNotMatch(app.query('#detail-content').textContent,/2026-10|October|regular open/);
    app.click(app.query('#close-detail'));app.click(app.query('[data-horizon="next_day"]'));app.click(app.query('[data-detail="timing"]'));assert.match(app.query('#detail-content').textContent,/2026-10-19 13:30:00\.000 UTC/);
  },
  async 'pending-window-updates-open-dialog'(){
    let resolve;const held=new Promise(done=>resolve=done);const app=await boot({requests:{stocks:[held]}});app.click(app.query('[data-view="evidence"]'));const opener=app.query('[data-detail="timing"]');app.click(opener);assert.match(app.query('#detail-content').textContent,/timing unavailable/);const focus=app.document.activeElement;
    resolve({ok:true,json:async()=>structuredClone(stock)});await app.flush();assert.equal(app.query('#detail-dialog').open,true);assert.match(app.query('#detail-content').textContent,/2026-10-19 13:30:00\.000 UTC/);assert.ok(app.document.activeElement===focus);app.click(app.query('#close-detail'));assert.ok(app.document.activeElement===opener);
  }
};
const name=process.argv[2];assert.ok(Object.hasOwn(scenarios,name));await scenarios[name]();console.log(JSON.stringify({scenario:name,passed:true}));
