import test from 'node:test';
import assert from 'node:assert/strict';
import {handleJournalRequest,JOURNAL_API_LIMITS} from '../server/journal-api.js';
import {createJournal} from '../dist/lib/journal.js';
import {SQLiteD1} from './helpers/sqlite-d1.mjs';
const at='2026-10-17T21:00:00Z',origin='https://body-limit.synthetic.invalid';
const req=(body,{signal,path='/api/journal',owner=true}={})=>new Request(origin+path,{method:'POST',duplex:'half',body,signal,headers:{origin,'content-type':'application/json',...(owner?{'oai-authenticated-user-id':'synthetic-owner'}:{})}});
const run=async(db,request,extra={})=>{const response=await handleJournalRequest(request,{DB:db},{now:()=>at,bodyTimeoutMs:20,...extra});return {status:response.status,body:await response.json()};};

test('stalled body times out without writing or awaiting uncooperative cancellation',async t=>{
  const db=new SQLiteD1();t.after(()=>db.close());let cancelled=0;
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled++;return new Promise(()=>{});}});
  assert.deepEqual(await run(db,req(stream)),{status:408,body:{ok:false,error:'journal_request_timed_out'}});
  assert.equal(cancelled,1);assert.equal(db.batchCount,0);
});

test('overlarge observation stream returns its size error even when cancellation never finishes',async t=>{
  const db=new SQLiteD1();t.after(()=>db.close());let cancelled=0;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(JOURNAL_API_LIMITS.observationBodyBytes+1));},cancel(){cancelled++;return new Promise(()=>{});}});
  assert.deepEqual(await run(db,req(stream,{path:'/api/journal/observe'})),{status:413,body:{ok:false,error:'journal_request_too_large'}});
  assert.equal(cancelled,1);assert.equal(db.batchCount,0);
});

test('aborted body is rejected before parsing, with no later observer or database write',async t=>{
  const db=new SQLiteD1();t.after(()=>db.close());const controller=new AbortController();let cancelled=0,observations=0;
  const stream=new ReadableStream({pull(){controller.abort();},cancel(){cancelled++;}});
  assert.deepEqual(await run(db,req(stream,{signal:controller.signal,path:'/api/journal/observe'}),{observer:{observe(){observations++;}}}),{status:408,body:{ok:false,error:'journal_request_cancelled'}});
  assert.equal(cancelled,1);assert.equal(observations,0);assert.equal(db.batchCount,0);
});

test('a pre-aborted request cannot commit a complete valid body',async t=>{
  const db=new SQLiteD1();t.after(()=>db.close());const controller=new AbortController();controller.abort();
  const body=JSON.stringify({expectedRevision:0,journal:createJournal({journalId:'synthetic',at})});
  assert.equal((await run(db,req(body,{signal:controller.signal}))).body.error,'journal_request_cancelled');assert.equal(db.batchCount,0);
});

test('valid chunked body keeps the original validation and atomic commit contract',async t=>{
  const db=new SQLiteD1();t.after(()=>db.close());const journal=createJournal({journalId:'synthetic',at});
  const bytes=new TextEncoder().encode(JSON.stringify({expectedRevision:0,journal}));
  const stream=new ReadableStream({start(c){c.enqueue(bytes.slice(0,9));c.enqueue(bytes.slice(9));c.close();}});
  const result=await run(db,req(stream));assert.equal(result.status,200);assert.deepEqual(result.body.journal,journal);assert.equal(db.batchCount,1);
});

test('authentication precedes body parsing and its timeout configuration',async t=>{
  const db=new SQLiteD1();t.after(()=>db.close());
  const result=await run(db,req('{',{owner:false}),{bodyTimeoutMs:0});assert.equal(result.status,401);assert.equal(db.calls.length,0);
});
