// Synthetic histories only. Exercise production observer/API against real SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteD1} from './helpers/sqlite-d1.mjs';
import {handleJournalRequest} from '../server/journal-api.js';
import {createJournalObserver} from '../server/journal/observe.mjs';
import * as domain from '../dist/lib/journal.js';
import {createDeskTools} from '../dist/lib/desk-tools.js';
const at='2026-10-17T20:00:00Z',created='2026-10-17T12:00:00Z',owner='synthetic-capacity',origin='https://synthetic.invalid';
const history=count=>({...domain.createJournal({journalId:'synthetic-capacity',at:created}),revision:count,events:Array.from({length:count},(_,i)=>({id:`settings-${i}`,kind:'settings',at:created,data:{settings:domain.DEFAULT_PAPER_SETTINGS}}))});
const observer=createJournalObserver({clock:()=>at,readObservationContext:async()=>['next_day','next_week'].map(horizonId=>({horizonId,unrankedCount:0,snapshot:{synthetic:true}}))});
function seed(db,j){
 db.sqlite.prepare('INSERT INTO journal_heads VALUES(?,?,?,?,?)').run(owner,j.journalId,j.createdAt,j.revision,created);
 const insert=db.sqlite.prepare('INSERT INTO journal_events VALUES(?,?,?,?,?)');db.sqlite.exec('BEGIN');
 for(const [i,e] of j.events.entries())insert.run(owner,i,e.id,JSON.stringify(e),created);
 db.sqlite.exec('COMMIT');
}
const call=async(db,revision,{path='/api/journal/observe',candidate,customObserver=observer}={})=>{
 const body=candidate?{expectedRevision:revision,journal:candidate}:{expectedRevision:revision,requestId:'synthetic-capacity-attempt'};
 const response=await handleJournalRequest(new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify(body)}),{DB:db},{observer:customObserver,now:()=>at});
 return {status:response.status,body:await response.json()};
};

test('domain cap stays at 20,000 and preserves envelope error precedence',async()=>{
 assert.equal(domain.JOURNAL_LIMITS.events,20000);
 const full=history(20000),before=JSON.stringify(full);
 assert.equal((await domain.validateJournal(full)).ok,true);
 assert.deepEqual((await domain.appendSettings(full,{id:'overflow',at,settings:domain.DEFAULT_PAPER_SETTINGS})).errors,['journal_capacity_exceeded']);
 assert.equal(JSON.stringify(full),before);
 const overflow=history(20001);assert.deepEqual((await domain.validateJournal(overflow)).errors,['journal_capacity_exceeded']);
 assert.deepEqual((await domain.validateJournal({...overflow,revision:20000})).errors,['invalid_journal']);
 assert.deepEqual((await domain.validateJournal({...overflow,journalId:''})).errors,['invalid_journal']);
});
for(const count of [19998,19999,20000])test(`real SQLite ${count}: observation remains atomic and repeat is bounded`,async t=>{
 const db=new SQLiteD1();t.after(()=>db.close());const j=history(count);seed(db,j);
 let revision=count;
 for(let attempt=0;attempt<2;attempt++){
  const result=await call(db,revision),expected=count===19998?20000:count;
  assert.equal(db.sqlite.prepare('SELECT revision FROM journal_heads').get().revision,expected);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n,expected);
  assert.equal(db.batchCount,count===19998?1:0);
  assert.equal(result.status,count===19998?200:409);
  if(count!==19998)assert.deepEqual(result.body,{ok:false,error:'journal_capacity_exceeded',revision:count,capacity:{limit:20000,remaining:20000-count}});
  else assert.equal(result.body.journal.events.filter(e=>e.kind==='abstain').length,2);
  const originals=db.sqlite.prepare('SELECT event_json FROM journal_events WHERE event_index < ? ORDER BY event_index').all(count).map(row=>JSON.parse(row.event_json));
  assert.deepEqual(originals,j.events);revision=expected;
 }
});
test('direct over-cap append returns a specific 422; stale revisions still win',async t=>{
 const db=new SQLiteD1();t.after(()=>db.close());seed(db,history(20000));
 const options={path:'/api/journal',candidate:history(20001)};
 assert.equal((await call(db,19999,options)).body.error,'revision_conflict');
 const result=await call(db,20000,options);assert.equal(result.status,422);assert.equal(result.body.error,'journal_capacity_exceeded');assert.equal(db.batchCount,0);
});
test('arbitrary observer failures remain sanitized and never append',async t=>{
 const db=new SQLiteD1();t.after(()=>db.close());seed(db,history(1));
 for(const proposal of [{ok:false,errors:['journal_capacity_exceeded','private-reader-detail']},{ok:0,errors:['journal_capacity_exceeded']},{ok:false,errors:['private-reader-detail']}]){
  const result=await call(db,1,{customObserver:{observe:async()=>proposal}});assert.deepEqual(result,{status:503,body:{ok:false,error:'observation_unavailable'}});
 }
 assert.equal(db.batchCount,0);
});
function client(remote,{badCapacity=false}={}){
 const listeners={},calls=[];const document={querySelector:()=>null,addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener(){},body:{append(){}},createElement:()=>({click(){},remove(){}})};
 const app=createDeskTools({document,now:()=>at,uuid:()=> 'synthetic',fetch:async(url,options)=>{
  calls.push({url,method:options.method});
  if(options.method==='GET')return new Response(JSON.stringify({ok:true,journal:remote,revision:remote.revision}),{status:200});
  return new Response(JSON.stringify({ok:false,error:'journal_capacity_exceeded',revision:remote.revision,capacity:{limit:20000,remaining:badCapacity?99:20000-remote.revision}}),{status:409});
 }});
 return {app,calls,listeners};
}
test('capacity pauses automatic attempts and edits, retains export and sync without repeating observe',async t=>{
 const h=client(history(19999));await h.app.start();assert.equal(h.app.status().storage.state,'capacity');assert.equal(h.app.status().busy,false);assert.equal(h.app.status().automation.checkedAt,null);
 assert.equal(h.calls.length,2);await h.app.observe();await h.app.observe();assert.equal(h.calls.length,2);
 const html=h.app.html('journal');assert.match(html,/data-journal-action="export"/);assert.match(html,/data-journal-action="sync"/);assert.match(html,/Exporting does not free space/);assert.doesNotMatch(html,/Storage unavailable/);
 await h.app.start();assert.equal(h.calls.length,3);assert.equal(h.calls[2].method,'GET');assert.equal(h.app.status().storage.state,'capacity');
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;let resolveExport;
 const exported=new Promise(resolve=>{resolveExport=resolve;});
 URL.createObjectURL=value=>{resolveExport(value);return 'blob:synthetic-capacity';};URL.revokeObjectURL=()=>{};t.after(()=>{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;});
 const target={dataset:{journalAction:'export'},closest:selector=>selector==='[data-journal-action]'?target:null};h.listeners.click({target});
 let exportTimer,blob;
 try{blob=await Promise.race([exported,new Promise((_,reject)=>{exportTimer=setTimeout(()=>reject(new Error('Synthetic export did not finish.')),15000);})]);}finally{clearTimeout(exportTimer);}
 assert.ok(blob);assert.deepEqual(JSON.parse(await blob.text()),history(19999));assert.equal(h.calls.length,3);
 const originalFormData=globalThis.FormData;globalThis.FormData=class{get(){return null;}};
 try{const form={dataset:{journalForm:'settings'},closest:selector=>selector==='[data-journal-form]'?form:null};h.listeners.submit({target:form,preventDefault(){}});for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.length,3);assert.equal(h.app.status().storage.state,'capacity');}finally{globalThis.FormData=originalFormData;}
 h.app.destroy();
});
test('full journal load pauses before an automatic observation request',async()=>{
 const h=client(history(20000));await h.app.start();assert.equal(h.app.status().storage.state,'capacity');assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'GET');h.app.destroy();
});
test('malformed capacity response is unconfirmed, not a trusted capacity result',async()=>{
 const h=client(history(1),{badCapacity:true});await h.app.start();assert.equal(h.app.status().storage.state,'unavailable');await h.app.observe();assert.equal(h.calls.length,2);h.app.destroy();
});
