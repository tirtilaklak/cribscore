// Offline integration probes: unchanged v11 modules, real SQLite, synthetic owners only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
import { handleJournalRequest } from '../server/journal-api.js';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { createDeskTools } from '../dist/lib/desk-tools.js';
import * as domain from '../dist/lib/journal.js';
const at = '2026-10-17T18:00:00Z', createdAt = '2026-10-17T17:00:00Z';
const origin = 'https://synthetic-cross-session.example.test';
const base = (id = 'synthetic-shared-journal') => domain.createJournal({ journalId: id, at: createdAt });
const setting = async (journal, id, notional = '200') => {
  const r = await domain.appendSettings(journal, { id, at, settings: { ...domain.DEFAULT_PAPER_SETTINGS, paperNotional: notional } });
  assert.equal(r.ok, true); return r.journal;
};
const context = async () => ['next_day', 'next_week'].map(horizonId => ({ horizonId, unrankedCount: 6, snapshot: { fixture: 'unranked-only', eligible: 0 } }));
const noopObserver = createJournalObserver({ clock: () => at });
const abstainObserver = createJournalObserver({ readObservationContext: context, clock: () => at });
function request(path, { method = 'GET', body } = {}) {
  return new Request(origin + path, { method, headers: { 'oai-authenticated-user-id': 'synthetic-cross-session-owner', ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
async function call(db, path = '/api/journal', options = {}, observer = noopObserver) {
  const response = await handleJournalRequest(request(path, options), { DB: db }, { now: () => at, observer });
  return { status: response.status, body: await response.json() };
}
const append = (db, journal, expectedRevision = 0, mode = 'append') => call(db, '/api/journal', { method: 'POST', body: { journal, expectedRevision, mode } });
const read = async db => (await call(db)).body.journal;

// Both requests really execute their initial SQL read before either can write.
// The production SQL transaction is untouched; only the async D1 read envelope pauses.
class ConcurrentD1 extends SQLiteD1 {
  armTwoReads() {
    let release;
    const gate = { seen: 0, promise: new Promise(resolve => { release = resolve; }), release: () => release() };
    this.readGate = gate; return gate;
  }
  prepare(sql) {
    const statement = super.prepare(sql), original = statement.all, db = this;
    statement.all = async function () {
      const result = await original.call(this), gate = db.readGate;
      if (gate) { gate.seen++; if (gate.seen === 2) { db.readGate = null; gate.release(); } await gate.promise; }
      return result;
    };
    return statement;
  }
}

test('two concurrent same-revision appends have one winner; stale and fresh exact replays never duplicate rows', { timeout: 10000 }, async t => {
  const db = new ConcurrentD1(); t.after(() => db.close()); const initial = base(); assert.equal((await append(db, initial)).status, 200);
  const proposals = await Promise.all([setting(initial, 'session-a-settings', '200'), setting(initial, 'session-b-settings', '300')]);
  const gate = db.armTwoReads();
  const results = await Promise.all(proposals.map(journal => append(db, journal)));
  assert.equal(gate.seen, 2); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const winner = results.find(r => r.status === 200).body.journal, loser = results.find(r => r.status === 409);
  assert.deepEqual(loser.body.journal, winner); assert.equal(winner.revision, 1); assert.deepEqual(await read(db), winner);
  const batches = db.batchCount;
  assert.equal((await append(db, winner, 0)).status, 409);
  assert.equal((await append(db, winner, 1)).status, 200); assert.equal(db.batchCount, batches);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM journal_events').get().n, 1);
});

test('concurrent identical observation requests retain two context observations once; stale replay and current replay are safe', { timeout: 10000 }, async t => {
  const db = new ConcurrentD1(); t.after(() => db.close()); await append(db, base());
  const input = { method: 'POST', body: { expectedRevision: 0, requestId: 'synthetic-identical-observe' } };
  const gate = db.armTwoReads();
  const results = await Promise.all([call(db, '/api/journal/observe', input, abstainObserver), call(db, '/api/journal/observe', input, abstainObserver)]);
  assert.equal(gate.seen, 2); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const saved = await read(db); assert.equal(saved.revision, 2); assert.deepEqual(saved.events.map(e => e.kind), ['abstain', 'abstain']);
  assert.deepEqual(saved.events.map(e => e.data.horizonId).sort(), ['next_day', 'next_week']);
  const projection = domain.projectJournal(saved); assert.equal(projection.summary.pending, 0);
  assert.equal(saved.events.some(e => ['publication', 'paper_intent', 'paper_evaluation', 'actual_fill'].includes(e.kind)), false);
  const batches = db.batchCount; assert.equal((await call(db, '/api/journal/observe', input, abstainObserver)).status, 409);
  const replay = await call(db, '/api/journal/observe', { ...input, body: { ...input.body, expectedRevision: saved.revision } }, abstainObserver);
  assert.equal(replay.status, 200); assert.deepEqual(replay.body.journal, saved); assert.equal(db.batchCount, batches);
});

async function controllers(t, { initial = base() } = {}) {
  const db = new ConcurrentD1(); if (initial) assert.equal((await append(db, initial)).status, 200);
  const oldFormData = globalThis.FormData, oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL, blobs = [], clients = [];
  globalThis.FormData = class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } };
  URL.createObjectURL = blob => { blobs.push(blob); return 'blob:synthetic-cross-session'; }; URL.revokeObjectURL = () => {};
  t.after(() => { for (const c of clients) c.app.destroy(); db.close(); globalThis.FormData = oldFormData; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; });
  const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
  function client(name) {
    const handlers = {}, calls = []; let sequence = 0, dropNextPost = false, getOverride;
    const doc = { querySelector: () => null, addEventListener: (kind, fn) => { handlers[kind] = fn; }, removeEventListener() {}, body: { append() {} }, createElement: () => ({ click() {}, remove() {} }) };
    const app = createDeskTools({ document: doc, now: () => at, uuid: () => `${name}-${++sequence}`, fetch: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
      if (options.method === 'GET' && getOverride !== undefined) {
        const journal = getOverride; getOverride = undefined;
        return new Response(JSON.stringify({ ok: true, journal, revision: journal?.revision ?? 0 }), { status: 200 });
      }
      const response = await handleJournalRequest(request(url, options), { DB: db }, { now: () => at, observer: noopObserver });
      if (url === '/api/journal' && options.method === 'POST' && dropNextPost) { dropNextPost = false; assert.equal(response.status, 200); throw Error('Synthetic response lost after durable commit'); }
      return response;
    } });
    const action = async name => { const target = { dataset: { journalAction: name }, closest: () => target }; handlers.click({ target }); await flush(); assert.equal(app.status().busy, false); };
    const submit = async (kind, values) => { const form = { dataset: { journalForm: kind }, values, closest: () => form }; handlers.submit({ target: form, preventDefault() {} }); await flush(); assert.equal(app.status().busy, false); };
    const c = { app, calls, action, submit,
      settings: value => submit('settings', { paperNotional: value, commissionPerFill: '0', slippageBps: '5', benchmarkSymbol: 'SPY' }),
      exported: async () => { await action('export'); return JSON.parse(await blobs.at(-1).text()); },
      import: journal => { const text = JSON.stringify(journal); return submit('import', { file: { size: text.length, text: async () => text } }); },
      loseNextSave: () => { dropNextPost = true; }, overrideNextGet: journal => { getOverride = journal; },
    }; clients.push(c); return c;
  }
  return { db, client };
}

test('two controllers preserve a stale manual draft through a second remote append during reconciliation', { timeout: 10000 }, async t => {
  const h = await controllers(t), a = h.client('a'), b = h.client('b'); await Promise.all([a.app.start(), b.app.start()]);
  await a.settings('200'); const first = await read(h.db); await b.settings('300');
  assert.equal(b.app.status().storage.state, 'conflict'); const draft = await b.exported();
  const localId = draft.events.at(-1).id; assert.equal(draft.events.at(-1).data.settings.paperNotional, '300'); assert.equal((await read(h.db)).events.some(e => e.id === localId), false);
  await b.action('sync'); assert.match(b.app.html('journal'), /Reconcile 1 unsynced event/); assert.deepEqual(await b.exported(), draft);
  await a.settings('400'); const second = await read(h.db); assert.equal(second.revision, 2);
  await b.action('confirm-import'); assert.equal(b.app.status().storage.state, 'conflict'); assert.deepEqual(await b.exported(), draft); assert.deepEqual(await read(h.db), second);
  await b.action('sync'); assert.match(b.app.html('journal'), /Reconcile 1 unsynced event/); await b.action('cancel-import'); assert.deepEqual(await b.exported(), draft);
  await b.action('sync'); await b.action('confirm-import'); const final = await read(h.db);
  assert.equal(b.app.status().storage.state, 'synced'); assert.equal(final.revision, 3); assert.deepEqual(final.events.slice(0, 2), second.events);
  assert.equal(final.events.filter(e => e.id === localId).length, 1); assert.equal(final.events[0].id, first.events[0].id); assert.deepEqual(await b.exported(), final);
  await a.action('sync'); assert.deepEqual(await a.exported(), final);
});

test('a lost manual save response then another session append reconciles the already durable event without duplication', { timeout: 10000 }, async t => {
  const h = await controllers(t), a = h.client('lost-response'), b = h.client('other'); await Promise.all([a.app.start(), b.app.start()]);
  a.loseNextSave(); await a.settings('250'); assert.equal(a.app.status().storage.state, 'unsaved'); const local = await a.exported(); assert.deepEqual(await read(h.db), local);
  await b.action('sync'); await b.settings('350'); const advanced = await read(h.db); assert.equal(advanced.revision, 2);
  await a.action('sync'); assert.match(a.app.html('journal'), /Reconcile 0 unsynced event/); assert.deepEqual(await a.exported(), local);
  const batches = h.db.batchCount; await a.action('confirm-import'); assert.equal(a.app.status().storage.state, 'synced'); assert.deepEqual(await a.exported(), advanced);
  assert.equal(h.db.batchCount, batches); assert.equal((await read(h.db)).events.filter(e => e.id === local.events[0].id).length, 1);
});

test('confirmed cross-session history survives null, older, foreign identity and rewritten-prefix reads, then accepts a real extension', { timeout: 10000 }, async t => {
  const h = await controllers(t), a = h.client('confirmed'), b = h.client('remote'); await Promise.all([a.app.start(), b.app.start()]);
  await a.settings('220'); const confirmed = await a.exported(); await b.action('sync'); await b.settings('330'); const extension = await read(h.db);
  const foreign = await setting(base('synthetic-foreign-journal'), 'foreign-setting');
  const rewritten = await setting(base(), 'replacement-prefix');
  for (const remote of [null, base(), foreign, rewritten]) {
    const calls = a.calls.length; a.overrideNextGet(remote); await a.action('sync'); assert.equal(a.app.status().storage.state, 'conflict');
    assert.deepEqual(await a.exported(), confirmed); assert.equal(a.app.html('journal').includes('Start your private journal'), false);
    assert.equal(a.calls.slice(calls).some(c => c.method === 'POST'), false); assert.deepEqual(await read(h.db), extension);
  }
  assert.equal((await append(h.db, foreign, extension.revision, 'restore')).status, 422); assert.deepEqual(await read(h.db), extension);
  await a.action('sync'); assert.equal(a.app.status().storage.state, 'synced'); assert.deepEqual(await a.exported(), extension);
});

test('concurrent empty-store restores do not mix identities or events and the loser can only reconcile after reading the winner', { timeout: 10000 }, async t => {
  const db = new ConcurrentD1(); t.after(() => db.close());
  const backups = await Promise.all([setting(base('synthetic-backup-a'), 'backup-a', '120'), setting(base('synthetic-backup-b'), 'backup-b', '140')]);
  const gate = db.armTwoReads(), results = await Promise.all(backups.map(journal => append(db, journal, 0, 'restore')));
  assert.equal(gate.seen, 2); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const winner = results.find(r => r.status === 200).body.journal, loser = backups.find(j => j.journalId !== winner.journalId);
  assert.deepEqual(results.find(r => r.status === 409).body.journal, winner); assert.deepEqual(await read(db), winner);
  assert.equal((await append(db, loser, winner.revision, 'restore')).status, 422); assert.deepEqual(await read(db), winner);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM journal_heads').get().n, 1); assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM journal_events').get().n, 1);
});

test('reviewed initial restore does not project after another client starts; conflict preserves export and remote history', { timeout: 10000 }, async t => {
  const h = await controllers(t, { initial: null }), restoring = h.client('restore'), starting = h.client('start');
  await Promise.all([restoring.app.start(), starting.app.start()]); assert.equal(h.db.batchCount, 0);
  const localBefore = await restoring.exported(), backup = await setting(base('synthetic-backup-review'), 'restored-setting', '180');
  await restoring.import(backup); assert.deepEqual(await restoring.exported(), localBefore); assert.equal(h.db.batchCount, 0);
  await starting.action('start'); await starting.settings('280'); const winner = await read(h.db);
  await restoring.action('confirm-import'); assert.equal(restoring.app.status().storage.state, 'conflict'); assert.deepEqual(await restoring.exported(), localBefore); assert.deepEqual(await read(h.db), winner);
  assert.equal(restoring.app.html('journal').includes('restored-setting'), false);
  await restoring.action('sync'); assert.equal(restoring.app.status().storage.state, 'synced'); assert.deepEqual(await restoring.exported(), winner);
});
