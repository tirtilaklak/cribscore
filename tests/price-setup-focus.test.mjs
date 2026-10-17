import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import {createDocument} from './helpers/interaction-dom.mjs';

const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const renderer=source.slice(source.indexOf('function disclosureKey('),source.indexOf('let rightsExpiryTimer;'));

test('manual setup check preserves keyboard focus and disclosure through loading and completion',async t=>{
  const doc=createDocument('<body><main id="main" tabindex="-1"><section id="view-content"></section></main></body>');
  const state={view:'prices'},renderContent=new Function('document','state',`let renderedView,renderedContentHTML,lastFocus;const disclosureState=new Map();const $=s=>document.querySelector(s);${renderer};return renderContent;`)(doc,state);
  let resolveFetch,resolveComplete,calls=0;
  const complete=new Promise(resolve=>{resolveComplete=resolve;});
  const app=createDeskTools({document:doc,onChange:()=>{renderContent(app.html('prices'));if(doc.querySelector('#view-content').textContent.includes('Alpaca setup is incomplete'))resolveComplete();},fetch:async(url)=>{assert.equal(url,'/api/market-data/setup');calls++;return new Promise(resolve=>{resolveFetch=resolve;});}});
  t.after(()=>app.destroy());renderContent(app.html('prices'));
  const button=doc.querySelector('#price-check-setup');button.closest('details').open=true;button.focus();button.dispatch({type:'click',target:button});
  const loading=doc.querySelector('#price-check-setup');assert.equal(doc.activeElement,loading);assert.equal(loading.getAttribute('aria-disabled'),'true');assert.equal(loading.getAttribute('disabled'),null);assert.equal(loading.closest('details').open,true);
  loading.dispatch({type:'click',target:loading});assert.equal(calls,1,'a pending check is coalesced');
  resolveFetch(new Response(JSON.stringify({ok:true,checkedAt:'2026-10-17T21:00:00Z',provider:{id:'alpaca',status:'setup_required',reasons:['credentials_missing_or_invalid','rights_review_missing'],connectionVerified:false,captureEnabled:false,displayEnabled:false,journalPricesEnabled:false}}),{headers:{'content-type':'application/json'}}));
  await complete;
  const finished=doc.querySelector('#price-check-setup');assert.equal(doc.activeElement,finished);assert.equal(finished.getAttribute('aria-disabled'),null);assert.equal(finished.closest('details').open,true);
});
