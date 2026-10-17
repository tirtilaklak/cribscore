import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeskTools} from '../dist/lib/desk-tools.js';

function harness(){
  const listeners={},frames=[];let failFrame=false;
  const container={replaceChildren(frame){this.frame=frame;frame.parentElement=this;}};
  const document={
    querySelector:selector=>selector==='#hosted-price-chart'?container:null,
    addEventListener:(type,handler)=>{listeners[type]=handler;},
    removeEventListener:(type)=>{delete listeners[type];},
    createElement(tag){
      assert.equal(tag,'iframe');if(failFrame)throw Error('Synthetic DOM creation failure');
      const frame={style:{},attributes:{},setAttribute(key,value){this.attributes[key]=value;}};frames.push(frame);return frame;
    },
  };
  let requests=0;
  const app=createDeskTools({document,fetch:()=>{requests++;throw Error('A chart must not fetch journal data');}});
  const click=()=>listeners.click({target:{closest:selector=>selector==='[data-price-action="load-hosted"]'?{}:null}});
  return {app,click,frames,container,fail:value=>{failFrame=value;},requests:()=>requests};
}

test('a requested third-party chart never claims perpetual loading or confirmed render on remount',()=>{
  const h=harness();assert.match(h.app.html('prices'),/data-hosted-status="idle"/);
  h.click();let html=h.app.html('prices');
  assert.match(html,/data-hosted-status="requested"/);assert.match(html,/Chart requested\. If it stays blank/);
  assert.doesNotMatch(html,/Loading the hosted chart|hosted chart is loading|Hosted chart is ready/);
  h.app.mount('prices');assert.equal(h.frames.length,1);assert.equal(new URL(h.frames[0].src).origin,'https://www.tradingview-widget.com');
  h.app.html('prices');h.app.mount('prices');assert.equal(h.frames.length,1,'ordinary rerenders reuse the vendor frame');
  assert.match(h.app.html('prices'),/Chart requested\. If it stays blank/);assert.equal(h.requests(),0);
  h.app.destroy();
});

test('a synchronous frame failure retains an external fallback and a fresh explicit request can recover',()=>{
  const h=harness();h.fail(true);h.click();h.app.mount('prices');
  assert.match(h.app.html('prices'),/hosted chart could not open here/);
  assert.match(h.app.html('prices'),/Open chart at TradingView/);
  assert.doesNotMatch(h.app.html('prices'),/Loading the hosted chart|hosted chart is loading|Hosted chart is ready/);
  h.fail(false);h.click();h.app.mount('prices');assert.equal(h.frames.length,1);
  assert.match(h.app.html('prices'),/data-hosted-status="requested"/);assert.match(h.app.html('prices'),/Chart requested/);
  assert.equal(h.requests(),0);h.app.destroy();
});
