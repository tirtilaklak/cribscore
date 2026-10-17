// Real coordinator + API + generated migration executed by in-memory SQLite.
// All reader publications/prices/calendars here are explicitly synthetic fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
import { handleJournalRequest } from '../server/journal-api.js';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { projectJournal } from '../dist/lib/journal.js';
import { base, publication, readers, observationContext, ENROLL, SETTLED } from './fixtures/journal-observer.mjs';

const origin = 'https://private.example.test';
const observer = (config = {}, at = ENROLL) => createJournalObserver({ ...config, clock: () => at });
async function call(db, body, opts = {}, path = '/api/journal/observe') {
  const response = await handleJournalRequest(new Request(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-id': 'synthetic-owner' }, body: JSON.stringify(body) }), { DB: db }, { now: () => ENROLL, ...opts });
  return { status: response.status, body: await response.json() };
}
async function setup(db) { const r = await call(db, { expectedRevision: 0, journal: base() }, {}, '/api/journal'); assert.equal(r.status, 200); }
const input = (revision = 0, requestId = 'synthetic-http-observation') => ({ expectedRevision: revision, requestId });
const read = async db => { const response = await handleJournalRequest(new Request(origin + '/api/journal', { headers: { 'oai-authenticated-user-id': 'synthetic-owner' } }), { DB: db }); return (await response.json()).journal; };

test('joint no-pick fixture persists only current two-horizon abstentions with unconfigured publisher', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); const o = observer({ readObservationContext: observationContext });
  const result = await call(db, input(), { observer: o }); assert.equal(result.status, 200); assert.equal(result.body.automation.publisherState, 'unconfigured'); assert.equal(result.body.journal.revision, 2);
  assert.deepEqual(result.body.journal.events.map(e => [e.kind, e.data.horizonId, e.data.date]), [['abstain', 'next_day', '2026-11-24'], ['abstain', 'next_week', '2026-11-24']]);
  assert.ok(result.body.journal.events.every(e => e.data.unrankedCount === 6)); assert.equal(projectJournal(result.body.journal).summary.pending, 0);
  const before = db.batchCount, again = await call(db, input(2), { observer: o }); assert.equal(again.status, 200); assert.equal(again.body.revision, 2); assert.equal(db.batchCount, before);
});
test('joint authoritative publication stays pending when reviewed prices are absent, with stable duplicate behavior', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); const publications = [publication({ symbols: ['AAA', 'BBB'] })], o = observer(readers(publications));
  const first = await call(db, input(), { observer: o }); assert.equal(first.status, 200); assert.equal(first.body.journal.events.filter(e => e.kind === 'paper_intent').length, 2);
  const before = db.batchCount, again = await call(db, input(first.body.revision), { observer: o }); assert.equal(again.status, 200); assert.equal(db.batchCount, before); assert.equal(again.body.revision, first.body.revision);
  const later = await call(db, input(first.body.revision, 'missing-prices'), { observer: observer(readers(publications), SETTLED), now: () => SETTLED }); assert.equal(later.status, 200);
  for (const row of projectJournal(later.body.journal).entries) { assert.equal(row.status, 'pending'); assert.equal(row.paper.entryPrice, null); assert.equal(row.paper.totalPnl, null); assert.equal(row.paper.benchmarkPnl, null); assert.equal(row.actual.confirmed, false); }
  assert.ok(later.body.automation.pendingReasons.length > 0); assert.equal(later.body.journal.events.some(e => e.kind === 'actual_fill'), false);
});
test('joint verified holiday/early-close calendar persists exact next-five-session window', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); const r = await call(db, input(), { observer: observer(readers([publication({ horizon: 'next_week' })])) }); assert.equal(r.status, 200);
  const w = r.body.journal.events.find(e => e.kind === 'paper_intent').data.window;
  assert.deepEqual(w.sessions.map(s => s.date), ['2026-11-24', '2026-11-25', '2026-11-27', '2026-11-30', '2026-12-01']); assert.equal(w.sessions[2].closeAt, '2026-11-27T18:00:00Z'); assert.equal(w.exitAt, '2026-12-01T21:00:00Z');
  assert.deepEqual((await read(db)).events.find(e => e.kind === 'paper_intent').data.window, w);
});
test('joint late trusted read records no-fill without backdated paper position', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db); let current = ENROLL; const config = readers([publication()]), original = config.readCalendar;
  config.readCalendar = async context => { const result = await original(context); current = '2026-11-24T14:30:00Z'; return result; };
  const o = createJournalObserver({ ...config, clock: () => current }), r = await call(db, input(), { observer: o, now: () => current }); assert.equal(r.status, 200);
  assert.equal(r.body.journal.events.some(e => e.kind === 'paper_intent'), false); assert.equal(projectJournal(r.body.journal).entries[0].status, 'no_fill'); assert.equal(r.body.automation.checkedAt, current);
});
test('joint reviewed marks settle only previously persisted timely intent; late first observation cannot acquire returns', async t => {
  const p = publication({ horizon: 'next_week' }), db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
  const first = await call(db, input(), { observer: observer(readers([p])) }); assert.equal(first.status, 200);
  const settled = await call(db, input(first.body.revision, 'settlement'), { observer: observer(readers([p], { marks: true }), SETTLED), now: () => SETTLED }); assert.equal(settled.status, 200);
  const row = projectJournal(settled.body.journal).entries[0]; assert.equal(row.status, 'closed', JSON.stringify({row, automation:settled.body.automation})); assert.notEqual(row.paper.realizedPnl, null); assert.notEqual(row.paper.benchmarkPnl, null); assert.equal(row.actual.confirmed, false);
  const lateDb = new SQLiteD1(); t.after(() => lateDb.close()); await setup(lateDb); const late = await call(lateDb, input(), { observer: observer(readers([p], { marks: true }), SETTLED), now: () => SETTLED }); assert.equal(late.status, 200); assert.equal(projectJournal(late.body.journal).entries[0].status, 'no_fill'); assert.equal(late.body.journal.events.some(e => e.kind === 'paper_evaluation'), false);
});
test('joint unavailable or malformed authoritative reader preserves history and truthful current state', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
  const unavailable = await call(db, input(), { observer: observer({ readPublications: async () => { throw Error('synthetic-private-reader-error'); }, readObservationContext: observationContext }) }); assert.equal(unavailable.status, 200); assert.equal(unavailable.body.automation.publisherState, 'unavailable'); assert.equal(unavailable.body.revision, 0); assert.equal(db.batchCount, 1);
  const p = publication(); p.payloadBytes += ' '; const invalid = await call(db, input(), { observer: observer(readers([p])) }); assert.equal(invalid.status, 503); assert.equal(invalid.body.error, 'observation_unavailable'); assert.equal((await read(db)).revision, 0); assert.equal(db.batchCount, 1);
});
test('joint CAS conflict and atomic rollback preserve the winning journal without partial publication rows', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await setup(db);
  db.beforeBatch = async () => { const winner = await call(db, input(), { observer: observer({ readObservationContext: observationContext }) }); assert.equal(winner.status, 200); };
  const race = await call(db, input(), { observer: observer(readers([publication()])) }); assert.equal(race.status, 409); assert.ok(race.body.journal.events.every(e => e.kind === 'abstain'));
  const separate = new SQLiteD1(); t.after(() => separate.close()); await setup(separate); separate.failAt = 1;
  const rollback = await call(separate, input(), { observer: observer(readers([publication()])) }); assert.equal(rollback.status, 503); assert.equal(rollback.body.error, 'journal_commit_uncertain'); assert.equal((await read(separate)).revision, 0); assert.equal(separate.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n, 0);
});
