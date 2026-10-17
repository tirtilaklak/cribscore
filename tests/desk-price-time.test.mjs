import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeskTools} from '../dist/lib/desk-tools.js';

// Explicit synthetic prices; no provider, storage service or verified calendar.
const capturedAt='2026-10-16T22:00:00Z';
const series=symbol=>({schemaVersion:'cribscore-price-series-v1',id:`synthetic-${symbol}`,symbol,currency:'USD',sessionTimezone:'America/New_York',interval:'1d',priceBasis:'split_adjusted',volumeBasis:'shares',source:{provider:'Synthetic',dataset:'Controller fixture only',url:'https://prices.example/fixture',capturedAt,publishedAt:null,responseSha256:'a'.repeat(64),channel:'retained_capture'},bars:['2026-10-15','2026-10-16'].map(session=>({session,open:'10',high:'11',low:'9',close:'10',volume:null}))});
function harness(){
  const handlers={};let clock='2026-10-17T21:59:59Z',changes=0,gets=0,posts=0;
  const originalFormData=globalThis.FormData;
  globalThis.FormData=class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}};
  const document={addEventListener:(type,fn)=>{handlers[type]=fn;},removeEventListener(){},querySelector:()=>null};
  const app=createDeskTools({document,now:()=>clock,uuid:()=> 'synthetic-controller-id',onChange:()=>changes++,fetch:async(_url,options)=>{
    if(options?.method==='POST'){posts++;throw Error('Unexpected write');}gets++;return {ok:true,status:200,json:async()=>({ok:true,journal:null,revision:0})};
  }});
  return {app,changes:()=>changes,io:()=>({gets,posts}),setClock:at=>{clock=at;},async submit(kind,values){const form={dataset:{priceForm:kind},values,closest(){return this;}};handlers.submit({target:form,preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));},async import(items){const raw=JSON.stringify({schemaVersion:'cribscore-price-import-v1',series:items});await this.submit('import',{file:{size:raw.length,text:async()=>raw}});},cleanup(){app.destroy();globalThis.FormData=originalFormData;}};
}

test('price expiry notifies independently of journal readiness and preserves the original capture clock',async()=>{
  for(const awaitingSetup of [false,true]){
    const h=harness();try{
      if(awaitingSetup){await h.app.start();assert.match(h.app.html('journal'),/Start your private journal/);}
      await h.import([series('TEST')]);assert.match(h.app.html('prices'),/Within the capture-age policy/);const before=h.changes();
      h.setClock('2026-10-17T22:00:00Z');await h.app.observe();assert.equal(h.changes(),before,'exact 24h boundary remains within policy');
      h.setClock('2026-10-17T22:00:00.001Z');await h.app.observe();assert.equal(h.changes(),before+1,'expiry emits even without a ready journal');
      const html=h.app.html('prices');assert.match(html,/Source capture is stale/);assert.match(html,/2026-10-16 22:00:00 UTC/);
      await h.app.observe();assert.equal(h.changes(),before+1,'unchanged expired state does not emit again');assert.deepEqual(h.io(),{gets:awaitingSetup?1:0,posts:0});
    }finally{h.cleanup();}
  }
});

test('SPY is never its own benchmark while a distinct imported company keeps descriptive comparison',async()=>{
  const h=harness();try{
    await h.import([series('SPY'),series('IBM')]);const spy=h.app.html('prices');assert.doesNotMatch(spy,/SPY and SPY/);assert.match(spy,/Comparable benchmark history is unavailable/);
    await h.submit('selection',{symbol:'IBM',rangeSessions:'20'});assert.match(h.app.html('prices'),/IBM and SPY/);assert.deepEqual(h.io(),{gets:0,posts:0});
  }finally{h.cleanup();}
});
