import assert from 'node:assert/strict';
import {boot,retained as stock} from './continued-stock-harness.mjs';
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const response=payload=>({ok:true,json:async()=>payload});
const broken=edit=>{const payload=structuredClone(stock);edit(payload);return freeze(payload);};
function expectUnavailable(app){
  assert.match(app.text(),/Stock research unavailable/);
  assert.equal(app.queryAll('.stock-card').length,0);
  assert.equal(app.query('.window-card'),null,'missing windows never render fallback dates or archived wording');
  assert.ok(app.query('[data-retry="stocks"]'),'stock retry is visible');
  assert.match(app.live(),/unavailable.*Retry/);
  assert.doesNotMatch(app.live(),/ready/i);
}
const scenarios={
  async 'missing-and-malformed-horizons-recover-with-query'(){
    for(const [field,value] of [['day_exit_at_utc',undefined],['week_exit_at_utc',undefined],['week_exit_at_utc','invalid']]){
      const selected=field==='day_exit_at_utc'?'next_day':'next_week';
      const partial=broken(payload=>{if(value===undefined)delete payload.event_evidence.horizons[field];else payload.event_evidence.horizons[field]=value;});
      const restored=freeze(structuredClone(stock)),before=JSON.stringify(restored.operating_evidence.source_checks);
      const app=await boot({requests:{stocks:[response(partial),response(restored)]}});
      app.input(' pg ');app.click(app.query(`[data-horizon="${selected}"]`));expectUnavailable(app);
      app.click(app.query(`[data-horizon="${selected==='next_day'?'next_week':'next_day'}"]`));
      assert.equal(app.queryAll('.stock-card').length,1);assert.match(app.text(),/PG/);assert.equal(app.query('#research-search').value,' pg ');
      app.click(app.query(`[data-horizon="${selected}"]`));app.click(app.query('[data-retry="stocks"]'));await app.flush();
      assert.equal(app.queryAll('.stock-card').length,1);assert.equal(app.query('#research-search').value,' pg ');
      assert.match(app.text(),selected==='next_day'?/2026-10-19 20:00 UTC/:/2026-10-23 20:00 UTC/);assert.match(app.live(),/ready/);
      assert.equal(JSON.stringify(restored.operating_evidence.source_checks),before);assert.equal(app.requestsSeen.filter(x=>x.kind==='stocks').length,2);
    }
  },
  async 'failed-retry-keeps-valid-alternate-horizon'(){
    const partial=broken(payload=>delete payload.event_evidence.horizons.week_exit_at_utc);
    let resolve;const retry=new Promise(done=>resolve=done);
    const app=await boot({requests:{stocks:[response(partial),retry]}});app.input('TXN');app.click(app.query('[data-horizon="next_week"]'));expectUnavailable(app);app.click(app.query('[data-retry="stocks"]'));
    app.click(app.query('[data-horizon="next_day"]'));assert.equal(app.queryAll('.stock-card').length,1);assert.match(app.text(),/TXN/);
    resolve({ok:false,json:async()=>({})});await app.flush();assert.equal(app.queryAll('.stock-card').length,1);assert.match(app.live(),/ready/);
    app.click(app.query('[data-horizon="next_week"]'));expectUnavailable(app);assert.equal(app.query('#research-search').value,'TXN');
    app.click(app.query('[data-horizon="next_day"]'));assert.equal(app.queryAll('.stock-card').length,1);assert.equal(app.requestsSeen.filter(x=>x.kind==='stocks').length,2);
  },
  async 'source-catalog-loss-fails-closed-and-retries'(){
    for(const edit of [payload=>payload.operating_evidence.sources={},payload=>delete payload.operating_evidence.sources.pg_10k,payload=>payload.operating_evidence.sources.pg_10k.url='javascript:alert(1)']){
      const payload=broken(edit),restored=freeze(structuredClone(stock));const sourceClocks=JSON.stringify(restored.operating_evidence.source_checks);
      const app=await boot({requests:{stocks:[response(payload),response(restored)]}});expectUnavailable(app);app.click(app.query('[data-horizon="next_week"]'));expectUnavailable(app);
      app.input('PG');app.click(app.query('[data-retry="stocks"]'));await app.flush();assert.equal(app.queryAll('.stock-card').length,1);assert.ok(app.queryAll('.stock-sources a').length>0);assert.match(app.text(),/2026-10-23 20:00 UTC/);assert.equal(JSON.stringify(restored.operating_evidence.source_checks),sourceClocks);
    }
  },
  async 'unrenderable-data-keeps-a-retry-path'(){
    const payload=broken(payload=>payload.operating_evidence.hypotheses[0].evidence_chain=null);
    const app=await boot({requests:{stocks:[response(payload),response(freeze(structuredClone(stock)))]}});expectUnavailable(app);app.click(app.query('[data-retry="stocks"]'));await app.flush();assert.equal(app.queryAll('.stock-card').length,6);assert.match(app.live(),/ready/);
  }
};
const name=process.argv[2];assert.ok(Object.hasOwn(scenarios,name));await scenarios[name]();console.log(JSON.stringify({scenario:name,passed:true}));
