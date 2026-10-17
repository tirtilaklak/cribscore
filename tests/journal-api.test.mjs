import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
import { handleJournalRequest, JOURNAL_API_LIMITS } from '../server/journal-api.js';
import { createJournal, recordAbstention, appendSettings, DEFAULT_PAPER_SETTINGS, enrollPublication, validateJournal, evaluatePaper, recordActualConfirmation, recordActualFill } from '../dist/lib/journal.js';

const origin = 'https://private.example.test';
const at = '2026-10-17T17:00:00Z';
const base = (id = 'journal-owner-a') => createJournal({ journalId: id, at });
const options = { now: () => '2026-10-17T17:01:00Z' };
const request = ({ method = 'GET', owner = 'owner-a', body, headers = {}, path = '/api/journal' } = {}) => new Request(origin + path, {
  method, headers: { ...(owner ? { 'oai-authenticated-user-id': owner } : {}), ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...headers },
  ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});
const call = async (db, input, opts = options) => { const response = await handleJournalRequest(request(input), { DB: db }, opts); return { status: response.status, headers: response.headers, body: await response.json() }; };
const post = (journal, expectedRevision = 0, extra = {}) => ({ method: 'POST', body: { journal, expectedRevision, ...extra } });
const abstain = async (journal = base(), id = 'abstain-1', horizonId = 'next_day') => {
  const result = await recordAbstention(journal, { id, at, date: '2026-10-17', horizonId, unrankedCount: 6, snapshot: { eligible: 0 }, reason: 'No authoritative publisher; six unranked cases.' });
  assert.equal(result.ok, true); return result.journal;
};
const setting = async (journal, id = 'settings-1') => (await appendSettings(journal, { id, at, settings: DEFAULT_PAPER_SETTINGS })).journal;

test('initial GET is null, never a fictional journal; responses are private and uncached', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const r = await call(db); assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, revision: 0, journal: null });
  assert.equal(r.headers.get('cache-control'), 'private, no-store'); assert.match(r.headers.get('vary'), /oai-authenticated-user-id/);
  assert.equal(db.calls[0].session, 'first-primary'); assert.equal(db.batchCount, 0);
});
test('missing visitor identity and service token alone are rejected before database access', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  for (const headers of [{}, { 'oai-sites-authorization': 'Bearer synthetic-service-token' }]) {
    const r = await call(db, { owner: null, headers }); assert.equal(r.status, 401); assert.equal(r.body.error, 'authentication_required');
  }
  assert.equal(db.calls.length, 0);
});
test('owner isolation applies to reads, new journals and conflicts, even with identical journal IDs', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await abstain();
  assert.equal((await call(db, post(j))).status, 200);
  assert.equal((await call(db, { owner: 'owner-b' })).body.journal, null);
  const b = await setting(base()); assert.equal((await call(db, { ...post(b), owner: 'owner-b' })).status, 200);
  assert.equal((await call(db)).body.journal.events[0].kind, 'abstain');
  assert.equal((await call(db, { owner: 'owner-b' })).body.journal.events[0].kind, 'settings');
  const denied = await call(db, { method: 'POST', body: { journal: j, expectedRevision: 0, ownerId: 'owner-b' } });
  assert.equal(denied.status, 400); assert.equal(denied.body.error, 'invalid_journal_request');
});
test('same-origin JSON POST rejects cross-site, missing-origin and form requests', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    assert.equal((await call(db, { ...post(base()), headers })).status, 403);
  }
  assert.equal((await call(db, { ...post(base()), headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(db, { method: 'DELETE' })).status, 405);
  assert.equal((await call(db, { path: '/api/other' })).status, 404); assert.equal(db.batchCount, 0);
});
test('valid append preserves old events and records server receipt time; identical retry writes nothing', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await abstain();
  const saved = await call(db, post(j)); assert.equal(saved.status, 200); assert.deepEqual(saved.body.journal, j);
  const after = await setting(j); assert.equal((await call(db, post(after, 1))).status, 200);
  const records = db.sqlite.prepare('SELECT event_json, received_at FROM journal_events ORDER BY event_index').all();
  assert.deepEqual(JSON.parse(records[0].event_json), j.events[0]); assert.equal(records[0].received_at, options.now());
  const before = db.batchCount; assert.equal((await call(db, post(after, 2))).status, 200); assert.equal(db.batchCount, before);
  assert.equal((await call(db)).body.revision, 2);
});
test('stale revisions return 409 with latest own journal and never drop history', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await abstain(); await call(db, post(j));
  const r = await call(db, post(await setting(base()), 0)); assert.equal(r.status, 409); assert.deepEqual(r.body.journal, j); assert.equal(r.body.revision, 1);
});
test('history edits, deletion, identity changes and nonempty restore are rejected', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await abstain(); await call(db, post(j));
  const changed = structuredClone(j); changed.events[0].data.reason = 'Rewritten history';
  for (const candidate of [changed, base(), { ...j, journalId: 'replacement' }]) {
    const r = await call(db, post(candidate, 1, { mode: 'restore' })); assert.equal(r.status, 422); assert.equal(r.body.error, 'append_only_conflict');
  }
  assert.deepEqual((await call(db)).body.journal, j);
});
test('explicit fresh empty restore adopts identity once; ordinary identity replacement is denied', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); await call(db, post(base())); const imported = await abstain(base('backup-identity'));
  assert.equal((await call(db, post(imported))).status, 422);
  assert.equal((await call(db, post(imported, 0, { mode: 'restore' }))).status, 200);
  assert.deepEqual((await call(db)).body.journal, imported);
});
test('SQL batch failure rolls back initial head and all event rows', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); db.failAt = 2;
  const r = await call(db, post(await abstain())); assert.equal(r.status, 503); assert.doesNotMatch(JSON.stringify(r.body), /synthetic atomic failure|owner-private/);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM journal_heads').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM journal_events').get().n, 0);
});
test('race after read is stopped by atomic SQL CAS, including first-create collisions', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const loser = await abstain(); const winner = await setting(base('winner-id'));
  db.beforeBatch = async () => { assert.equal((await call(db, post(winner))).status, 200); };
  const r = await call(db, post(loser)); assert.equal(r.status, 409); assert.deepEqual(r.body.journal, winner);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM journal_events').get().n, 1);
});
test('competing append after a read returns the newest revision without inserting stale rows', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await abstain(); await call(db, post(j));
  const winner = await setting(j, 'winner'); const loser = await setting(j, 'loser');
  db.beforeBatch = async () => { assert.equal((await call(db, post(winner, 1))).status, 200); };
  const r = await call(db, post(loser, 1)); assert.equal(r.status, 409); assert.deepEqual(r.body.journal, winner);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM journal_events WHERE event_id='loser'").get().n, 0);
});
test('newer commit between batch and readback is exposed as conflict, never false synchronization', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await abstain(); const later = await setting(j);
  db.afterBatch = async () => { assert.equal((await call(db, post(later, 1))).status, 200); };
  const r = await call(db, post(j)); assert.equal(r.status, 409); assert.deepEqual(r.body.journal, later);
});
test('missing migration or unavailable D1 is explicit; requests never create tables', async t => {
  const db = new SQLiteD1({ migrate: false }); t.after(() => db.close());
  assert.equal((await call(db)).body.error, 'journal_storage_unavailable');
  const r = await handleJournalRequest(request(), {}, options); assert.equal(r.status, 503);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n, 0);
  assert.doesNotMatch(readFileSync(new URL('../server/journal-api.js', import.meta.url), 'utf8'), /CREATE\s+TABLE|ALTER\s+TABLE|DELETE\s+FROM|UPDATE\s+journal_events/i);
});
test('corrupt stored event, missing row, mismatched ID and bad revision fail closed', async t => {
  for (const sql of ["UPDATE journal_events SET event_json='bad'", "DELETE FROM journal_events", "UPDATE journal_events SET event_id='different'", 'UPDATE journal_heads SET revision=2']) {
    const db = new SQLiteD1(); t.after(() => db.close()); await call(db, post(await abstain())); db.sqlite.exec(sql);
    const r = await call(db); assert.equal(r.status, 503); assert.equal(r.body.error, 'journal_storage_corrupt');
    const attempted = await call(db, post(base())); assert.equal(attempted.status, 503);
  }
});
test('body limit works on declared length and actual streaming bytes, with zero writes', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  assert.equal((await call(db, { ...post(base()), headers: { 'content-length': String(JOURNAL_API_LIMITS.bodyBytes + 1) } })).status, 413);
  assert.equal((await call(db, { method: 'POST', body: ' '.repeat(JOURNAL_API_LIMITS.bodyBytes + 1) })).status, 413);
  assert.equal((await call(db, { method: 'POST', body: '{broken' })).status, 400); assert.equal(db.batchCount, 0);
});
test('schema, event graph, invalid revisions and unknown top-level keys are rejected', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  for (const j of [{ ...base(), schemaVersion: 'future' }, { ...base(), revision: 1 }, { ...base(), events: [{ id: 'bad', kind: 'actual_fill', at, data: {} }], revision: 1 }]) assert.equal((await call(db, post(j))).status, 422);
  for (const expectedRevision of [-1, '0', 0.5]) assert.equal((await call(db, post(base(), expectedRevision))).status, 400);
  assert.equal(db.batchCount, 0);
});
async function paper(window = null) {
  const payload = { schema_version: 'synthetic-v1', policy_version: 'synthetic-policy', generated_at: at, horizon: { id: 'next_day', entry_at: '2026-10-19T13:30:00Z', exit_at: '2026-10-19T20:00:00Z' }, rows: [{ ticker: 'AAA', company: 'Synthetic fixture only' }] };
  const payloadBytes = JSON.stringify(payload); const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadBytes));
  const publication = { publicationId: 'synthetic-pub', publishedAt: at, payloadBytes, payloadHash: [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join(''), policyVersion: payload.policy_version, snapshotVersion: payload.schema_version, horizonId: 'next_day', entities: [{ symbol: 'AAA', entityId: 'synthetic-AAA' }] };
  const r = await enrollPublication(base(), { id: 'enroll', at, publication, windowResolution: window ? { status: 'resolved', window } : undefined }); assert.equal(r.ok, true); return r.journal;
}
test('valid self-hashed publication cannot impersonate the current null approved publisher', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await paper(); assert.equal((await validateJournal(j)).ok, true);
  const r = await call(db, post(j)); assert.equal(r.status, 503); assert.equal(r.body.error, 'publisher_unconfigured'); assert.equal(db.batchCount, 0);
  const rejected = await call(db, post(j), { ...options, authority: { publication: async () => false } }); assert.equal(rejected.status, 422); assert.equal(rejected.body.error, 'publication_not_authorized');
  const forged = await call(db, post(j), { ...options, authority: { publication: async () => ({ verified: true }) } }); assert.equal(forged.status, 422);
});
test('server receipt time prevents backdated first enrollment at or after entry, even with a trusted publication hook', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await paper();
  const r = await call(db, post(j), { now: () => '2026-10-19T13:30:00Z', authority: { publication: async () => true } });
  assert.equal(r.status, 422); assert.equal(r.body.error, 'intent_received_after_entry'); assert.equal(db.batchCount, 0);
});
test('strict server-controlled publication hook can enable future pending enrollment without market marks', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await paper(); let seen;
  const r = await call(db, post(j), { ...options, authority: { publication: async context => { seen = context; return context.event.data.publicationId === 'synthetic-pub'; } } });
  assert.equal(r.status, 200); assert.equal(seen.receivedAt, options.now()); assert.equal(r.body.journal.events.some(event => event.kind === 'paper_evaluation'), false);
});
test('corrupt publication byte binding is rejected before authority callback', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = structuredClone(await paper()); j.events[0].data.payloadBytes += ' ';
  let called = false; const r = await call(db, post(j), { ...options, authority: { publication: async () => { called = true; return true; } } });
  assert.equal(r.status, 422); assert.deepEqual(r.body.errors, ['publication_hash_mismatch']); assert.equal(called, false);
});
const paperWindow = { calendarId: 'synthetic-calendar', calendarSha256: 'a'.repeat(64), timeZone: 'America/New_York', publishedAt: at, horizonSessions: 1, entrySession: '2026-10-19', exitSession: '2026-10-19', entryAt: '2026-10-19T13:30:00Z', exitAt: '2026-10-19T20:00:00Z', sessions: [{ date: '2026-10-19', openAt: '2026-10-19T13:30:00Z', closeAt: '2026-10-19T20:00:00Z' }] };
test('calendar labels cannot self-authorize an attached paper window', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await paper(paperWindow);
  const authority = { publication: async () => true };
  const r = await call(db, post(j), { ...options, authority }); assert.equal(r.status, 503); assert.equal(r.body.error, 'calendar_unconfigured');
  authority.calendar = async () => false;
  assert.equal((await call(db, post(j), { ...options, authority })).body.error, 'calendar_not_authorized');
  authority.calendar = async () => true; assert.equal((await call(db, post(j), { ...options, authority })).status, 200);
});
test('paper evaluations require a server market-data review even when journal structure is valid', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await paper(paperWindow);
  const authority = { publication: async () => true, calendar: async () => true };
  assert.equal((await call(db, post(j), { ...options, authority })).status, 200);
  const next = await evaluatePaper(j, { at: '2026-10-19T21:00:00Z', eventIdPrefix: 'synthetic-evaluation', resolvers: { resolvePriceMark: () => ({ status: 'pending', reasons: ['synthetic_pending'] }) } });
  assert.equal(next.ok, true); assert.equal(next.journal.events.at(-1).kind, 'paper_evaluation');
  const r = await call(db, post(next.journal, j.revision), { ...options, now: () => '2026-10-19T21:01:00Z', authority });
  assert.equal(r.status, 503); assert.equal(r.body.error, 'market_data_unconfigured'); assert.deepEqual((await call(db)).body.journal, j);
  authority.marketData = async () => false; assert.equal((await call(db, post(next.journal, j.revision), { ...options, now: () => '2026-10-19T21:01:00Z', authority })).body.error, 'market_data_not_authorized');
});
test('explicit actual confirmation and reported fill append without becoming automatic paper fills', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await paper();
  await call(db, post(j), { ...options, authority: { publication: async () => true } });
  const confirmed = await recordActualConfirmation(j, { id: 'user-confirmed', at: '2026-10-19T21:00:00Z', intentId: 'enroll:AAA:intent', confirmed: true });
  assert.equal(confirmed.ok, true); assert.equal((await call(db, post(confirmed.journal, j.revision), { now: () => '2026-10-19T21:01:00Z' })).status, 200);
  const filled = await recordActualFill(confirmed.journal, { id: 'reported-fill', at: '2026-10-19T21:00:00Z', intentId: 'enroll:AAA:intent', side: 'buy', occurredAt: '2026-10-19T13:31:00Z', quantity: '1', price: '100', fee: '0', currency: 'USD' });
  assert.equal(filled.ok, true); assert.equal((await call(db, post(filled.journal, confirmed.journal.revision), { now: () => '2026-10-19T21:01:00Z' })).status, 200);
  const saved = (await call(db)).body.journal; assert.equal(saved.events.filter(e => e.kind === 'actual_fill').length, 1); assert.equal(saved.events.some(e => e.kind === 'paper_evaluation'), false);
});
test('large valid history uses bounded JSON chunks and one atomic transaction', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const j = { ...base(), revision: 12, events: Array.from({ length: 12 }, (_, i) => ({ id: `large-${i}`, kind: 'abstain', at, data: { date: '2026-10-17', horizonId: 'next_day', unrankedCount: 6, reason: 'Synthetic storage bound fixture', snapshot: { retained: 'x'.repeat(100000) } } })) };
  const r = await call(db, post(j)); assert.equal(r.status, 200); assert.deepEqual(r.body.journal, j); assert.equal(db.batchCount, 1);
  const inserts = db.calls.filter(call => call.write && /INSERT INTO journal_events/.test(call.sql)); assert.ok(inserts.length >= 2); assert.ok(inserts.every(call => call.maxBindingBytes <= JOURNAL_API_LIMITS.chunkBytes));
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM journal_events').get().n, 12);
});
test('single oversized event is rejected before writes, measured in UTF-8 bytes', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const j = { ...base(), revision: 1, events: [{ id: 'large-unicode', kind: 'abstain', at, data: { date: '2026-10-17', horizonId: 'next_day', unrankedCount: 6, reason: 'Synthetic limit fixture', snapshot: { retained: '漢'.repeat(210000) } } }] };
  assert.equal((await validateJournal(j)).ok, true); const r = await call(db, post(j)); assert.equal(r.status, 413); assert.equal(r.body.error, 'journal_event_too_large'); assert.equal(db.batchCount, 0);
});
test('owner IDs are SQL parameters, including punctuation that resembles SQL', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const owner = "owner-a' OR 1=1 --";
  assert.equal((await call(db, { ...post(await abstain()), owner })).status, 200); assert.equal((await call(db)).body.journal, null);
  assert.equal((await call(db, { owner })).body.revision, 1);
});

test('backdated request metadata cannot authorize an actual fill in the server future', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await paper();
  await call(db, post(j), { ...options, authority: { publication: async () => true } });
  const confirmed = await recordActualConfirmation(j, { id: 'confirmed-future', at: '2026-10-19T21:00:00Z', intentId: 'enroll:AAA:intent', confirmed: true });
  const filled = await recordActualFill(confirmed.journal, { id: 'future-fill', at: '2026-10-19T21:00:00Z', intentId: 'enroll:AAA:intent', side: 'buy', occurredAt: '2026-10-19T13:31:00Z', quantity: '1', price: '100', fee: '0', currency: 'USD' });
  assert.equal(filled.ok, true); const r = await call(db, post(filled.journal, j.revision)); assert.equal(r.status, 422); assert.equal(r.body.error, 'journal_event_in_future'); assert.deepEqual((await call(db)).body.journal, j);
});

test('server receipt rejects future creation, confirmation and abstention date independently of client clock', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const future = createJournal({ journalId: 'future-journal', at: '2026-10-20T12:00:00Z' });
  assert.equal((await call(db, post(future))).body.error, 'journal_created_in_future');
  const j = structuredClone(await abstain()); j.events[0].at = '2026-10-20T12:00:00Z';
  assert.equal((await call(db, post(j))).body.error, 'journal_event_in_future');
  j.events[0].at = at; j.events[0].data.date = '2026-10-20';
  assert.equal((await call(db, post(j))).body.error, 'abstention_date_in_future');
  const intent = await paper(); await call(db, post(intent), { ...options, authority: { publication: async () => true } });
  const c = await recordActualConfirmation(intent, { id: 'future-confirmation', at: '2026-10-20T12:00:00Z', intentId: 'enroll:AAA:intent', confirmed: true });
  assert.equal((await call(db, post(c.journal, intent.revision))).body.error, 'journal_event_in_future');
});
test('duplicate JSON keys are rejected recursively, including escaped equal keys, without storage writes', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const raw = JSON.stringify({ journal: base(), expectedRevision: 0 });
  const bodies = [raw.replace('"expectedRevision":0', '"expectedRevision":999,"expectedRevision":0'), raw.replace('"revision":0', '"revision":999,"revision":0'), raw.replace('"revision":0', '"revision":999,"\\u0072evision":0')];
  for (const body of bodies) { const r = await call(db, { method: 'POST', body }); assert.equal(r.status, 400); assert.equal(r.body.error, 'duplicate_json_key'); }
  assert.equal(db.batchCount, 0);
});
test('duplicate-key rejection still accepts ordinary pretty JSON and nested array values', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = structuredClone(await abstain());
  j.events[0].data.snapshot = { text: 'A "quoted" value, braces {} and slash \\', nested: [{ a: 1 }, { a: [null, true, false, -1, 3.14] }] };
  const r = await call(db, { method: 'POST', body: JSON.stringify({ journal: j, expectedRevision: 0 }, null, 2) }); assert.equal(r.status, 200); assert.deepEqual(r.body.journal, j);
});
test('stream headers before entry cannot enroll a body completed at or after entry', async t => {
  for (const completedAt of ['2026-10-19T13:30:00Z', '2026-10-19T21:00:00Z']) {
    const db = new SQLiteD1(); t.after(() => db.close()); const journal = await paper();
    let clock = '2026-10-19T13:29:59Z'; const clockCalls = [];
    const bytes = new TextEncoder().encode(JSON.stringify({ journal, expectedRevision: 0 }));
    const stream = new ReadableStream({ pull(controller) { clock = completedAt; controller.enqueue(bytes); controller.close(); } }, { highWaterMark: 0 });
    const req = new Request(origin + '/api/journal', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-id': 'owner-a' }, body: stream, duplex: 'half' });
    const response = await handleJournalRequest(req, { DB: db }, { now: () => { clockCalls.push(clock); return clock; }, authority: { publication: () => true } });
    assert.equal(response.status, 422); assert.equal((await response.json()).error, 'intent_received_after_entry'); assert.equal(db.batchCount, 0);
    assert.deepEqual(clockCalls, ['2026-10-19T13:29:59Z', completedAt]);
  }
});
test('receipt time uses a clock high-water mark and stores full-body completion time', async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const j = await abstain(); let samples = ['2026-10-17T17:02:00Z', '2026-10-17T17:01:00Z'];
  const r = await call(db, post(j), { now: () => samples.shift() }); assert.equal(r.status, 200);
  assert.equal(db.sqlite.prepare('SELECT received_at FROM journal_events').get().received_at, '2026-10-17T17:02:00Z');
  const next = await setting(j); samples = ['2026-10-17T17:03:00Z', '2026-10-17T17:04:00Z'];
  assert.equal((await call(db, post(next, 1), { now: () => samples.shift() })).status, 200);
  assert.equal(db.sqlite.prepare("SELECT received_at FROM journal_events WHERE event_id='settings-1'").get().received_at, '2026-10-17T17:04:00Z');
});
