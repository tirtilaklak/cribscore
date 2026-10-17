import { handleJournalRequest } from '../journal-api.js';

// Sites forwards the authenticated caller's Site-scoped identity to /mcp.
// Service bypass tokens are deliberately not interpreted as owner identity.
// The only writer is the existing journal API, with its complete validation,
// observer kind allowlist, deadline checks, atomic D1 batch and revision CAS.
export const SCHEDULED_MCP_VERSION = '2026-07-28';
export const SCHEDULED_MCP_LIMITS = Object.freeze({ bodyBytes: 8192, bodyChunks: 16_384, bodyTimeoutMs: 5000, observationTimeoutMs: 10_000 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value);
const ownerId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
const response = (status, body, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store',
  'vary': 'oai-authenticated-user-id', 'x-content-type-options': 'nosniff', ...headers,
} });
const failure = (status, error) => response(status, { ok: false, error });
const rpcError = (id, code, message, status = 200, data) => response(status, { jsonrpc: '2.0', ...(id === null ? {} : { id }), error: { code, message, ...(data ? { data } : {}) } });
const rpcResult = (id, result) => response(200, { jsonrpc: '2.0', id, result: { resultType: 'complete', ...result } });
const toolResult = (id, result) => rpcResult(id, { isError: result.ok !== true, content: [{ type: 'text', text: JSON.stringify(result) }] });
class InputError extends Error { constructor(status, code) { super(code); this.status = status; } }
const versionKey = 'io.modelcontextprotocol/protocolVersion';
const capabilitiesKey = 'io.modelcontextprotocol/clientCapabilities';
const clientInfoKey = 'io.modelcontextprotocol/clientInfo';
const metadataKey = /^(?:(?:[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?:\.[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\/)?(?:[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?)?$/;
function decodedHeader(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('=?base64?') || !value.endsWith('?=')) return value;
  try {
    const encoded = value.slice(9, -2);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)));
  } catch { return null; }
}
function protocolError(request, body) {
  const meta = body.params?._meta;
  const headerVersion = request.headers.get('mcp-protocol-version');
  if (!headerVersion || request.headers.get('mcp-method') !== body.method
    || (typeof meta?.[versionKey] === 'string' && headerVersion !== meta[versionKey])
    || (['tools/call', 'prompts/get', 'resources/read'].includes(body.method)
      && (typeof (body.params?.name ?? body.params?.uri) !== 'string' || decodedHeader(request.headers.get('mcp-name')) !== (body.params?.name ?? body.params?.uri)))) {
    return rpcError(body.id, -32020, 'Required MCP headers are missing, malformed or inconsistent', 400);
  }
  if (!object(meta) || typeof meta[versionKey] !== 'string' || !object(meta[capabilitiesKey])
    || Object.keys(meta).some(key => !metadataKey.test(key))
    || (Object.hasOwn(meta, clientInfoKey) && (!object(meta[clientInfoKey]) || typeof meta[clientInfoKey].name !== 'string' || typeof meta[clientInfoKey].version !== 'string'))
    || (Object.hasOwn(meta, 'progressToken') && !(typeof meta.progressToken === 'string' || typeof meta.progressToken === 'number' && Number.isFinite(meta.progressToken)))) {
    return rpcError(body.id, -32602, 'Invalid request metadata', 400);
  }
  if (headerVersion !== SCHEDULED_MCP_VERSION) return rpcError(body.id, -32022, 'Unsupported protocol version', 400, { supported: [SCHEDULED_MCP_VERSION], requested: headerVersion });
  return null;
}

// Race only a read/proposal operation, never the commit promise. A late observer
// result is discarded and cannot reach handleJournalRequest's write path.
async function bounded(operation, milliseconds, signal) {
  if (signal?.aborted) throw new InputError(408, 'request_cancelled');
  let timer, cancel;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new InputError(408, 'operation_timed_out')), milliseconds);
    cancel = () => reject(new InputError(408, 'request_cancelled'));
    signal?.addEventListener('abort', cancel, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(operation), limit]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

function rejectDuplicateKeys(text) {
  let at = 0;
  const space = () => { while (at < text.length && /\s/.test(text[at])) at++; };
  const string = () => {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue; }
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
    }
    throw new InputError(400, 'invalid_json');
  };
  const value = depth => {
    if (depth > 12) throw new InputError(400, 'json_nesting_limit');
    space();
    if (text[at] === '{') {
      at++; space(); const seen = new Set();
      if (text[at] === '}') { at++; return; }
      for (;;) {
        space(); const key = string();
        if (seen.has(key)) throw new InputError(400, 'duplicate_json_key');
        seen.add(key); space(); at++; value(depth + 1); space();
        if (text[at++] === '}') return;
      }
    }
    if (text[at] === '[') {
      at++; space(); if (text[at] === ']') { at++; return; }
      for (;;) { value(depth + 1); space(); if (text[at++] === ']') return; }
    }
    if (text[at] === '"') { string(); return; }
    while (at < text.length && !/[\s,}\]]/.test(text[at])) at++;
  };
  value(0);
}

async function readBody(request) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > SCHEDULED_MCP_LIMITS.bodyBytes)) throw new InputError(413, 'mcp_request_too_large');
  if (!request.body) throw new InputError(400, 'invalid_json');
  const reader = request.body.getReader();
  let finished = false;
  try {
    const bytes = await bounded(async () => {
      const parts = []; let size = 0, chunksRead = 0;
      const startedAt = performance.now();
      for (;;) {
        const { value, done } = await reader.read();
        if (request.signal.aborted) throw new InputError(408, 'request_cancelled');
        if (performance.now() - startedAt >= SCHEDULED_MCP_LIMITS.bodyTimeoutMs) throw new InputError(408, 'operation_timed_out');
        if (done) break;
        // Immediate empty chunks can starve timers without using the byte budget.
        if (++chunksRead > SCHEDULED_MCP_LIMITS.bodyChunks) throw new InputError(413, 'mcp_request_too_fragmented');
        size += value.byteLength;
        if (size > SCHEDULED_MCP_LIMITS.bodyBytes) throw new InputError(413, 'mcp_request_too_large');
        parts.push(value);
      }
      const combined = new Uint8Array(size); let offset = 0;
      for (const part of parts) { combined.set(part, offset); offset += part.byteLength; }
      return combined;
    }, SCHEDULED_MCP_LIMITS.bodyTimeoutMs, request.signal);
    finished = true;
    let text, result;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); result = JSON.parse(text); }
    catch { throw new InputError(400, 'invalid_json'); }
    rejectDuplicateKeys(text);
    return result;
  } finally {
    // Cancellation can be asynchronous on an untrusted stream; do not wait for
    // its cancel callback before returning the bounded failure.
    if (!finished) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const statusTool = Object.freeze({
  name: 'journal_observation_status',
  description: 'Read the signed-in owner’s saved journal identity, revision and event counts. No journal is created. Use its journalId and revision for one observation; do not select another owner.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});
const observeTool = Object.freeze({
  name: 'journal_observe_scheduled',
  description: 'Observe server-configured research for the signed-in owner at the server’s current time. Requires a previously created journal. Append only supported research/paper observations; never confirmations or actual fills. Reuse the exact journal ID, expectedRevision and requestId after transport uncertainty. Never auto-rebase a conflicted or uncertain run.',
  inputSchema: { type: 'object', additionalProperties: false,
    required: ['expectedJournalId', 'expectedRevision', 'requestId'],
    properties: {
      expectedJournalId: { type: 'string', minLength: 1, maxLength: 160 },
      expectedRevision: { type: 'integer', minimum: 0, maximum: 20_000 },
      requestId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$', maxLength: 96 },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

const eventCounts = journal => {
  const counts = {};
  for (const event of journal?.events || []) counts[event.kind] = (counts[event.kind] || 0) + 1;
  return counts;
};
const projectedHead = body => ({ journalId: body.journal?.journalId || null, revision: body.revision, eventCounts: eventCounts(body.journal) });
const observationKinds = new Set(['abstain', 'publication', 'paper_intent', 'paper_schedule', 'no_fill', 'duplicate', 'paper_evaluation', 'paper_revision']);
const lastRecordedObservationAt = journal => (journal?.events || []).filter(event => observationKinds.has(event.kind))
  .reduce((latest, event) => latest === null || Date.parse(event.at) > Date.parse(latest) ? event.at : latest, null);
const sourceKeys = ['publisher', 'calendar', 'reviewedPrices'];
const missingSourceReasons = { publisher: 'publisher_unconfigured', calendar: 'calendar_unconfigured', reviewedPrices: 'reviewed_prices_unconfigured' };

/** Hosted MCP is an adapter, not a scheduler or a credential store.
 * writesEnabled is a sealed server dependency; no env/header/body flag enables it.
 * Sites capability declaration, connection, and schedule activation are separate.
 */
export function createScheduledJournalMcp({ observer, writesEnabled = false, now = () => new Date().toISOString(), observationTimeoutMs = SCHEDULED_MCP_LIMITS.observationTimeoutMs,
  sourceConfiguration = { publisher: 'unconfigured', calendar: 'unconfigured', reviewedPrices: 'unconfigured' },
} = {}) {
  if (typeof writesEnabled !== 'boolean' || typeof now !== 'function' || !Number.isSafeInteger(observationTimeoutMs) || observationTimeoutMs < 1 || observationTimeoutMs > 30_000) throw Error('invalid_scheduled_mcp_configuration');
  if (!exact(sourceConfiguration, sourceKeys) || sourceKeys.some(key => !['configured', 'unconfigured'].includes(sourceConfiguration[key]))) throw Error('invalid_source_configuration');
  // Configuration is declared by server source, never inferred from a function
  // reference or claimed to establish feed access, freshness or reviewed marks.
  const configuration = Object.freeze({ ...sourceConfiguration });
  const sources = Object.freeze({ configuration, checkedAt: null,
    pendingReasons: Object.freeze(sourceKeys.filter(key => configuration[key] === 'unconfigured').map(key => missingSourceReasons[key])),
  });
  return Object.freeze({ async fetch(request, env) {
    let rpcId = null;
    try {
      const url = new URL(request.url);
      if (url.pathname !== '/mcp') return failure(404, 'not_found');
      const owner = request.headers.get('oai-authenticated-user-id');
      if (!ownerId(owner)) return failure(401, 'authentication_required');
      if (request.method !== 'POST') return response(405, { ok: false, error: 'method_not_allowed' }, { allow: 'POST' });
      const origin = request.headers.get('origin');
      if ((origin !== null && origin !== url.origin) || ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site'))) return failure(403, 'same_origin_required');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) return failure(415, 'json_content_type_required');
      const body = await readBody(request);
      if (!object(body) || Object.keys(body).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key)) || body.jsonrpc !== '2.0'
        || !(typeof body.id === 'string' && body.id.length <= 128 || Number.isSafeInteger(body.id)) || typeof body.method !== 'string') return rpcError(null, -32600, 'Invalid request');
      rpcId = body.id;
      const invalidProtocol = protocolError(request, body);
      if (invalidProtocol) return invalidProtocol;
      if (body.method === 'server/discover') {
        if (!exact(body.params, ['_meta'])) return rpcError(rpcId, -32602, 'Invalid parameters');
        return rpcResult(rpcId, { supportedVersions: [SCHEDULED_MCP_VERSION], capabilities: { tools: {} }, ttlMs: 0, cacheScope: 'private' });
      }
      if (body.method === 'tools/list') {
        if (!exact(body.params, ['_meta'])) return rpcError(rpcId, -32602, 'Invalid parameters');
        return rpcResult(rpcId, { tools: writesEnabled ? [statusTool, observeTool] : [statusTool], ttlMs: 0, cacheScope: 'private' });
      }
      if (body.method !== 'tools/call') return rpcError(rpcId, -32601, 'Method not found; supported protocol version: 2026-07-28', 404);
      if (!exact(body.params, ['_meta', 'name', ...(Object.hasOwn(body.params, 'arguments') ? ['arguments'] : [])])) return rpcError(rpcId, -32602, 'Invalid parameters');
      const { name, arguments: args = {} } = body.params;
      if (![statusTool.name, observeTool.name].includes(name)) return rpcError(rpcId, -32602, 'Unknown tool');
      if (name === observeTool.name && !writesEnabled) return toolResult(rpcId, { ok: false, error: 'scheduled_observation_disabled' });
      if (name === statusTool.name ? !exact(args, []) : !exact(args, ['expectedJournalId', 'expectedRevision', 'requestId'])
        || typeof args.expectedJournalId !== 'string' || args.expectedJournalId.length < 1 || args.expectedJournalId.length > 160
        || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0 || args.expectedRevision > 20_000 || !identifier(args.requestId)) return rpcError(rpcId, -32602, 'Invalid parameters');

      // A fresh internal Request has only the validated platform identity. Never
      // forward caller-supplied credentials, owner selectors or authority fields.
      const internalRequest = (path, payload) => new Request(url.origin + path, { method: payload ? 'POST' : 'GET',
        headers: { 'oai-authenticated-user-id': owner, ...(payload ? { origin: url.origin, 'content-type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}), signal: request.signal,
      });
      const read = await handleJournalRequest(internalRequest('/api/journal'), env, { now });
      const saved = await read.json();
      if (!saved.ok) return toolResult(rpcId, { ok: false, error: saved.error });
      if (name === statusTool.name) return toolResult(rpcId, { ok: true, writesEnabled, setupRequired: !saved.journal, ...projectedHead(saved),
        sources, lastRecordedObservationAt: lastRecordedObservationAt(saved.journal),
      });
      if (!saved.journal) return toolResult(rpcId, { ok: false, error: 'journal_setup_required', ...projectedHead(saved) });
      if (saved.journal.journalId !== args.expectedJournalId) return toolResult(rpcId, { ok: false, error: 'journal_identity_conflict' });
      if (saved.revision !== args.expectedRevision) return toolResult(rpcId, { ok: false, error: 'revision_conflict', ...projectedHead(saved), retry: 'read_and_reconcile' });
      if (typeof observer?.observe !== 'function') return toolResult(rpcId, { ok: false, error: 'observer_unconfigured' });
      let identityChanged = false;
      const boundedObserver = { observe: input => {
        // An authorized empty restore can change journal identity at revision 0
        // after the preliminary GET. Pin the exact history the API will use in
        // its atomic CAS before any reader runs; its CAS also binds journal_id.
        if (input.journal.journalId !== args.expectedJournalId) {
          identityChanged = true; throw Error('journal_identity_conflict');
        }
        return bounded(() => observer.observe(input), observationTimeoutMs, request.signal);
      } };
      const guardCommit = db => ({
        prepare: (...args) => db.prepare(...args),
        batch: statements => {
          // Once dispatched, an actual D1 transaction is never raced/cancelled.
          // Before dispatch, cancellation must prevent a late proposal write.
          if (request.signal.aborted) throw Error('request_cancelled_before_commit');
          return db.batch(statements);
        },
        ...(typeof db.withSession === 'function' ? { withSession: constraint => guardCommit(db.withSession(constraint)) } : {}),
      });
      const write = await handleJournalRequest(internalRequest('/api/journal/observe', { expectedRevision: args.expectedRevision, requestId: args.requestId }), { ...env, DB: guardCommit(env.DB) }, { observer: boundedObserver, now });
      const result = await write.json();
      if (identityChanged) return toolResult(rpcId, { ok: false, error: 'journal_identity_conflict' });
      if (!result.ok) return toolResult(rpcId, { ok: false, error: result.error,
        ...(Number.isSafeInteger(result.revision) ? { revision: result.revision } : {}),
        ...(result.capacity ? { capacity: result.capacity } : {}),
        retry: result.error === 'journal_capacity_exceeded' ? 'pause_capacity' : ['journal_commit_uncertain', 'revision_conflict'].includes(result.error) ? 'read_and_reconcile' : 'same_arguments_only',
      });
      return toolResult(rpcId, { ok: true, requestId: args.requestId, expectedRevision: args.expectedRevision,
        ...projectedHead(result), appendedEvents: result.revision - args.expectedRevision, automation: result.automation,
      });
    } catch (error) {
      if (error instanceof InputError) return failure(error.status, error.message);
      // No raw exception, SQL detail, provider content, or credentials escape.
      return rpcId === null ? failure(503, 'scheduled_observation_unavailable') : toolResult(rpcId, { ok: false, error: 'scheduled_observation_unavailable', retry: 'read_and_reconcile' });
    }
  } });
}
