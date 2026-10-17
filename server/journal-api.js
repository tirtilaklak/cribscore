import { validateJournal, checkAppendOnly } from '../dist/lib/journal.js';

// Platform authentication supplies the owner ID. Browser JSON never selects an owner.
// Integrity checks do not authenticate a publisher, calendar, or market-data feed.
export const JOURNAL_API_LIMITS = Object.freeze({ bodyBytes: 8_000_000, eventBytes: 600_000, chunkBytes: 900_000, events: 20_000, observationBodyBytes: 4096 });
const encoder = new TextEncoder();
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store',
  'vary': 'oai-authenticated-user-id', 'x-content-type-options': 'nosniff',
} });
const fail = (status, error, extra = {}) => json(status, { ok: false, error, ...extra });
class ApiError extends Error { constructor(status, code) { super(code); this.status = status; } }

// JSON.parse deliberately accepts duplicate keys. Journal requests must not use
// ambiguous last-value-wins objects, including escaped or nested duplicate keys.
function rejectDuplicateKeys(text) {
  let index = 0;
  const whitespace = () => { while (/\s/.test(text[index] || '') && index < text.length) index++; };
  const string = () => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === '\\') { index += 2; continue; }
      if (text[index++] === '"') return JSON.parse(text.slice(start, index));
    }
    throw new ApiError(400, 'invalid_json');
  };
  const value = depth => {
    if (depth > 40) throw new ApiError(400, 'json_nesting_limit');
    whitespace();
    if (text[index] === '{') {
      index++; whitespace(); const keys = new Set();
      if (text[index] === '}') { index++; return; }
      for (;;) {
        whitespace(); const key = string();
        if (keys.has(key)) throw new ApiError(400, 'duplicate_json_key');
        keys.add(key); whitespace(); index++; value(depth + 1); whitespace();
        if (text[index++] === '}') return;
      }
    }
    if (text[index] === '[') {
      index++; whitespace();
      if (text[index] === ']') { index++; return; }
      for (;;) { value(depth + 1); whitespace(); if (text[index++] === ']') return; }
    }
    if (text[index] === '"') { string(); return; }
    while (index < text.length && !/[\s,}\]]/.test(text[index])) index++;
  };
  value(0);
}

async function readBody(request, limit = JOURNAL_API_LIMITS.bodyBytes) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new ApiError(413, 'journal_request_too_large');
  if (!request.body) throw new ApiError(400, 'invalid_json');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new ApiError(413, 'journal_request_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text, parsed;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); parsed = JSON.parse(text); }
  catch { throw new ApiError(400, 'invalid_json'); }
  rejectDuplicateKeys(text);
  return parsed;
}

const READ = `SELECT h.journal_id, h.created_at, h.revision, e.event_index, e.event_id, e.event_json
  FROM journal_heads h LEFT JOIN journal_events e ON e.owner_id = h.owner_id
  WHERE h.owner_id = ? ORDER BY e.event_index LIMIT 20001`;

async function readJournal(db, owner) {
  const result = await db.prepare(READ).bind(owner).all();
  const rows = result.results;
  if (!Array.isArray(rows)) throw new ApiError(503, 'journal_storage_unavailable');
  if (!rows.length) return null;
  const head = rows[0];
  if (!Number.isSafeInteger(head.revision) || head.revision < 0 || head.revision > JOURNAL_API_LIMITS.events) throw new ApiError(503, 'journal_storage_corrupt');
  const eventRows = rows.filter(row => row.event_index !== null);
  if (eventRows.length !== head.revision) throw new ApiError(503, 'journal_storage_corrupt');
  const events = [];
  for (let i = 0; i < eventRows.length; i++) {
    const row = eventRows[i];
    if (row.event_index !== i || typeof row.event_json !== 'string' || encoder.encode(row.event_json).byteLength > JOURNAL_API_LIMITS.eventBytes) throw new ApiError(503, 'journal_storage_corrupt');
    let event;
    try { event = JSON.parse(row.event_json); } catch { throw new ApiError(503, 'journal_storage_corrupt'); }
    if (event.id !== row.event_id) throw new ApiError(503, 'journal_storage_corrupt');
    events.push(event);
  }
  const checked = await validateJournal({ schemaVersion: 'cribscore_journal_v1', journalId: head.journal_id, createdAt: head.created_at, revision: head.revision, events });
  if (!checked.ok) throw new ApiError(503, 'journal_storage_corrupt');
  return checked.journal;
}

// A hook must compare against server-controlled publication/feed records, never
// accept a client boolean, supplied URL, self-hash, or 'reviewed' label as proof.
async function authorizeAdded(events, journal, previous, authority, receivedAt) {
  for (const event of events) {
    const context = { event, journal, previous, receivedAt };
    if (Date.parse(event.at) > Date.parse(receivedAt)) throw new ApiError(422, 'journal_event_in_future');
    if (event.kind === 'abstain' && event.data.date > receivedAt.slice(0, 10)) throw new ApiError(422, 'abstention_date_in_future');
    const reportedFill = event.kind === 'actual_fill' ? event.data.fill : event.kind === 'fill_revision' ? event.data.replacement : null;
    if (reportedFill && Date.parse(reportedFill.occurredAt) > Date.parse(receivedAt)) throw new ApiError(422, 'actual_fill_in_future');
    if (event.kind === 'publication') {
      if (typeof authority?.publication !== 'function') throw new ApiError(503, 'publisher_unconfigured');
      if (await authority.publication(context) !== true) throw new ApiError(422, 'publication_not_authorized');
    }
    if (event.kind === 'paper_intent') {
      const publication = journal.events.find(item => item.id === event.data.publicationEventId);
      const entryAt = JSON.parse(publication.data.payloadBytes).horizon.entry_at;
      if (Date.parse(receivedAt) >= Date.parse(entryAt)) throw new ApiError(422, 'intent_received_after_entry');
    }
    if (event.kind === 'paper_schedule' || (event.kind === 'paper_intent' && event.data.window)) {
      if (typeof authority?.calendar !== 'function') throw new ApiError(503, 'calendar_unconfigured');
      if (await authority.calendar(context) !== true) throw new ApiError(422, 'calendar_not_authorized');
    }
    if (event.kind === 'paper_evaluation' || event.kind === 'paper_revision' || event.kind === 'actual_action_review') {
      if (typeof authority?.marketData !== 'function') throw new ApiError(503, 'market_data_unconfigured');
      if (await authority.marketData(context) !== true) throw new ApiError(422, 'market_data_not_authorized');
    }
  }
}

function eventChunks(events, start) {
  const chunks = [];
  let chunk = [], size = 2;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const eventJSON = canonical(event);
    if (encoder.encode(eventJSON).byteLength > JOURNAL_API_LIMITS.eventBytes) throw new ApiError(413, 'journal_event_too_large');
    const row = { index: start + index, id: event.id, json: eventJSON };
    const bytes = encoder.encode(JSON.stringify(row)).byteLength + 1;
    if (bytes > JOURNAL_API_LIMITS.chunkBytes) throw new ApiError(413, 'journal_event_too_large');
    if (size + bytes > JOURNAL_API_LIMITS.chunkBytes && chunk.length) { chunks.push(JSON.stringify(chunk)); chunk = []; size = 2; }
    chunk.push(row); size += bytes;
  }
  if (chunk.length) chunks.push(JSON.stringify(chunk));
  return chunks;
}

const INSERT_HEAD = `INSERT INTO journal_heads (owner_id, journal_id, created_at, revision, updated_at)
  VALUES (?, ?, ?, 0, ?) ON CONFLICT(owner_id) DO NOTHING`;
const INSERT_EVENTS = `INSERT INTO journal_events (owner_id, event_index, event_id, event_json, received_at)
  SELECT ?, json_extract(value, '$.index'), json_extract(value, '$.id'), json_extract(value, '$.json'), ?
  FROM json_each(?) WHERE EXISTS (SELECT 1 FROM journal_heads WHERE owner_id = ? AND revision = ? AND journal_id = ? AND created_at = ?)`;
const ADVANCE_HEAD = `UPDATE journal_heads SET journal_id = ?, created_at = ?, revision = ?, updated_at = ?
  WHERE owner_id = ? AND revision = ? AND journal_id = ? AND created_at = ?`;

const OBSERVER_KINDS = new Set(['abstain', 'publication', 'paper_intent', 'paper_schedule', 'no_fill', 'duplicate', 'paper_evaluation', 'paper_revision']);
const TRUSTED_OBSERVER_AUTHORITY = Object.freeze({ publication: () => true, calendar: () => true, marketData: () => true });
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const machineCode = value => typeof value === 'string' && /^[a-z][a-z0-9_:-]{0,119}$/.test(value);
function highWater(previous, now) {
  const current = now();
  if (!instant(current)) throw new ApiError(503, 'server_clock_unavailable');
  return Date.parse(current) > Date.parse(previous) ? current : previous;
}
function observationMetadata(result, receivedAt, completedAt) {
  const automation = result?.automation;
  if (!instant(result?.observedAt) || Date.parse(result.observedAt) < Date.parse(receivedAt)
    || Date.parse(result.observedAt) > Date.parse(completedAt) || !automation
    || !['unconfigured', 'unavailable', 'empty', 'ready'].includes(automation.publisherState)
    || automation.checkedAt !== result.observedAt || !Array.isArray(automation.pendingReasons)
    || automation.pendingReasons.length > 64 || !automation.pendingReasons.every(machineCode)) throw new ApiError(503, 'observer_invalid_proposal');
  // Project bounded status fields only; never return arbitrary reader data/errors.
  return { publisherState: automation.publisherState, checkedAt: automation.checkedAt, pendingReasons: [...automation.pendingReasons] };
}
function assertObservationDeadline(events, journal, receivedAt) {
  for (const event of events) if (event.kind === 'paper_intent') {
    const publication = journal.events.find(item => item.id === event.data.publicationEventId);
    if (Date.parse(receivedAt) >= Date.parse(JSON.parse(publication.data.payloadBytes).horizon.entry_at)) {
      throw new ApiError(422, 'observation_crossed_entry_retry');
    }
  }
}

export async function handleJournalRequest(request, env, { authority, observer, now = () => new Date().toISOString() } = {}) {
  let commitStarted = false;
  try {
    const url = new URL(request.url);
    const observing = url.pathname === '/api/journal/observe';
    if (!observing && url.pathname !== '/api/journal') return fail(404, 'not_found');
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner || owner.length > 512 || /[\u0000-\u001f\u007f]/.test(owner)) return fail(401, 'authentication_required');
    if (!(observing ? ['POST'] : ['GET', 'POST']).includes(request.method)) return json(405, { ok: false, error: 'method_not_allowed' });
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== url.origin || ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site'))) return fail(403, 'same_origin_required');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) return fail(415, 'json_content_type_required');
    }
    let receivedAt = request.method === 'POST' ? now() : null;
    if (receivedAt !== null && !Number.isFinite(Date.parse(receivedAt))) throw new ApiError(503, 'server_clock_unavailable');
    if (!env?.DB || typeof env.DB.prepare !== 'function' || typeof env.DB.batch !== 'function') return fail(503, 'journal_storage_unavailable');
    // A primary-bound session supplies read-your-writes and avoids stale conflict replies.
    const db = typeof env.DB.withSession === 'function' ? env.DB.withSession('first-primary') : env.DB;
    const previous = await readJournal(db, owner);
    if (request.method === 'GET') return json(200, { ok: true, journal: previous, revision: previous?.revision || 0 });
    const body = await readBody(request, observing ? JOURNAL_API_LIMITS.observationBodyBytes : JOURNAL_API_LIMITS.bodyBytes);
    // Headers arriving before the entry deadline are not an enrolled immutable
    // suggestion. A streamed body must be completely received before that open.
    const completedAt = now();
    if (!Number.isFinite(Date.parse(completedAt))) throw new ApiError(503, 'server_clock_unavailable');
    if (Date.parse(completedAt) > Date.parse(receivedAt)) receivedAt = completedAt;
    let journal, added, automation;
    if (observing) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
        || !Object.hasOwn(body, 'expectedRevision') || !Object.hasOwn(body, 'requestId')
        || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
        || typeof body.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(body.requestId)) return fail(400, 'invalid_observation_request');
      if (!previous) return fail(409, 'journal_setup_required', { journal: null, revision: 0 });
      if (body.expectedRevision !== previous.revision) return fail(409, 'revision_conflict', { revision: previous.revision, journal: previous });
      if (typeof observer?.observe !== 'function') return fail(503, 'observer_unconfigured');
      let proposal;
      try { proposal = await observer.observe({ journal: previous, requestId: body.requestId, receivedAt, ownerScope: owner }); }
      catch { return fail(503, 'observation_unavailable'); }
      if (proposal?.ok !== true) return fail(503, 'observation_unavailable');
      if (proposal.baseRevision !== previous.revision || typeof proposal.changed !== 'boolean') return fail(503, 'observer_invalid_proposal');
      const checked = await validateJournal(proposal.journal);
      if (!checked.ok || !checkAppendOnly(previous, checked.journal).ok) return fail(503, 'observer_invalid_proposal');
      journal = checked.journal;
      added = journal.events.slice(previous.revision);
      if (proposal.changed !== (added.length > 0) || added.some(event => !OBSERVER_KINDS.has(event.kind)
        || Date.parse(event.at) < Date.parse(receivedAt))) return fail(503, 'observer_invalid_proposal');
      const observedThrough = highWater(receivedAt, now);
      automation = observationMetadata(proposal, receivedAt, observedThrough);
      receivedAt = observedThrough;
      assertObservationDeadline(added, journal, receivedAt);
      // Only this server-injected observer can authorize generated paper events.
      // Client POST/imports below still require the independent authority hooks.
      await authorizeAdded(added, journal, previous, TRUSTED_OBSERVER_AUTHORITY, receivedAt);
    } else {
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['expectedRevision', 'journal', 'mode'].includes(key))
        || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
        || (body.mode !== undefined && !['append', 'restore'].includes(body.mode))) return fail(400, 'invalid_journal_request');
      if (body.expectedRevision !== (previous?.revision || 0)) return json(409, { ok: false, error: 'revision_conflict', revision: previous?.revision || 0, journal: previous });
      const checked = await validateJournal(body.journal);
      if (!checked.ok) return fail(422, 'invalid_journal', { errors: checked.errors });
      journal = checked.journal;
      if (Date.parse(journal.createdAt) > Date.parse(receivedAt)) return fail(422, 'journal_created_in_future');
      const appendCheck = checkAppendOnly(previous, journal, { allowEmptyRestore: body.mode === 'restore' && body.expectedRevision === 0 });
      if (!appendCheck.ok) return fail(422, 'append_only_conflict');
      added = journal.events.slice(previous?.revision || 0);
      await authorizeAdded(added, journal, previous, authority, receivedAt);
    }
    if (previous && canonical(previous) === canonical(journal)) {
      if (observing) {
        // Trusted reads may outlast another tab's commit even when our proposal
        // adds nothing. Confirm the observed version before reporting success.
        const latest = await readJournal(db, owner);
        if (canonical(latest) !== canonical(previous)) return fail(409, 'revision_conflict', { revision: latest?.revision || 0, journal: latest });
      }
      return json(200, { ok: true, revision: journal.revision, journal: previous, ...(automation ? { automation } : {}) });
    }
    const chunks = eventChunks(added, previous?.revision || 0);
    if (observing) {
      // Async readers, full graph validation and chunk encoding can cross entry.
      // A retry at a fresh receipt must produce no-fill; never backdate a new intent.
      receivedAt = highWater(receivedAt, now);
      assertObservationDeadline(added, journal, receivedAt);
    }
    const oldId = previous?.journalId || journal.journalId;
    const oldCreated = previous?.createdAt || journal.createdAt;
    const statements = [];
    if (!previous) statements.push(db.prepare(INSERT_HEAD).bind(owner, journal.journalId, journal.createdAt, receivedAt));
    for (const chunk of chunks) statements.push(db.prepare(INSERT_EVENTS).bind(owner, receivedAt, chunk, owner, body.expectedRevision, oldId, oldCreated));
    statements.push(db.prepare(ADVANCE_HEAD).bind(journal.journalId, journal.createdAt, journal.revision, receivedAt, owner, body.expectedRevision, oldId, oldCreated));
    commitStarted = true;
    const results = await db.batch(statements);
    if (!Array.isArray(results) || results.some(result => result.success === false)) throw new ApiError(503, 'journal_commit_uncertain');
    const latest = await readJournal(db, owner);
    if (results.at(-1)?.meta?.changes !== 1 || canonical(latest) !== canonical(journal)) {
      // Another tab may already have appended after our successful commit. Return
      // its current history as a conflict; never mislabel an unconfirmed write saved.
      return json(409, { ok: false, error: 'revision_conflict', revision: latest?.revision || 0, journal: latest });
    }
    return json(200, { ok: true, revision: latest.revision, journal: latest, ...(automation ? { automation } : {}) });
  } catch (error) {
    if (error instanceof ApiError) return fail(error.status, error.message);
    // SQL diagnostics can contain user data. Never return or log raw DB exceptions.
    return fail(503, commitStarted ? 'journal_commit_uncertain' : 'journal_storage_unavailable');
  }
}
