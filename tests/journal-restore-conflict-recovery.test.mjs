// Real API/controller recovery after a durable restore returns 409; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
import { handleJournalRequest } from '../server/journal-api.js';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { createDeskTools } from '../dist/lib/desk-tools.js';
import * as domain from '../dist/lib/journal.js';

const at = '2026-10-17T18:00:00Z', createdAt = '2026-10-17T17:00:00Z';
const origin = 'https://synthetic-restore-conflict.example.test';
const empty = id => domain.createJournal({ journalId: id, at: createdAt });
async function setting(journal, id, amount = '125') {
  const result = await domain.appendSettings(journal, { id, at, settings: { ...domain.DEFAULT_PAPER_SETTINGS, paperNotional: amount } });
  assert.equal(result.ok, true); return result.journal;
}
async function harness(t, initial) {
  const db = new SQLiteD1(), handlers = {}, blobs = [], postResponses = [];
  const observer = createJournalObserver({ clock: () => at });
  const originalFD = globalThis.FormData, originalURL = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  globalThis.FormData = class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } };
  URL.createObjectURL = blob => { blobs.push(blob); return 'blob:synthetic-restore-conflict'; }; URL.revokeObjectURL = () => {};
  const request = (path, options = {}, owner = 'synthetic-conflict-owner') => handleJournalRequest(new Request(origin + path, {
    ...options, headers: { 'oai-authenticated-user-id': owner, ...(options.method === 'POST' ? { origin, 'content-type': 'application/json' } : {}) },
  }), { DB: db }, { now: () => at, observer });
  const post = async (journal, expectedRevision, mode = 'append', owner) => {
    const response = await request('/api/journal', { method: 'POST', body: JSON.stringify({ journal, expectedRevision, mode }) }, owner);
    return { status: response.status, body: await response.json() };
  };
  if (initial) assert.equal((await post(initial, 0)).status, 200);
  const document = { querySelector: () => null, addEventListener: (kind, handler) => { handlers[kind] = handler; }, removeEventListener() {}, body: { append() {} }, createElement: () => ({ click() {}, remove() {} }) };
  let sequence = 0, nextPostJournal;
  const app = createDeskTools({ document, now: () => at, uuid: () => `synthetic-conflict-${++sequence}`, fetch: async (path, options) => {
    const response = await request(path, options);
    if (path === '/api/journal' && options.method === 'POST') postResponses.push({ status: response.status, body: await response.clone().json() });
    if (path === '/api/journal' && options.method === 'POST' && nextPostJournal !== undefined) {
      const journal = nextPostJournal; nextPostJournal = undefined;
      return new Response(JSON.stringify({ ok: false, error: 'revision_conflict', journal, revision: journal.revision }), { status: 409 });
    }
    return response;
  } });
  t.after(() => { app.destroy(); db.close(); globalThis.FormData = originalFD; URL.createObjectURL = originalURL; URL.revokeObjectURL = originalRevoke; });
  const settle = async () => { for (let n = 0; n < 40; n++) await new Promise(resolve => setImmediate(resolve)); assert.equal(app.status().busy, false); };
  const action = async name => { const target = { dataset: { journalAction: name }, closest: () => target }; handlers.click({ target }); await settle(); };
  const review = async journal => {
    const text = JSON.stringify(journal), form = { dataset: { journalForm: 'import', deskDirty: 'true', deskEditVersion: '1' }, values: { file: { size: Buffer.byteLength(text), text: async () => text } }, closest: () => form };
    handlers.submit({ target: form, preventDefault() {} }); await settle(); assert.match(app.html('journal'), /Apply reviewed backup/);
  };
  await app.start();
  return { app, db, post, postResponses, action, review,
    overrideNextPost(journal) { nextPostJournal = journal; },
    remote: async owner => (await (await request('/api/journal', {}, owner)).json()).journal,
    exported: async () => { await action('export'); return JSON.parse(await blobs.at(-1).text()); },
  };
}

for (const initialKind of ['null', 'empty']) test(`${initialKind} base: durable restore with post-batch 409 recovers its verified extension without rewriting`, { concurrency: false }, async t => {
  const initial = initialKind === 'null' ? null : empty('synthetic-original'), backup = await setting(empty('synthetic-backup'), 'synthetic-restored-event');
  const extended = await setting(backup, 'synthetic-competing-append', '225');
  const h = await harness(t, initial); await h.review(backup); const preserved = await h.exported();
  h.db.afterBatch = async () => { assert.equal((await h.post(extended, backup.revision)).status, 200); };
  await h.action('confirm-import');
  assert.equal(h.postResponses.at(-1).status, 409);
  assert.equal(h.postResponses.at(-1).body.error, 'revision_conflict');
  assert.deepEqual(h.postResponses.at(-1).body.journal, extended, 'The API confirms another append followed the durable restore');
  assert.equal(h.app.status().storage.state, 'conflict');
  assert.deepEqual(await h.remote(), extended);
  assert.deepEqual(await h.exported(), preserved, 'A failed POST must not promote its response history');
  const writes = h.db.batchCount;
  await h.action('sync');
  assert.equal(h.app.status().storage.state, 'synced', 'A fresh GET must recover the exact reviewed candidate plus a verified extension');
  assert.deepEqual(await h.exported(), extended);
  assert.equal(h.db.batchCount, writes, 'Recovery must not write or duplicate either event');
  assert.equal(h.db.sqlite.prepare('SELECT count(*) AS n FROM journal_events').get().n, 2);
});

for (const initialKind of ['null', 'empty']) for (const competitorKind of ['unrelated identity', 'rewritten candidate event']) {
  test(`${initialKind} base: a restore CAS conflict with ${competitorKind} preserves the existing fresh-read policy`, { concurrency: false }, async t => {
    const initial = initialKind === 'null' ? null : empty('synthetic-cas-original');
    const backup = await setting(empty('synthetic-cas-backup'), 'synthetic-shared-event');
    const winner = await setting(empty(competitorKind === 'unrelated identity' ? 'synthetic-cas-winner' : backup.journalId), 'synthetic-shared-event', '999');
    const h = await harness(t, initial); await h.review(backup); const preserved = await h.exported();
    h.db.beforeBatch = async () => { assert.equal((await h.post(winner, 0, 'restore')).status, 200); };
    await h.action('confirm-import');
    assert.equal(h.postResponses.at(-1).status, 409);
    assert.equal(h.app.status().storage.state, 'conflict');
    assert.deepEqual(await h.remote(), winner);
    assert.deepEqual(await h.exported(), preserved);
    const writes = h.db.batchCount;
    await h.action('sync');
    assert.equal(h.app.status().storage.state, initialKind === 'null' ? 'synced' : 'conflict');
    assert.deepEqual(await h.exported(), initialKind === 'null' ? winner : preserved, 'An ordinary losing restore cannot be mistaken for the committed candidate');
    assert.equal(h.db.batchCount, writes);
    assert.equal(h.db.sqlite.prepare('SELECT count(*) AS n FROM journal_events').get().n, 1);
  });
}

for (const initialKind of ['null', 'empty']) test(`${initialKind} base: a failed response claiming the candidate cannot bypass fresh-read prefix verification`, { concurrency: false }, async t => {
  const initial = initialKind === 'null' ? null : empty('synthetic-hint-original');
  const backup = await setting(empty('synthetic-hint-backup'), 'synthetic-hint-event');
  const winner = await setting(empty('synthetic-hint-winner'), 'synthetic-winner-event', '999');
  const h = await harness(t, initial); await h.review(backup); const preserved = await h.exported();
  h.db.beforeBatch = async () => { assert.equal((await h.post(winner, 0, 'restore')).status, 200); };
  h.overrideNextPost(backup);
  await h.action('confirm-import');
  assert.equal(h.postResponses.at(-1).status, 409);
  assert.deepEqual(await h.remote(), winner);
  assert.deepEqual(await h.exported(), preserved);
  const writes = h.db.batchCount;
  await h.action('sync');
  assert.equal(h.app.status().storage.state, 'conflict');
  assert.deepEqual(await h.exported(), preserved, 'The failed response must not authorize a different persisted identity');
  assert.equal(h.db.batchCount, writes);
});

test('another owner using the restored identity and event ID cannot affect commit confirmation or recovered content', { concurrency: false }, async t => {
  const initial = empty('synthetic-owner-original'), backup = await setting(empty('synthetic-owner-backup'), 'synthetic-owner-shared-event');
  const other = await setting(empty(backup.journalId), 'synthetic-owner-shared-event', '777');
  const h = await harness(t, initial); await h.review(backup);
  h.db.afterBatch = async () => { assert.equal((await h.post(other, 0, 'restore', 'synthetic-other-owner')).status, 200); };
  await h.action('confirm-import');
  assert.equal(h.postResponses.at(-1).status, 200);
  assert.equal(h.app.status().storage.state, 'synced');
  assert.deepEqual(await h.exported(), backup);
  assert.deepEqual(await h.remote(), backup);
  assert.deepEqual(await h.remote('synthetic-other-owner'), other);
  assert.equal(h.db.sqlite.prepare('SELECT count(*) AS n FROM journal_heads').get().n, 2);
});
