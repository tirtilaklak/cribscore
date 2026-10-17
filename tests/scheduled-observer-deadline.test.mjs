// Independent timeout boundary: synthetic SQLite, fixed domain clock, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduledJournalMcp} from '../server/journal/scheduled-mcp.mjs';
import {handleJournalRequest} from '../server/journal-api.js';
import {createJournalObserver} from '../server/journal/observe.mjs';
import {createJournal} from '../dist/lib/journal.js';
import {SQLiteD1} from './helpers/sqlite-d1.mjs';
const at='2026-10-17T20:00:00Z',origin='https://synthetic-deadline.invalid',owner='synthetic-deadline-owner';
const headers={origin,'content-type':'application/json','oai-authenticated-user-id':owner};
const actual=createJournalObserver({readObservationContext:async()=>['next_day','next_week'].map(horizonId=>({horizonId,unrankedCount:6,snapshot:{synthetic:true}})),clock:()=>at});

for(const mode of ['synchronous','microtask'])test(`expired ${mode} observer proposal cannot commit before the delayed timeout callback`,async t=>{
 const db=new SQLiteD1();t.after(()=>db.close());
 const journal=createJournal({journalId:`synthetic-deadline-${mode}`,at});
 const saved=await handleJournalRequest(new Request(origin+'/api/journal',{method:'POST',headers,body:JSON.stringify({expectedRevision:0,journal})}),{DB:db},{now:()=>at});
 assert.equal(saved.status,200);const before=db.batchCount;let elapsed;
 const observer={async observe(input){
  const proposal=await actual.observe(input),started=performance.now();
  // A finite 45 ms local workload distinguishes timer delivery from elapsed time.
  while(performance.now()-started<45){if(mode==='microtask')await Promise.resolve();}
  elapsed=performance.now()-started;return proposal;
 }};
 const service=createScheduledJournalMcp({observer,writesEnabled:true,now:()=>at,observationTimeoutMs:10});
 const response=await service.fetch(new Request(origin+'/mcp',{method:'POST',headers:{...headers,'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'journal_observe_scheduled'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}},name:'journal_observe_scheduled',arguments:{expectedJournalId:journal.journalId,expectedRevision:0,requestId:'synthetic-expired-proposal'}}})}),{DB:db});
 const rpc=await response.json(),result=JSON.parse(rpc.result.content[0].text);
 t.diagnostic(JSON.stringify({elapsedMs:elapsed,result,additionalBatches:db.batchCount-before}));
 assert.equal(result.ok,false,'elapsed timeout must reject the proposal even before its timer callback executes');
 assert.equal(db.batchCount,before,'an expired proposal must never dispatch a commit');
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n,0);
});
