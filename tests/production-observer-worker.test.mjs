// Executes the compiled production Worker, not an API with test-supplied readers.
// All requests remain in-process against in-memory SQLite; no service is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import worker from '../dist/server/index.js';
import { createJournal, enrollPublication, validateJournal, projectJournal } from '../dist/lib/journal.js';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';

const root=new URL('../',import.meta.url),origin='https://production-worker-contract.invalid';
const hash=value=>createHash('sha256').update(value).digest('hex');
const utc=value=>new Date(value).toISOString();
const forbiddenModule=/(^|\/)(tests?|fixtures?)(\/|$)|\.test\.[cm]?js$/;
async function request(db,path,{method='GET',body,env={}}={}){
  const response=await worker.fetch(new Request(origin+path,{method,headers:{'oai-authenticated-user-id':'production-contract-owner',...(method==='POST'?{origin,'content-type':'application/json'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db,...env});
  return {status:response.status,body:await response.json()};
}
function database(t){
  const db=new SQLiteD1();t.after(()=>db.close());
  const external=t.mock.method(globalThis,'fetch',()=>{throw Error('Production contract test attempted an external request');});
  t.after(()=>assert.equal(external.mock.callCount(),0,'No network call is allowed'));
  return db;
}
async function setup(db){
  const empty=await request(db,'/api/journal');assert.equal(empty.status,200);assert.equal(empty.body.journal,null);
  const journal=createJournal({journalId:'production-contract-journal',at:utc(Date.now()-10_000)});
  const result=await request(db,'/api/journal',{method:'POST',body:{expectedRevision:0,journal}});
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.revision,0);return result.body.journal;
}

test('compiled production graph is sealed to real modules and excludes test fixture payloads',async()=>{
  const manifest=JSON.parse(await readFile(new URL('docs/worker-build-manifest.json',root),'utf8'));
  const bundle=await readFile(new URL(manifest.bundle.path,root));
  assert.equal(hash(bundle),manifest.bundle.sha256,'Exercise exactly the recorded production bundle');
  for(const path of ['worker/index.js','worker/generated-assets.js','server/journal-api.js','server/journal/observe.mjs','dist/lib/journal.js','dist/lib/prices.js','dist/lib/candidates.js'])assert.ok(manifest.sourceFiles[path],`Missing production dependency ${path}`);
  for(const [path,digest] of Object.entries(manifest.sourceFiles)){
    assert.doesNotMatch(path,forbiddenModule,'A test/fixture module entered the production graph');
    assert.equal(hash(await readFile(new URL(path,root))),digest,`Source changed after compilation: ${path}`);
  }
  for(const item of manifest.publicAssets)assert.doesNotMatch(item.path,forbiddenModule,'A test/fixture file became a public asset');
  for(const sentinel of ['synthetic-observer-slate-v1','synthetic-observer-journal','synthetic-review-','fixture-production-publication-sentinel'])assert.equal(bundle.includes(sentinel),false,`Fixture sentinel was compiled: ${sentinel}`);
});

test('compiled null-publisher observer stores two real retained-context abstentions and deduplicates on readback',async t=>{
  const db=database(t);await setup(db);
  const evidenceResponse=await worker.fetch(new Request(origin+'/data/stock-evidence.json'),{DB:db});
  assert.equal(evidenceResponse.status,200);const evidence=await evidenceResponse.json();
  const attemptedOverride={observe(){throw Error('Untrusted environment observer must not execute');}};
  const before=Date.now(),first=await request(db,'/api/journal/observe',{method:'POST',body:{expectedRevision:0,requestId:'production-observe-first'},env:{observer:attemptedOverride,readPublications:()=>{throw Error('Environment publication hook must not execute');}}}),after=Date.now();
  assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.automation.publisherState,'unconfigured');assert.deepEqual(first.body.automation.pendingReasons,[]);
  assert.ok(Date.parse(first.body.automation.checkedAt)>=before&&Date.parse(first.body.automation.checkedAt)<=after);
  const events=first.body.journal.events;assert.equal(first.body.revision,2);assert.deepEqual(events.map(e=>[e.kind,e.data.horizonId]),[['abstain','next_day'],['abstain','next_week']]);
  const operating=evidence.operating_evidence,horizons=evidence.event_evidence.horizons;
  for(const event of events){
    assert.equal(event.at,first.body.automation.checkedAt);assert.equal(event.data.date,event.at.slice(0,10));
    assert.equal(event.data.unrankedCount,operating.hypotheses.length+operating.caution_watch.length);assert.ok(event.data.unrankedCount>0);
    assert.equal(event.data.snapshot.reviewedAt,operating.checked_at_utc);assert.equal(event.data.snapshot.sourceCutoffAt,null);
    assert.equal(event.data.snapshot.window.horizon_id,event.data.horizonId);assert.equal(event.data.snapshot.window.entry_at,horizons.entry_at_utc);
    assert.equal(event.data.snapshot.window.exit_at,event.data.horizonId==='next_week'?horizons.week_exit_at_utc:horizons.day_exit_at_utc);
    assert.equal(event.data.snapshot.window.timezone,'America/New_York');assert.match(event.data.reason,/not configured/);
  }
  const projection=projectJournal(first.body.journal);assert.equal(projection.summary.abstentions,2);assert.equal(projection.summary.pending+projection.summary.open+projection.summary.closed+projection.summary.actualConfirmations,0);assert.ok(projection.entries.every(e=>e.paper===null&&!e.actual.confirmed));
  const writes=db.batchCount;
  const again=await request(db,'/api/journal/observe',{method:'POST',body:{expectedRevision:2,requestId:'production-observe-second'}});
  assert.equal(again.status,200);assert.equal(again.body.revision,2);assert.deepEqual(again.body.journal,first.body.journal);assert.equal(db.batchCount,writes,'Duplicate observation must not append or commit');
  const loaded=await request(db,'/api/journal');assert.equal(loaded.status,200);assert.deepEqual(loaded.body.journal,first.body.journal);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n,2);
});

test('compiled generic POST rejects a valid self-hashed synthetic publication without touching persisted history',async t=>{
  const db=database(t),journal=await setup(db),now=Date.now();
  const publishedAt=utc(now-2_000),at=utc(now-1_000);
  const payload={schema_version:'fixture-production-publication-sentinel',policy_version:'fixture-policy',generated_at:publishedAt,horizon:{id:'next_day',entry_at:utc(now+86_400_000),exit_at:utc(now+109_800_000)},rows:[{ticker:'ZZZ',company:'Synthetic authority-rejection fixture'}]};
  const payloadBytes=JSON.stringify(payload),publication={publicationId:'synthetic-client-publication',publishedAt,payloadHash:hash(payloadBytes),payloadBytes,policyVersion:payload.policy_version,snapshotVersion:payload.schema_version,horizonId:'next_day',entities:[{symbol:'ZZZ',entityId:'synthetic-client-entity'}]};
  const proposal=await enrollPublication(journal,{id:'synthetic-client-attempt',at,publication});
  assert.equal(proposal.ok,true,JSON.stringify(proposal));assert.equal((await validateJournal(proposal.journal)).ok,true,'Integrity-valid input must reach the authority gate');
  assert.deepEqual(proposal.journal.events.map(e=>e.kind),['publication','paper_intent']);
  const writes=db.batchCount,result=await request(db,'/api/journal',{method:'POST',body:{expectedRevision:0,journal:proposal.journal}});
  assert.equal(result.status,503);assert.equal(result.body.error,'publisher_unconfigured');assert.equal(db.batchCount,writes);
  assert.deepEqual((await request(db,'/api/journal')).body.journal,journal);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n,0);
});

test('compiled observe route accepts no client authority, publication, clock, or owner selectors',async t=>{
  const db=database(t),journal=await setup(db),writes=db.batchCount;
  for(const extra of [{publication:{approved:true}},{authority:{publication:true}},{receivedAt:'2000-01-01T00:00:00Z'},{ownerScope:'other-owner'}]){
    const result=await request(db,'/api/journal/observe',{method:'POST',body:{expectedRevision:0,requestId:'invalid-client-context',...extra}});
    assert.equal(result.status,400,JSON.stringify(result.body));assert.equal(result.body.error,'invalid_observation_request');
  }
  assert.equal(db.batchCount,writes);assert.deepEqual((await request(db,'/api/journal')).body.journal,journal);
});
