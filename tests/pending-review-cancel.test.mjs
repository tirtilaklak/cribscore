// Synthetic controller outcomes; no listener, provider or persistent storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import {createJournal,appendSettings,DEFAULT_PAPER_SETTINGS,exportJournal} from '../dist/lib/journal.js';

const at='2026-10-17T18:00:00Z';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function client(t){
  const oldFD=globalThis.FormData,handlers={};
  globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name]??null;}};
  let remote=createJournal({journalId:'synthetic-pending-apply',at}),visible='',commitHold=null,sequence=0;
  const writes=[],doc={querySelector:()=>null,addEventListener:(name,fn)=>{handlers[name]=fn;},removeEventListener(){}};
  const response=()=>({ok:true,status:200,json:async()=>({ok:true,journal:remote,revision:remote.revision,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}})});
  const app=createDeskTools({document:doc,now:()=>at,uuid:()=>`pending-${++sequence}`,onChange:()=>{visible=app.html('journal');},fetch:async(url,options)=>{
    if(options.method==='POST'&&!url.endsWith('/observe')){
      const body=JSON.parse(options.body);writes.push(body);remote=body.journal;
      if(commitHold)await commitHold.promise;
    }
    return response();
  }});
  const settle=async()=>{for(let n=0;n<500&&app.status().busy;n++)await tick();assert.equal(app.status().busy,false);};
  const click=name=>{const target={dataset:{journalAction:name},closest:()=>target};handlers.click({target});};
  await app.start();
  t.after(async()=>{commitHold?.resolve();await settle();app.destroy();globalThis.FormData=oldFD;});
  const review=async()=>{
    const result=await appendSettings(remote,{id:'synthetic-reviewed-setting',at,settings:{...DEFAULT_PAPER_SETTINGS,paperNotional:'742'}});assert.equal(result.ok,true);
    const backup=await exportJournal(result.journal);assert.equal(backup.ok,true);
    const form={dataset:{journalForm:'import'},values:{file:{size:backup.text.length,text:async()=>backup.text}}};form.closest=()=>form;
    handlers.submit({target:form,preventDefault(){}});await settle();assert.match(visible,/data-journal-action="cancel-import"/);
  };
  return {app,click,settle,review,writes,html:()=>visible,remote:()=>remote,holdCommit(){return commitHold=deferred();}};
}

test('Apply removes actionable review controls immediately and stale Cancel cannot claim cancellation',{concurrency:false},async t=>{
  const h=await client(t);await h.review();const held=h.holdCommit();h.click('confirm-import');
  assert.equal(h.app.status().busy,true);
  assert.doesNotMatch(h.html(),/data-journal-action="(?:confirm-import|cancel-import)"/,'The rendered controls must retire when Apply begins, before awaiting validation or response');
  assert.match(h.html(),/data-journal-action="sync" aria-disabled="true" aria-busy="true">Working/);
  for(let n=0;n<500&&!h.writes.length;n++)await tick();assert.equal(h.writes.length,1);assert.equal(h.remote().revision,1);
  h.click('cancel-import');assert.doesNotMatch(h.html(),/Backup review cancelled/);assert.match(h.html(),/operation is still in progress/);
  held.resolve();await h.settle();assert.equal(h.writes.length,1);assert.equal(h.app.status().storage.state,'synced');assert.match(h.html(),/Reviewed backup saved/);
  h.click('cancel-import');assert.match(h.html(),/Reviewed backup saved/,'A late stale Cancel cannot replace a confirmed save message');
});

test('Cancel still discards an unapplied review without submitting a write',{concurrency:false},async t=>{
  const h=await client(t);await h.review();h.click('cancel-import');
  assert.match(h.html(),/Backup review cancelled/);assert.doesNotMatch(h.html(),/data-journal-action="(?:confirm-import|cancel-import)"/);
  assert.equal(h.writes.length,0);assert.equal(h.remote().revision,0);assert.equal(h.app.status().storage.state,'synced');
});
