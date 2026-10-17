import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
import { handleJournalRequest, JOURNAL_API_LIMITS } from '../server/journal-api.js';
import { createJournal, recordAbstention, appendSettings, DEFAULT_PAPER_SETTINGS, enrollPublication, evaluatePaper, projectJournal } from '../dist/lib/journal.js';

const origin = 'https://private.example.test';
const initialAt = '2026-10-17T17:00:00Z';
const entryAt = '2026-10-19T13:30:00Z';
const exitAt = '2026-10-19T20:00:00Z';
const beforeEntry = '2026-10-19T13:29:00Z';
const afterEntry = '2026-10-19T21:00:00Z';
const base = () => createJournal({ journalId: 'synthetic-api-fixture', at: initialAt });
const window = { calendarId: 'synthetic-calendar', calendarSha256: 'a'.repeat(64), timeZone: 'America/New_York', publishedAt: initialAt, horizonSessions: 1, entrySession: '2026-10-19', exitSession: '2026-10-19', entryAt, exitAt, sessions: [{ date: '2026-10-19', openAt: entryAt, closeAt: exitAt }] };
const request = ({ path = '/api/journal/observe', method = 'POST', owner = 'owner-a', body = { expectedRevision: 0, requestId: 'synthetic-request' }, headers = {} } = {}) => new Request(origin + path, { method, headers: { ...(owner ? { 'oai-authenticated-user-id': owner } : {}), ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...headers }, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
async function call(db, input = {}, options = {}) { const response = await handleJournalRequest(request(input), { DB: db }, { now: () => beforeEntry, ...options }); return { status: response.status, body: await response.json() }; }
async function setup(db, journal = base(), owner = 'owner-a') { const r = await call(db, { path: '/api/journal', owner, body: { expectedRevision: 0, journal } }); assert.equal(r.status, 200); return r.body.journal; }
const metadata = (journal, prior, at, publisherState = 'ready', pendingReasons = []) => ({ ok: true, journal, baseRevision: prior.revision, changed: journal.revision !== prior.revision, observedAt: at, automation: { publisherState, checkedAt: at, pendingReasons } });
async function publication() {
  const payload = { schema_version: 'synthetic-v1', policy_version: 'synthetic-policy', generated_at: initialAt, horizon: { id: 'next_day', entry_at: entryAt, exit_at: exitAt }, rows: [{ ticker: 'AAA', company: 'Synthetic fixture only' }] };
  const payloadBytes = JSON.stringify(payload), hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadBytes));
  return { publicationId: 'synthetic-observed-publication', publishedAt: initialAt, payloadBytes, payloadHash: [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join(''), policyVersion: payload.policy_version, snapshotVersion: payload.schema_version, horizonId: 'next_day', entities: [{ symbol: 'AAA', entityId: 'synthetic-AAA' }] };
}
function paperObserver({ receipt, evaluate = false, onObserve } = {}) { return { async observe(context) {
  onObserve?.(context); const at = receipt || context.receivedAt;
  const enrolled = await enrollPublication(context.journal, { id: 'synthetic-pub-1', at, publication: await publication(), windowResolution: { status: 'resolved', window } });
  assert.equal(enrolled.ok, true); let journal = enrolled.journal;
  if (evaluate) { const result = await evaluatePaper(journal, { at, eventIdPrefix: 'synthetic-evaluation', resolvers: { resolvePriceMark: () => ({ status: 'pending', reasons: ['verified_prices_unavailable'] }) } }); assert.equal(result.ok, true); journal = result.journal; }
  return metadata(journal, context.journal, at, 'ready', ['verified_prices_unavailable']);
} }; }
const unchangedObserver = { observe: async ({ journal, receivedAt }) => metadata(journal, journal, receivedAt, 'empty') };
function abstainObserver() { return { async observe({ journal, receivedAt }) { const r = await recordAbstention(journal, { id: 'synthetic-abstain', at: receivedAt, date: receivedAt.slice(0, 10), horizonId: 'next_day', reason: 'Synthetic explicit no-pick fixture.' }); assert.equal(r.ok, true); return metadata(r.journal, journal, receivedAt, 'empty'); } }; }

// Every fixture is in-memory; nothing targets a hosted or user journal.
test('observation authentication, method and same-origin gates run before trusted observer', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); let invoked = 0;
  const observer = { observe() { invoked++; throw Error('must not run'); } };
  assert.equal((await call(db, { owner: null }, { observer })).status, 401);
  assert.equal((await call(db, { owner: null, headers: { 'oai-sites-authorization': 'Bearer synthetic-service' } }, { observer })).status, 401);
  assert.equal((await call(db, { method: 'GET' }, { observer })).status, 405);
  for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) assert.equal((await call(db, { headers }, { observer })).status, 403);
  assert.equal((await call(db, { headers: { 'content-type': 'text/plain' } }, { observer })).status, 415);
  assert.equal(invoked, 0); assert.equal(db.calls.length, 0);
});
test('observation requires deliberate setup, configured observer and current revision', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  assert.equal((await call(db, {}, { observer: unchangedObserver })).body.error, 'journal_setup_required');
  await setup(db);
  assert.equal((await call(db)).body.error, 'observer_unconfigured');
  let invoked = false;
  const r = await call(db, { body: { expectedRevision: 1, requestId: 'request' } }, { observer: { observe() { invoked = true; } } });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'revision_conflict'); assert.deepEqual(r.body.journal, base()); assert.equal(invoked, false);
});
test('only exact revision/request ID are accepted; client authority, marks, clock and ownership are rejected', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); let invoked = 0;
  const observer = { observe() { invoked++; throw Error('must not run'); } };
  for (const key of ['publication', 'journal', 'marks', 'time', 'at', 'ownerId', 'ownerScope', 'receivedAt', 'automation', 'authority', 'mode', 'clock']) {
    const r = await call(db, { body: { expectedRevision: 0, requestId: 'request', [key]: {} } }, { observer }); assert.equal(r.status, 400, key); assert.equal(r.body.error, 'invalid_observation_request');
  }
  for (const body of [null, [], {}, { requestId: 'request' }, { expectedRevision: 0 }, { expectedRevision: -1, requestId: 'r' }, { expectedRevision: 0.5, requestId: 'r' }, { expectedRevision: '0', requestId: 'r' }, { expectedRevision: 0, requestId: '' }, { expectedRevision: 0, requestId: 'x'.repeat(97) }, { expectedRevision: 0, requestId: '../malicious' }]) assert.equal((await call(db, { body }, { observer })).status, 400);
  assert.equal((await call(db, { body: '{"expectedRevision":999,"expectedRevision":0,"requestId":"x"}' }, { observer })).body.error, 'duplicate_json_key');
  assert.equal((await call(db, { body: ' '.repeat(JOURNAL_API_LIMITS.observationBodyBytes + 1) }, { observer })).status, 413);
  assert.equal(invoked, 0); assert.equal(db.batchCount, 1);
});
test('trusted publication enrolls before entry; missing prices persist pending and never fabricate an actual fill', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); let seen;
  const observer = paperObserver({ onObserve: value => { seen = value; } });
  const first = await call(db, {}, { observer }); assert.equal(first.status, 200); assert.equal(first.body.revision, 2);
  assert.equal(seen.ownerScope, 'owner-a'); assert.equal(seen.receivedAt, beforeEntry); assert.equal(seen.requestId, 'synthetic-request'); assert.ok(Object.isFrozen(seen.journal));
  let entry = projectJournal(first.body.journal).entries[0]; assert.equal(entry.status, 'pending'); assert.equal(entry.paper.entryPrice, null); assert.equal(entry.paper.totalPnl, null); assert.equal(entry.actual.confirmed, false);
  const later = await call(db, { body: { expectedRevision: first.body.revision, requestId: 'later' } }, { observer: paperObserver({ evaluate: true }), now: () => afterEntry });
  assert.equal(later.status, 200); assert.equal(later.body.journal.events.filter(e => e.kind === 'paper_intent').length, 1);
  entry = projectJournal(later.body.journal).entries.find(e => e.symbol === 'AAA'); assert.equal(entry.status, 'pending'); assert.equal(entry.paper.entryPrice, null); assert.equal(entry.paper.totalPnl, null); assert.ok(entry.paper.pendingReasons.includes('verified_prices_unavailable')); assert.equal(entry.paper.benchmarkPnl, null);
  assert.equal(later.body.journal.events.some(e => e.kind === 'actual_fill'), false);
  assert.equal(later.body.automation.publisherState, 'ready');
  assert.equal(db.sqlite.prepare("SELECT received_at FROM journal_events WHERE event_index=1").get().received_at, beforeEntry);
});
test('repeated observations deduplicate the publication and become write-free after one duplicate marker', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); const observer = paperObserver();
  const one = await call(db, {}, { observer }); const stale = await call(db, {}, { observer }); assert.equal(stale.status, 409); assert.equal(stale.body.revision, one.body.revision);
  const two = await call(db, { body: { expectedRevision: one.body.revision, requestId: 'synthetic-request' } }, { observer }); assert.equal(two.status, 200); assert.equal(two.body.revision, 3);
  const before = db.batchCount; const three = await call(db, { body: { expectedRevision: two.body.revision, requestId: 'synthetic-request' } }, { observer }); assert.equal(three.status, 200); assert.equal(three.body.revision, two.body.revision); assert.equal(db.batchCount, before);
  assert.equal(three.body.journal.events.filter(e => e.kind === 'paper_intent').length, 1); assert.equal(three.body.journal.events.filter(e => e.kind === 'duplicate').length, 1);
});
test('first observation at or after entry records no-fill with no paper position', async t => {
  for (const at of [entryAt, afterEntry]) { const db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
    const r = await call(db, {}, { observer: paperObserver(), now: () => at }); assert.equal(r.status, 200); assert.equal(r.body.journal.events.some(e => e.kind === 'paper_intent'), false); assert.equal(projectJournal(r.body.journal).entries[0].status, 'no_fill');
  }
});
test('reader delay that crosses entry rejects before persistence; retry produces honest no-fill', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); let current = beforeEntry;
  const delegate = paperObserver(); const observer = { async observe(context) { const r = await delegate.observe(context); current = entryAt; return r; } };
  const r = await call(db, {}, { observer, now: () => current }); assert.equal(r.status, 422); assert.equal(r.body.error, 'observation_crossed_entry_retry'); assert.equal(db.batchCount, 1);
  const retry = await call(db, {}, { observer: paperObserver(), now: () => current }); assert.equal(retry.status, 200); assert.equal(projectJournal(retry.body.journal).entries[0].status, 'no_fill');
});
test('final precommit high-water recheck catches crossing after validated observer result', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); let samples = 0;
  const r = await call(db, {}, { observer: paperObserver(), now: () => ++samples >= 4 ? entryAt : beforeEntry });
  assert.equal(r.status, 422); assert.equal(r.body.error, 'observation_crossed_entry_retry'); assert.equal(db.batchCount, 1); assert.equal(samples, 4);
});
test('backward clock cannot resurrect an entry already crossed at request receipt', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); let samples = 0;
  const r = await call(db, {}, { observer: paperObserver({ receipt: beforeEntry }), now: () => ++samples === 1 ? entryAt : beforeEntry });
  assert.equal(r.status, 503); assert.equal(r.body.error, 'observer_invalid_proposal'); assert.equal(db.batchCount, 1);
});
test('streamed observation body receives completion time before trusted observer invocation', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); let current = beforeEntry, seen;
  const body = new ReadableStream({ pull(controller) { current = entryAt; controller.enqueue(new TextEncoder().encode('{"expectedRevision":0,"requestId":"streamed"}')); controller.close(); } });
  const req = new Request(origin + '/api/journal/observe', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-id': 'owner-a' }, body, duplex: 'half' });
  const response = await handleJournalRequest(req, { DB: db }, { observer: paperObserver({ onObserve: value => { seen = value; } }), now: () => current });
  assert.equal(response.status, 200); const r = await response.json(); assert.equal(seen.receivedAt, entryAt); assert.equal(projectJournal(r.journal).entries[0].status, 'no_fill');
});
test('unconfigured publisher and complete empty context may persist explicit abstention with honest metadata', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
  const observer = abstainObserver(); const r = await call(db, {}, { observer }); assert.equal(r.status, 200); assert.equal(projectJournal(r.body.journal).summary.abstentions, 1); assert.equal(r.body.automation.publisherState, 'empty');
  const noPublisher = { async observe(context) { return metadata(context.journal, context.journal, context.receivedAt, 'unconfigured', ['publisher_unconfigured']); } };
  const next = await call(db, { body: { expectedRevision: r.body.revision, requestId: 'again' } }, { observer: noPublisher }); assert.equal(next.status, 200); assert.equal(next.body.automation.publisherState, 'unconfigured'); assert.equal(next.body.revision, r.body.revision);
});
test('generic POST cannot acquire publisher authority by installing the trusted observation option', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
  const proposed = await paperObserver().observe({ journal: base(), receivedAt: beforeEntry });
  const r = await call(db, { path: '/api/journal', body: { expectedRevision: 0, journal: proposed.journal } }, { observer: paperObserver() });
  assert.equal(r.status, 503); assert.equal(r.body.error, 'publisher_unconfigured'); assert.equal(db.batchCount, 1);
});
test('owner journal and observer scope remain isolated even on conflict', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); const a = await call(db, {}, { observer: abstainObserver() });
  const missing = await call(db, { owner: 'owner-b' }, { observer: unchangedObserver }); assert.equal(missing.body.error, 'journal_setup_required'); assert.equal(missing.body.journal, null);
  await setup(db, createJournal({ journalId: 'synthetic-owner-b', at: initialAt }), 'owner-b'); let scope;
  const observer = { async observe(context) { scope = context.ownerScope; return unchangedObserver.observe(context); } };
  const b = await call(db, { owner: 'owner-b' }, { observer }); assert.equal(b.status, 200); assert.equal(scope, 'owner-b'); assert.equal(b.body.journal.revision, 0); assert.notDeepEqual(b.body.journal, a.body.journal);
  const conflict = await call(db, { owner: 'owner-b', body: { expectedRevision: 1, requestId: 'b' } }, { observer }); assert.equal(conflict.status, 409); assert.equal(conflict.body.journal.journalId, 'synthetic-owner-b');
});
test('invalid trusted proposals fail closed: identity, history, graph, hash, event types and metadata', async t => {
  for (const change of [
    p => { p.baseRevision++; }, p => { p.changed = false; }, p => { p.journal.journalId = 'other'; }, p => { p.journal.events[0].data.payloadHash = 'a'.repeat(64); },
    p => { p.observedAt = '2027-01-01T00:00:00Z'; }, p => { p.automation.checkedAt = initialAt; }, p => { p.automation.pendingReasons = ['raw private reader error message']; },
  ]) { const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); const delegate = paperObserver(); const observer = { async observe(context) { const p = structuredClone(await delegate.observe(context)); change(p); return p; } }; const r = await call(db, {}, { observer }); assert.equal(r.status, 503); assert.equal(r.body.error, 'observer_invalid_proposal'); assert.equal(db.batchCount, 1); }
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
  const observer = { async observe(c) { const r = await appendSettings(c.journal, { id: 'unexpected-settings', at: c.receivedAt, settings: DEFAULT_PAPER_SETTINGS }); return metadata(r.journal, c.journal, c.receivedAt); } };
  assert.equal((await call(db, {}, { observer })).body.error, 'observer_invalid_proposal'); assert.equal(db.batchCount, 1);
});
test('observer throws or unavailable result never leaks diagnostics or mutates journal', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
  for (const observer of [{ observe() { throw Error('synthetic-private-token secret'); } }, { observe: () => ({ ok: false, errors: ['synthetic-private-token'] }) }]) {
    const r = await call(db, {}, { observer }); assert.equal(r.status, 503); assert.equal(r.body.error, 'observation_unavailable'); assert.doesNotMatch(JSON.stringify(r.body), /token|secret/);
  } assert.equal(db.batchCount, 1);
});
test('atomic observation failure rolls back every generated event and head revision', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); db.failAt = 1;
  const r = await call(db, {}, { observer: paperObserver() }); assert.equal(r.status, 503); assert.equal(r.body.error, 'journal_commit_uncertain');
  assert.equal(db.sqlite.prepare('SELECT revision FROM journal_heads').get().revision, 0); assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n, 0);
});
test('CAS race returns latest owner journal and commits none of losing observation proposal', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
  db.beforeBatch = async () => { assert.equal((await call(db, {}, { observer: abstainObserver() })).status, 200); };
  const r = await call(db, {}, { observer: paperObserver() }); assert.equal(r.status, 409); assert.equal(r.body.journal.events.length, 1); assert.equal(r.body.journal.events[0].kind, 'abstain');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n, 1);
});
test('postcommit competing write returns conflict, not false saved observation state', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
  db.afterBatch = async () => { const r = await call(db, { body: { expectedRevision: 2, requestId: 'other' } }, { observer: abstainObserver() }); assert.equal(r.status, 200); };
  const r = await call(db, {}, { observer: paperObserver() }); assert.equal(r.status, 409); assert.equal(r.body.revision, 3); assert.equal(r.body.journal.events.at(-1).kind, 'abstain'); assert.equal(r.body.automation, undefined);
});

test('no-op observer rechecks concurrent commits and returns latest revision as conflict', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
  const observer = { async observe(context) { const winner = await call(db, {}, { observer: abstainObserver() }); assert.equal(winner.status, 200); return unchangedObserver.observe(context); } };
  const r = await call(db, {}, { observer }); assert.equal(r.status, 409); assert.equal(r.body.revision, 1); assert.equal(r.body.journal.events[0].kind, 'abstain'); assert.equal(r.body.automation, undefined); assert.equal(db.batchCount, 2);
});
