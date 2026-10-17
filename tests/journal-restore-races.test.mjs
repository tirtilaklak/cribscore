import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
import { handleJournalRequest } from '../server/journal-api.js';
import { createJournal, appendSettings, DEFAULT_PAPER_SETTINGS } from '../dist/lib/journal.js';

const origin = 'https://synthetic-empty-restore.example.test', at = '2026-10-17T19:00:00Z';
const empty = id => createJournal({ journalId: id, at: '2026-10-17T18:00:00Z' });
const filled = async id => (await appendSettings(empty(id), { id: 'synthetic-restored-setting', at, settings: DEFAULT_PAPER_SETTINGS })).journal;
async function call(db, journal, expectedRevision = 0, mode = 'append') {
  const request = new Request(origin + '/api/journal', { method: journal ? 'POST' : 'GET', headers: {
    'oai-authenticated-user-id': 'synthetic-restore-owner', ...(journal ? { origin, 'content-type': 'application/json' } : {}),
  }, ...(journal ? { body: JSON.stringify({ journal, expectedRevision, mode }) } : {}) });
  const response = await handleJournalRequest(request, { DB: db }, { now: () => at });
  return { status: response.status, body: await response.json() };
}
function afterNextRead(db, callback) {
  const prepare = db.prepare.bind(db); let once = true;
  db.prepare = sql => {
    const statement = prepare(sql), all = statement.all;
    statement.all = async function () {
      const result = await all.call(this);
      if (once) { once = false; await callback(); }
      return result;
    };
    return statement;
  };
}

test('CAS protects an already-created revision-zero head from a competing empty identity restore', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const initial = empty('synthetic-initial'), winner = empty('synthetic-winning-empty'), loser = await filled('synthetic-losing-backup');
  assert.equal((await call(db, initial)).status, 200);
  afterNextRead(db, async () => assert.equal((await call(db, winner, 0, 'restore')).status, 200));
  const result = await call(db, loser, 0, 'restore');
  assert.equal(result.status, 409); assert.deepEqual(result.body.journal, winner);
  assert.deepEqual((await call(db)).body.journal, winner);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n, 0);
});

test('a no-op restore cannot report the old empty identity after another session restored a new identity', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const initial = empty('synthetic-initial'), winner = await filled('synthetic-winning-backup');
  assert.equal((await call(db, initial)).status, 200);
  afterNextRead(db, async () => assert.equal((await call(db, winner, 0, 'restore')).status, 200));
  const result = await call(db, initial, 0, 'restore');
  assert.deepEqual((await call(db)).body.journal, winner, 'Competing restore really committed');
  assert.equal(db.batchCount, 2, 'The no-op itself must not write');
  assert.equal(result.status, 409, 'A no-op must confirm the saved identity before reporting success');
  assert.deepEqual(result.body.journal, winner);
});

test('a no-op append confirms the current revision after a competing owner-session append', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const initial = await filled('synthetic-existing-backup');
  const next = await appendSettings(initial, { id: 'synthetic-concurrent-setting', at, settings: { ...DEFAULT_PAPER_SETTINGS, paperNotional: '200' } });
  assert.equal(next.ok, true); assert.equal((await call(db, initial)).status, 200);
  afterNextRead(db, async () => assert.equal((await call(db, next.journal, 1)).status, 200));
  const result = await call(db, initial, 1);
  assert.equal(result.status, 409); assert.deepEqual(result.body.journal, next.journal);
  assert.equal(db.batchCount, 2); assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n, 2);
});

test('failed no-op confirmation read cannot report success and does not imply this request attempted a write', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const initial = empty('synthetic-confirmation-read'); assert.equal((await call(db, initial)).status, 200);
  afterNextRead(db, () => {
    const prepare = db.prepare.bind(db); let once = true;
    db.prepare = sql => { const statement = prepare(sql), all = statement.all;
      statement.all = async function () { if (once) { once = false; return { success: false }; } return all.call(this); };
      return statement;
    };
  });
  const result = await call(db, initial, 0, 'restore');
  assert.equal(result.status, 503); assert.equal(result.body.error, 'journal_storage_unavailable');
  assert.equal(db.batchCount, 1); assert.deepEqual((await call(db)).body.journal, initial);
});
