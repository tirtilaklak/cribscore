// Real SQLite persistence with one faulty D1 readback envelope; no listener or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
import { handleJournalRequest } from '../server/journal-api.js';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { createJournal, appendSettings, DEFAULT_PAPER_SETTINGS } from '../dist/lib/journal.js';

const origin = 'https://synthetic-commit-recovery.example.test';
const at = '2026-10-17T18:00:00Z';
const observer = createJournalObserver({ clock: () => at, readObservationContext: () => [{ horizonId: 'next_day', unrankedCount: 0, snapshot: { fixture: 'commit-recovery-only' } }] });
async function call(db, path = '/api/journal', body) {
  const request = new Request(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    'oai-authenticated-user-id': 'synthetic-recovery-owner', ...(body === undefined ? {} : { origin, 'content-type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const response = await handleJournalRequest(request, { DB: db }, { now: () => at, observer });
  return { status: response.status, body: await response.json() };
}

function faultNextRead(db, fault) {
  const prepare = db.prepare.bind(db); let armed = true;
  db.prepare = sql => {
    const statement = prepare(sql), all = statement.all;
    statement.all = async function () {
      const result = await all.call(this);
      if (!armed) return result;
      armed = false;
      return fault === 'unavailable' ? { success: false } : { ...result, results: result.results.map(row => ({ ...row, revision: row.revision + 1 })) };
    };
    return statement;
  };
}

for (const route of ['append', 'observe']) for (const fault of ['unavailable', 'corrupt']) {
  test(`${route}: committed write with ${fault} readback remains uncertain until read and replay reconciliation`, async t => {
    const db = new SQLiteD1(); t.after(() => db.close());
    const initial = createJournal({ journalId: 'synthetic-recovery-journal', at: '2026-10-17T17:00:00Z' });
    assert.equal((await call(db, '/api/journal', { expectedRevision: 0, journal: initial })).status, 200);
    const proposed = await appendSettings(initial, { id: 'synthetic-recovery-settings', at, settings: DEFAULT_PAPER_SETTINGS });
    assert.equal(proposed.ok, true);
    const path = route === 'observe' ? '/api/journal/observe' : '/api/journal';
    const body = route === 'observe' ? { expectedRevision: 0, requestId: 'synthetic-recovery-observation' } : { expectedRevision: 0, journal: proposed.journal };
    db.afterBatch = () => faultNextRead(db, fault);
    const result = await call(db, path, body);
    assert.equal(result.status, 503);
    assert.equal(db.sqlite.prepare('SELECT revision FROM journal_heads').get().revision, 1, 'The write actually committed');
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM journal_events').get().n, 1);
    assert.equal(result.body.error, 'journal_commit_uncertain');
    assert.equal(result.body.journal, undefined);
    assert.equal(result.body.automation, undefined);
    const loaded = await call(db);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.revision, 1);
    const batchCount = db.batchCount;
    const stale = await call(db, path, body);
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body.journal, loaded.body.journal);
    const retry = await call(db, path, { ...body, expectedRevision: 1 });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.journal, loaded.body.journal);
    assert.equal(db.batchCount, batchCount, 'Reconciled replay must not write duplicates');
  });
}

test('a read failure before a commit retains the specific storage error and writes nothing', async t => {
  for (const [fault, error] of [['unavailable', 'journal_storage_unavailable'], ['corrupt', 'journal_storage_corrupt']]) {
    const db = new SQLiteD1(); t.after(() => db.close());
    const initial = createJournal({ journalId: 'synthetic-recovery-journal', at: '2026-10-17T17:00:00Z' });
    assert.equal((await call(db, '/api/journal', { expectedRevision: 0, journal: initial })).status, 200);
    const batchCount = db.batchCount; faultNextRead(db, fault);
    const result = await call(db, '/api/journal/observe', { expectedRevision: 0, requestId: 'synthetic-never-observed' });
    assert.equal(result.status, 503); assert.equal(result.body.error, error); assert.equal(db.batchCount, batchCount);
  }
});
