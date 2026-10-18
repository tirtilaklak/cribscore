// A visitor without platform identity (a publicly shared Site, no sign-in) must
// see an owner-only journal and price-setup state. Synthetic responses only;
// no network, no writes, no observation requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import {createPriceSetupClient,renderPriceSetup} from '../dist/lib/price-setup.js';

const at='2026-10-18T21:00:00Z';
const denied=()=>new Response(JSON.stringify({ok:false,error:'authentication_required'}),{status:401,headers:{'content-type':'application/json'}});
const flush=async()=>{for(let i=0;i<18;i++)await new Promise(resolve=>setImmediate(resolve));};

function harness({status=401,error='authentication_required'}={}){
  const handlers={},requests=[];
  const document={addEventListener:(kind,fn)=>{handlers[kind]=fn;},removeEventListener:()=>{},querySelector:()=>null,body:{append(){}},createElement:()=>({click(){},remove(){}})};
  const app=createDeskTools({document,now:()=>at,uuid:()=>'synthetic-visitor',fetch:async(url,options={})=>{
    requests.push({url,method:options.method||'GET'});
    if(url==='/api/market-data/setup')return denied();
    return {ok:false,status,json:async()=>({ok:false,error})};
  }});
  const action=async name=>{const target={dataset:{journalAction:name},closest:()=>target};handlers.click({target});await flush();};
  return {app,requests,action,posts:()=>requests.filter(r=>r.method==='POST')};
}

test('a visitor without platform identity sees an owner-only journal and makes no writes',{concurrency:false},async()=>{
  const h=harness();await h.app.start();
  const status=h.app.status();
  assert.equal(status.loadState,'owner_only');assert.equal(status.storage.state,'unavailable');
  const html=h.app.html('journal');
  assert.match(html,/Owner-only journal/);assert.match(html,/signed-in site owner/);
  assert.doesNotMatch(html,/authentication_required/);assert.doesNotMatch(html,/Private journal unavailable/);
  assert.doesNotMatch(html,/Start your private journal/);
  await h.app.observe();await h.action('start');await h.action('sync');
  assert.deepEqual(h.posts(),[]);
  assert.ok(h.requests.length>=2&&h.requests.every(r=>r.url==='/api/journal'&&r.method==='GET'),JSON.stringify(h.requests));
  assert.equal(h.app.status().loadState,'owner_only','a retried sync stays owner-only');
  h.app.destroy();
});

test('other load failures keep the generic unavailable state',{concurrency:false},async()=>{
  const h=harness({status:503,error:'server_unavailable'});await h.app.start();
  assert.equal(h.app.status().loadState,'unavailable');
  const html=h.app.html('journal');
  assert.match(html,/Journal unavailable/);assert.doesNotMatch(html,/Owner-only journal/);
  h.app.destroy();
});

test('price-feed setup reports owner-only without claiming the Site is unavailable',async()=>{
  const client=createPriceSetupClient({fetch:async()=>denied()});
  await client.refresh();
  assert.equal(client.state().status,'owner_only');assert.deepEqual(client.state().reasons,[]);assert.equal(client.state().checkedAt,null);
  const html=renderPriceSetup(client.state());
  assert.match(html,/data-price-setup-status="owner_only"/);assert.match(html,/signed-in site owner/);
  assert.doesNotMatch(html,/could not be checked/);
  client.dispose();
});

test('the shell does not label a public view as private research',async()=>{
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/Private research/);assert.match(html,/Sign-in required/);
});
