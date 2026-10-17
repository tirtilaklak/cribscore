// These checks execute the compiled production entrypoint with real SQL in
// memory; they never contact a Site, provider, or another user's journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
import { createJournal } from '../dist/lib/journal.js';
const origin = 'https://scheduled-production-fixture.invalid';
const request = (method, params, owner = 'production-fixture-owner') => new Request(origin + '/mcp', {
  method: 'POST', headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(params?.name ? { 'mcp-name': params.name } : {}), ...(owner ? { 'oai-authenticated-user-id': owner } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 'production-contract', method, params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} }, ...params } }),
});

test('production MCP module is bundled privately; service bypass alone has no journal identity', async () => {
  const manifest = JSON.parse(await readFile(new URL('../docs/worker-build-manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.sourceFiles['server/journal/scheduled-mcp.mjs']);
  assert.equal(manifest.publicAssets.some(item => item.path.includes('scheduled-mcp')), false);
  const anonymous = request('server/discover', null, null);
  anonymous.headers.set('OAI-Sites-Authorization', 'Bearer synthetic-access-only');
  assert.equal((await worker.fetch(anonymous, {})).status, 401);
  assert.equal((await worker.fetch(new Request(origin + '/server/journal/scheduled-mcp.mjs'), {})).status, 404);
});

test('compiled production MCP exposes its sealed source profile and requires an existing owner journal', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const env = { DB: db, writesEnabled: false, SCHEDULED_OBSERVATION_ENABLED: 'false', observer: { observe() { throw Error('must not execute'); } } };
  const discovered = await (await worker.fetch(request('server/discover'), env)).json();
  assert.deepEqual(discovered.result.supportedVersions, ['2026-07-28']);
  const listed = await (await worker.fetch(request('tools/list'), env)).json();
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ['journal_observation_status','journal_observe_scheduled']);
  const status = await (await worker.fetch(request('tools/call', { name: 'journal_observation_status', arguments: {} }), env)).json();
  const body = JSON.parse(status.result.content[0].text);
  assert.equal(body.writesEnabled, true); assert.equal(body.setupRequired, true); assert.equal(body.journalId, null);
  assert.equal(body.sources.checkedAt, null); assert.equal(body.lastRecordedObservationAt, null);
  assert.deepEqual(body.sources.configuration, { publisher: 'unconfigured', calendar: 'unconfigured', reviewedPrices: 'unconfigured' });
  assert.deepEqual(body.sources.pendingReasons, ['publisher_unconfigured', 'calendar_unconfigured', 'reviewed_prices_unconfigured']);
  const observed = await (await worker.fetch(request('tools/call', { name: 'journal_observe_scheduled', arguments: { expectedJournalId: 'anything', expectedRevision: 0, requestId: 'unused' } }), env)).json();
  assert.equal(observed.result.isError, true); assert.equal(JSON.parse(observed.result.content[0].text).error, 'journal_setup_required');
  assert.equal(db.batchCount, 0);
});

test('compiled owner observation records only honest abstentions, reads back and rejects stale replay',async t=>{
  const db=new SQLiteD1();t.after(()=>db.close());const env={DB:db};
  const journal=createJournal({journalId:'synthetic-production-observation',at:'2026-10-16T00:00:00Z'});
  const setup=await worker.fetch(new Request(origin+'/api/journal',{method:'POST',headers:{origin,'content-type':'application/json','oai-authenticated-user-id':'production-fixture-owner'},body:JSON.stringify({expectedRevision:0,journal})}),env);
  assert.equal(setup.status,200);
  const tool=async(name,args={},owner)=>{
    const response=await worker.fetch(request('tools/call',{name,arguments:args},owner),env);
    assert.equal(response.status,200);const rpc=await response.json();assert.equal(rpc.result.resultType,'complete');return JSON.parse(rpc.result.content[0].text);
  };
  const before=await tool('journal_observation_status');assert.equal(before.revision,0);
  const args={expectedJournalId:before.journalId,expectedRevision:before.revision,requestId:'synthetic-production-occurrence'};
  const observed=await tool('journal_observe_scheduled',args);assert.equal(observed.ok,true);assert.equal(observed.appendedEvents,2);assert.deepEqual(observed.eventCounts,{abstain:2});assert.equal(observed.automation.publisherState,'unconfigured');
  const after=await tool('journal_observation_status');assert.equal(after.revision,2);assert.deepEqual(after.eventCounts,{abstain:2});assert.equal(after.sources.checkedAt,null);
  assert.equal((await tool('journal_observe_scheduled',args)).error,'revision_conflict');
  const next=await tool('journal_observe_scheduled',{...args,expectedRevision:2,requestId:'synthetic-production-next'});assert.equal(next.ok,true);assert.equal(next.appendedEvents,0);
  const other=await tool('journal_observation_status',{},'synthetic-other-owner');assert.equal(other.journalId,null);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n,2);
});
