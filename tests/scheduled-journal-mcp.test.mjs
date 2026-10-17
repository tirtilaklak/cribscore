import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledJournalMcp } from '../server/journal/scheduled-mcp.mjs';
import { handleJournalRequest } from '../server/journal-api.js';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { projectJournal, recordActualConfirmation } from '../dist/lib/journal.js';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
import { base, ENROLL, SETTLED, publication, readers, observationContext } from './fixtures/journal-observer.mjs';

// All fixtures and storage are synthetic/in-process. No hosted data is touched.
const origin = 'https://scheduled-fixture.invalid';
const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
const inputs = (expectedRevision = 0, requestId = 'synthetic-occurrence-1') => ({ expectedJournalId: base().journalId, expectedRevision, requestId });
const readArgs = { method: 'tools/call', params: { name: 'journal_observation_status', arguments: {} } };
const writeArgs = (args = inputs()) => ({ method: 'tools/call', params: { name: 'journal_observe_scheduled', arguments: args } });
function request(body = readArgs, { owner = 'owner-a', headers = {}, signal, method = 'POST', path = '/mcp' } = {}) {
  return new Request(origin + path, { method, signal, headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2026-07-28', 'mcp-method': typeof body === 'string' ? 'tools/call' : body.method, ...(body.params?.name ? { 'mcp-name': body.params.name } : {}), ...(owner ? { 'oai-authenticated-user-id': owner } : {}), ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify({ jsonrpc: '2.0', id: 1, ...body, params: { _meta: meta, ...body.params } }) } : {}),
  });
}
async function call(app, db, body, options) {
  const response = await app.fetch(request(body, options), { DB: db }); const rpc = await response.json();
  return { status: response.status, rpc, body: rpc.result?.content ? JSON.parse(rpc.result.content[0].text) : rpc };
}
function database(t) { const db = new SQLiteD1(); t.after(() => db.close()); return db; }
async function setup(db, { owner = 'owner-a', journal = base() } = {}) {
  const request = new Request(origin + '/api/journal', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-id': owner }, body: JSON.stringify({ expectedRevision: 0, journal }) });
  const response = await handleJournalRequest(request, { DB: db }, { now: () => ENROLL });
  assert.equal(response.status, 200, await response.text());
}
async function saved(db, owner = 'owner-a') {
  const response = await handleJournalRequest(new Request(origin + '/api/journal', { headers: { 'oai-authenticated-user-id': owner } }), { DB: db });
  return (await response.json()).journal;
}
const observer = (options = {}) => createJournalObserver({ readObservationContext: observationContext, clock: () => ENROLL, ...options });
const app = (options = {}) => createScheduledJournalMcp({ writesEnabled: true, observer: observer(), now: () => ENROLL, ...options });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('MCP discovery exposes supported schema; default is read-only and env flags cannot enable writes', async t => {
  const db = database(t); await setup(db);
  const locked = createScheduledJournalMcp({ observer: observer(), now: () => ENROLL });
  const discovered = await call(locked, db, { method: 'server/discover' });
  assert.deepEqual(discovered.rpc.result, { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, ttlMs: 0, cacheScope: 'private' });
  assert.deepEqual((await call(locked, db, { method: 'tools/list' })).rpc.result.tools.map(tool => tool.name), ['journal_observation_status']);
  assert.equal((await call(locked, db)).body.writesEnabled, false);
  const result = await locked.fetch(request(writeArgs()), { DB: db, writesEnabled: true, SCHEDULED_OBSERVATION_ENABLED: 'true' });
  assert.equal(JSON.parse((await result.json()).result.content[0].text).error, 'scheduled_observation_disabled');
  assert.equal(db.batchCount, 1);
  const listed = (await call(app(), db, { method: 'tools/list' })).rpc.result.tools;
  assert.deepEqual(listed[1].inputSchema.required, ['expectedJournalId', 'expectedRevision', 'requestId']);
  assert.equal(listed[1].inputSchema.additionalProperties, false);
});

test('MCP authentication and CSRF gates run before database or observer work', async t => {
  const db = database(t), service = app({ observer: { observe() { throw Error('must not run'); } } });
  for (const options of [{ owner: null }, { owner: null, headers: { 'OAI-Sites-Authorization': 'Bearer synthetic-service-only' } }, { owner: 'x'.repeat(513) }]) assert.equal((await call(service, db, readArgs, options)).status, 401);
  for (const headers of [{ origin: 'https://evil.invalid' }, { origin: 'null' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }]) assert.equal((await call(service, db, writeArgs(), { headers })).status, 403);
  assert.equal((await call(service, db, readArgs, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(service, db, readArgs, { method: 'GET' })).status, 405);
  assert.equal((await call(service, db, readArgs, { path: '/unrelated' })).status, 404);
  assert.equal(db.calls.length, 0);
});

test('owner status is bounded; no automatic journal creation and identity cannot be selected in arguments', async t => {
  const db = database(t), service = app();
  const empty = await call(service, db); assert.equal(empty.body.setupRequired, true); assert.equal(empty.body.journalId, null);
  assert.equal((await call(service, db, writeArgs())).body.error, 'journal_setup_required'); assert.equal(db.batchCount, 0);
  await setup(db);
  const read = await call(service, db); assert.equal(read.body.journalId, base().journalId); assert.equal(read.body.revision, 0); assert.ok(!Object.hasOwn(read.body, 'journal'));
  assert.equal((await call(service, db, readArgs, { owner: 'owner-b' })).body.journalId, null);
  assert.equal((await call(service, db, writeArgs(), { owner: 'owner-b' })).body.error, 'journal_setup_required');
  for (const key of ['ownerId', 'ownerScope', 'journal', 'authority', 'receivedAt', 'prices', 'confirmed', 'writesEnabled']) {
    const result = await call(service, db, writeArgs({ ...inputs(), [key]: 'spoof' })); assert.equal(result.rpc.error.code, -32602, key);
  }
  assert.equal((await call(service, db, writeArgs({ ...inputs(), expectedJournalId: 'another-journal' }))).body.error, 'journal_identity_conflict');
  assert.deepEqual(await saved(db), base());
});

test('source configuration is sealed and status never confuses retained events with a fresh feed check', async t => {
  const db = database(t); await setup(db);
  const configuration = { publisher: 'configured', calendar: 'unconfigured', reviewedPrices: 'unconfigured' };
  const service = app({ sourceConfiguration: configuration }); configuration.reviewedPrices = 'configured';
  const before = (await call(service, db)).body;
  assert.deepEqual(before.sources, { configuration: { publisher: 'configured', calendar: 'unconfigured', reviewedPrices: 'unconfigured' }, checkedAt: null, pendingReasons: ['calendar_unconfigured', 'reviewed_prices_unconfigured'] });
  assert.equal(before.lastRecordedObservationAt, null);
  const observed = (await call(service, db, writeArgs())).body;
  assert.equal(observed.automation.checkedAt, ENROLL); assert.equal(observed.automation.publisherState, 'unconfigured');
  const after = (await call(service, db)).body;
  assert.equal(after.lastRecordedObservationAt, ENROLL); assert.equal(after.sources.checkedAt, null);
  assert.equal(Object.hasOwn(after, 'automation'), false);
  assert.throws(() => app({ sourceConfiguration: { publisher: 'ready', calendar: 'configured', reviewedPrices: 'configured' } }), /invalid_source_configuration/);
});

test('ambiguous, malformed, nested and oversized MCP bodies cannot write', async t => {
  const db = database(t); await setup(db); const service = app();
  for (const body of ['{', 'null', '[]', '{}', '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"x":1,"\\u0078":2}}']) {
    const result = await call(service, db, body); assert.ok(result.status === 400 || result.rpc.error?.code === -32600);
  }
  assert.equal((await call(service, db, ' '.repeat(8193))).status, 413);
  assert.equal((await call(service, db, readArgs, { headers: { 'content-length': '9000' } })).status, 413);
  const nested = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { nested: Array.from({ length: 20 }).reduce(value => [value], 0) } });
  assert.equal((await call(service, db, nested)).body.error, 'json_nesting_limit');
  for (const arguments_ of [null, [], {}, { ...inputs(), expectedRevision: -1 }, { ...inputs(), expectedRevision: 0.1 }, { ...inputs(), requestId: '../bad' }]) assert.equal((await call(service, db, writeArgs(arguments_))).rpc.error?.code, -32602);
  assert.equal(db.batchCount, 1);
});

test('missing readers honestly record abstentions with no fills; repeated exact tuple is CAS-safe', async t => {
  const db = database(t); await setup(db); const service = app();
  const first = await call(service, db, writeArgs()); assert.equal(first.body.ok, true); assert.equal(first.body.revision, 2); assert.equal(first.body.appendedEvents, 2);
  assert.equal(first.body.automation.publisherState, 'unconfigured'); assert.deepEqual(first.body.eventCounts, { abstain: 2 });
  const writes = db.batchCount, replay = await call(service, db, writeArgs()); assert.equal(replay.body.error, 'revision_conflict'); assert.equal(replay.body.retry, 'read_and_reconcile'); assert.equal(db.batchCount, writes);
  const next = await call(service, db, writeArgs(inputs(2, 'synthetic-occurrence-2'))); assert.equal(next.body.ok, true); assert.equal(next.body.appendedEvents, 0); assert.equal(db.batchCount, writes);
  assert.ok((await saved(db)).events.every(event => event.kind === 'abstain'));
});

test('concurrent identical runs commit at most once and preserve another owner byte-for-byte', async t => {
  const db = database(t); await setup(db); await setup(db, { owner: 'owner-b', journal: { ...base(), journalId: 'owner-b-private' } });
  const beforeB = await saved(db, 'owner-b'); let waiting = 0, release; const gate = new Promise(resolve => { release = resolve; });
  const real = observer(); const service = app({ observer: { async observe(input) { waiting++; if (waiting === 2) release(); await gate; return real.observe(input); } } });
  const results = await Promise.all([call(service, db, writeArgs()), call(service, db, writeArgs())]);
  assert.equal(results.filter(result => result.body.ok).length, 1); assert.equal(results.filter(result => result.body.error === 'revision_conflict').length, 1);
  assert.equal((await saved(db)).revision, 2); assert.deepEqual(await saved(db, 'owner-b'), beforeB);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events WHERE owner_id=?').get('owner-a').n, 2);
});

test('empty restore between preliminary read and observation cannot switch the pinned journal', async t => {
  const db = database(t); await setup(db); const originalPrepare = db.prepare.bind(db); let reads = 0, observerCalls = 0;
  db.prepare = sql => {
    const statement = originalPrepare(sql), originalAll = statement.all;
    statement.all = async function () {
      const result = await originalAll.call(this);
      if (++reads === 1) db.sqlite.prepare('UPDATE journal_heads SET journal_id=? WHERE owner_id=?').run('restored-empty-journal', 'owner-a');
      return result;
    };
    return statement;
  };
  const real = observer(), service = app({ observer: { observe(input) { observerCalls++; return real.observe(input); } } });
  const result = await call(service, db, writeArgs()); assert.equal(result.body.error, 'journal_identity_conflict');
  assert.equal(observerCalls, 0); assert.equal(db.batchCount, 1); assert.equal((await saved(db)).journalId, 'restored-empty-journal');
});

test('empty restore after observation read loses the identity-bound CAS without partial events', async t => {
  const db = database(t); await setup(db);
  db.beforeBatch = async () => { db.sqlite.prepare('UPDATE journal_heads SET journal_id=? WHERE owner_id=?').run('restored-during-observation', 'owner-a'); };
  const result = await call(app(), db, writeArgs()); assert.equal(result.body.error, 'revision_conflict');
  const journal = await saved(db); assert.equal(journal.journalId, 'restored-during-observation'); assert.equal(journal.revision, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n, 0);
});

test('mid-batch failure rolls back all events and is reported uncertain, never saved', async t => {
  const db = database(t); await setup(db); db.failAt = 1;
  const result = await call(app(), db, writeArgs()); assert.equal(result.body.error, 'journal_commit_uncertain'); assert.equal(result.body.retry, 'read_and_reconcile'); assert.equal(result.rpc.result.isError, true);
  assert.deepEqual(await saved(db), base()); assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n, 0);
});

test('commit acknowledgement loss cannot cause an optimistic success or a duplicate on retry', async t => {
  const db = database(t); await setup(db); const batch = db.batch.bind(db);
  db.batch = async statements => { await batch(statements); throw Error('synthetic lost commit acknowledgement'); };
  const service = app(), result = await call(service, db, writeArgs()); assert.equal(result.body.error, 'journal_commit_uncertain'); assert.equal((await saved(db)).revision, 2);
  db.batch = batch; const writes = db.batchCount;
  assert.equal((await call(service, db, writeArgs())).body.error, 'revision_conflict'); assert.equal(db.batchCount, writes);
  assert.equal((await call(service, db)).body.revision, 2);
});

test('observer timeout discards its late proposal permanently and persists nothing', async t => {
  const db = database(t); await setup(db); let release, received;
  const gate = new Promise(resolve => { release = resolve; }); const real = observer();
  const service = app({ observationTimeoutMs: 5, observer: { async observe(input) { received = input; await gate; return real.observe(input); } } });
  const result = await call(service, db, writeArgs()); assert.equal(result.body.error, 'observation_unavailable'); assert.ok(received);
  release(); await tick(); await tick(); assert.deepEqual(await saved(db), base()); assert.equal(db.batchCount, 1);
});

test('cancelled observer cannot dispatch an eventual late commit', async t => {
  const db = database(t); await setup(db); const controller = new AbortController(); const real = observer();
  const service = app({ observer: { async observe(input) { controller.abort(); return real.observe(input); } } });
  const result = await call(service, db, writeArgs(), { signal: controller.signal }); assert.equal(result.body.error, 'observation_unavailable');
  await tick(); assert.deepEqual(await saved(db), base()); assert.equal(db.batchCount, 1);
});

test('unavailable and stale publication coverage never produce suggestions or fills', async t => {
  for (const readPublications of [async () => ({ status: 'unavailable' }), async () => ({ status: 'ready', coverage: { fromAt: base().createdAt, throughAt: base().createdAt, horizonIds: ['next_day', 'next_week'], complete: true }, publications: [publication()] })]) {
    const db = database(t); await setup(db);
    const result = await call(app({ observer: observer({ readPublications }) }), db, writeArgs());
    if (result.body.ok) assert.equal(result.body.automation.publisherState, 'unavailable'); else assert.equal(result.body.error, 'observation_unavailable');
    assert.deepEqual(await saved(db), base()); assert.equal(db.batchCount, 1);
  }
});

test('an initial late scheduled observation records no-fill and cannot invent a historical entry', async t => {
  const db = database(t); await setup(db);
  const service = app({ now: () => SETTLED, observer: observer({ ...readers([publication()], { marks: true }), clock: () => SETTLED }) });
  const result = await call(service, db, writeArgs()); assert.equal(result.body.ok, true);
  const journal = await saved(db), projected = projectJournal(journal);
  assert.ok(journal.events.some(event => event.kind === 'no_fill')); assert.equal(journal.events.some(event => ['paper_intent', 'actual_confirmation', 'actual_fill'].includes(event.kind)), false);
  assert.equal(projected.entries.find(entry => entry.symbol === 'AAA').status, 'no_fill');
});

test('stalled reader crossing the entry deadline still gets the existing honest no-fill outcome', async t => {
  const db = database(t); await setup(db); let at = ENROLL;
  const published = publication(), supplied = readers([published]);
  const service = app({ now: () => at, observer: observer({ ...supplied, readPublications: async args => { const result = await supplied.readPublications(args); at = '2026-11-24T14:30:00Z'; return result; }, clock: () => at }) });
  const result = await call(service, db, writeArgs()); assert.equal(result.body.ok, true);
  const journal = await saved(db); assert.ok(journal.events.some(event => event.kind === 'no_fill')); assert.equal(journal.events.some(event => event.kind === 'paper_intent'), false);
});

test('even a malicious injected observer cannot append an actual confirmation', async t => {
  const db = database(t); await setup(db); const real = observer({ ...readers([publication()]) });
  const service = app({ observer: { async observe(input) {
    const proposal = await real.observe(input); const intent = proposal.journal.events.find(event => event.kind === 'paper_intent');
    const actual = await recordActualConfirmation(proposal.journal, { id: 'synthetic-forbidden-confirmation', at: ENROLL, intentId: intent.id, confirmed: true }); assert.equal(actual.ok, true);
    return { ...proposal, journal: actual.journal, changed: true };
  } } });
  assert.equal((await call(service, db, writeArgs())).body.error, 'observer_invalid_proposal'); assert.deepEqual(await saved(db), base()); assert.equal(db.batchCount, 1);
});

test('reader exceptions are redacted and cannot be laundered as successful writes', async t => {
  const db = database(t); await setup(db);
  const service = app({ observer: { observe() { throw Error('private SQL and synthetic secret must not appear'); } } });
  const result = await call(service, db, writeArgs()); assert.equal(result.body.error, 'observation_unavailable'); assert.doesNotMatch(JSON.stringify(result.rpc), /private SQL|synthetic secret/); assert.deepEqual(await saved(db), base());
});
