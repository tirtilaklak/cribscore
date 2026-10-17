import test from 'node:test';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const { handleJournalRequest, JOURNAL_API_LIMITS } = await import(process.env.JOURNAL_API_UNDER_REVIEW || new URL('server/journal-api.js', root).href);
const { createJournal } = await import(new URL('dist/lib/journal.js', root));
const { SQLiteD1 } = await import(new URL('tests/helpers/sqlite-d1.mjs', root));
const at = '2026-10-17T21:00:00Z', origin = 'https://body-race.synthetic.invalid';
const encoder = new TextEncoder();
const journal = () => createJournal({ journalId: 'synthetic-race', at });
const bytes = () => encoder.encode(JSON.stringify({ expectedRevision: 0, journal: journal() }));
const request = (body, { signal, path = '/api/journal', headers = {} } = {}) => new Request(origin + path, {
  method: 'POST', body, duplex: 'half', signal,
  headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-id': 'synthetic-owner', ...headers },
});
const call = async (db, req, options = {}) => {
  const response = await handleJournalRequest(req, { DB: db }, { now: () => at, bodyTimeoutMs: 1000, ...options });
  return { status: response.status, body: await response.json() };
};
const fail = (status, error) => ({ status, body: { ok: false, error } });

for (const order of ['abort_then_close', 'close_then_abort']) test(`final read ${order} cannot commit a valid payload`, async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const controller = new AbortController(); let pulls = 0;
  const stream = new ReadableStream({ pull(c) {
    if (++pulls === 1) c.enqueue(bytes());
    else if (order === 'abort_then_close') { controller.abort(); c.close(); }
    else { c.close(); controller.abort(); }
  } });
  assert.deepEqual(await call(db, request(stream, { signal: controller.signal })), fail(408, 'journal_request_cancelled'));
  assert.equal(db.batchCount, 0);
});

test('immediate empty chunks remain bounded when monotonic time is frozen', async t => {
  assert.equal(JOURNAL_API_LIMITS.bodyChunks, 16_384);
  t.mock.method(performance, 'now', () => 0);
  const db = new SQLiteD1(); t.after(() => db.close()); let pulls = 0, cancelled = 0;
  const stream = new ReadableStream({ pull(c) {
    // Bound the regression fixture too: the unfixed reader would eventually write.
    if (++pulls <= 20_000) c.enqueue(new Uint8Array(0));
    else { c.enqueue(bytes()); c.close(); }
  }, cancel() { cancelled++; return new Promise(() => {}); } });
  assert.deepEqual(await call(db, request(stream)), fail(413, 'journal_request_too_fragmented'));
  assert.ok(pulls <= JOURNAL_API_LIMITS.bodyChunks + 2); assert.equal(cancelled, 1); assert.equal(db.batchCount, 0);
});

test('monotonic elapsed deadline rejects immediate reads before the timer callback runs', async t => {
  let calls = 0; t.mock.method(performance, 'now', () => calls++ ? 1001 : 0);
  const db = new SQLiteD1(); t.after(() => db.close());
  const stream = new ReadableStream({ start(c) { c.enqueue(bytes()); c.close(); } });
  assert.deepEqual(await call(db, request(stream)), fail(408, 'journal_request_timed_out'));
  assert.equal(db.batchCount, 0);
});

test('stalled reader cancellation never has to settle for the timeout response', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); let cancelled = 0;
  const stream = new ReadableStream({ start(c) { c.enqueue(encoder.encode('{')); }, cancel() { cancelled++; return new Promise(() => {}); } });
  assert.deepEqual(await call(db, request(stream), { bodyTimeoutMs: 10 }), fail(408, 'journal_request_timed_out'));
  assert.equal(cancelled, 1); assert.equal(db.batchCount, 0);
});

test('detected overflow keeps its error when stream cancellation throws', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); let cancelled = 0;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(JOURNAL_API_LIMITS.observationBodyBytes + 1)); }, cancel() { cancelled++; throw Error('private cancellation detail'); } });
  assert.deepEqual(await call(db, request(stream, { path: '/api/journal/observe' })), fail(413, 'journal_request_too_large'));
  assert.equal(cancelled, 1); assert.equal(db.batchCount, 0);
});

test('authentication and unreadable storage preserve precedence over body and test-limit errors', async t => {
  const db = new SQLiteD1({ migrate: false }); t.after(() => db.close());
  assert.deepEqual(await call(db, request('{', { headers: { 'oai-authenticated-user-id': '' } }), { bodyTimeoutMs: 0 }), fail(401, 'authentication_required'));
  assert.equal(db.calls.length, 0);
  assert.deepEqual(await call(db, request('{'), { bodyTimeoutMs: 0 }), fail(503, 'journal_storage_unavailable'));
  assert.equal(db.batchCount, 0);
});

test('stream errors are redacted and never reach commit', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const stream = new ReadableStream({ start(c) { c.error(Error('private stream detail')); } });
  assert.deepEqual(await call(db, request(stream)), fail(503, 'journal_storage_unavailable'));
  assert.equal(db.batchCount, 0);
});

test('abort and elapsed body limit after dispatch do not race or misreport a successful commit', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const controller = new AbortController();
  let release, dispatched; const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { dispatched = resolve; });
  db.beforeBatch = async () => { controller.abort(); dispatched(); await gate; };
  let completed = false;
  const operation = call(db, request(bytes(), { signal: controller.signal }), { bodyTimeoutMs: 20 }).then(result => { completed = true; return result; });
  await entered; await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(completed, false);
  release(); const result = await operation;
  assert.equal(result.status, 200); assert.deepEqual(result.body.journal, journal()); assert.equal(db.batchCount, 1);
});

test('post-commit readback failure stays uncertain even when the request is aborted', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const controller = new AbortController();
  db.afterBatch = async () => { controller.abort(); db.prepare = () => { throw Error('private readback detail'); }; };
  assert.deepEqual(await call(db, request(bytes(), { signal: controller.signal })), fail(503, 'journal_commit_uncertain'));
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM journal_heads').get().n, 1);
});
