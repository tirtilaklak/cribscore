import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledJournalMcp, SCHEDULED_MCP_LIMITS } from '../server/journal/scheduled-mcp.mjs';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
const origin = 'https://mcp-transport-fixture.invalid';
const version = '2026-07-28';
const metadata = changes => ({ 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientCapabilities': {}, ...changes });
const envelope = (method = 'server/discover', params = {}) => ({ jsonrpc: '2.0', id: 'transport-fixture', method, params: { _meta: metadata(), ...params } });
function request(body, { headers = {}, signal, stream } = {}) {
  return new Request(origin + '/mcp', { method: 'POST', signal,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'oai-authenticated-user-id': 'owner-fixture',
      'mcp-protocol-version': body.params?._meta?.['io.modelcontextprotocol/protocolVersion'] || version, 'mcp-method': body.method,
      ...(body.params?.name ? { 'mcp-name': body.params.name } : {}), ...headers },
    body: stream || JSON.stringify(body), ...(stream ? { duplex: 'half' } : {}),
  });
}
function database(t) { const db = new SQLiteD1(); t.after(() => db.close()); return db; }
async function call(db, body = envelope(), options) {
  const response = await createScheduledJournalMcp().fetch(request(body, options), { DB: db });
  return { status: response.status, body: await response.json() };
}
const read = (params = {}) => envelope('tools/call', { name: 'journal_observation_status', arguments: {}, ...params });

test('modern metadata-bearing discovery and list return complete private cache declarations', async t => {
  const db = database(t);
  for (const method of ['server/discover', 'tools/list']) {
    const body = envelope(method, { _meta: metadata({ 'io.modelcontextprotocol/clientInfo': { name: 'Synthetic Client', version: '1' }, progressToken: 42, 'com.example/trace': { arbitrary: 'ignored' } }) });
    const result = await call(db, body); assert.equal(result.status, 200); assert.equal(result.body.result.resultType, 'complete');
    assert.equal(result.body.result.cacheScope, 'private'); assert.equal(result.body.result.ttlMs, 0);
  }
  assert.equal(db.calls.length, 0);
});

test('missing, inconsistent and malformed MCP routing headers fail before any journal read', async t => {
  const db = database(t);
  for (const headers of [{ 'mcp-protocol-version': '' }, { 'mcp-method': '' }, { 'mcp-protocol-version': '2025-11-25' }, { 'mcp-method': 'TOOLS/CALL' }, { 'mcp-name': 'other_tool' }, { 'mcp-name': '' }, { 'mcp-name': '=?base64?invalid@?=' }]) {
    const result = await call(db, read(), { headers }); assert.equal(result.status, 400); assert.equal(result.body.error.code, -32020);
  }
  assert.equal(db.calls.length, 0);
});

test('unsupported versions produce the modern negotiation error without invoking an operation', async t => {
  const db = database(t), body = envelope('server/discover', { _meta: metadata({ 'io.modelcontextprotocol/protocolVersion': '1900-01-01' }) });
  const result = await call(db, body); assert.equal(result.status, 400); assert.equal(result.body.error.code, -32022);
  assert.deepEqual(result.body.error.data, { supported: [version], requested: '1900-01-01' }); assert.equal(db.calls.length, 0);
});

test('required metadata types are validated and client-declared identity cannot replace authentication', async t => {
  const db = database(t);
  for (const meta of [null, [], {}, metadata({ 'io.modelcontextprotocol/clientCapabilities': [] }), metadata({ 'io.modelcontextprotocol/clientInfo': { name: 'client' } }), metadata({ progressToken: {} }), metadata({ 'invalid key': true })]) {
    const result = await call(db, envelope('server/discover', { _meta: meta })); assert.equal(result.status, 400); assert.equal(result.body.error.code, -32602);
  }
  const forged = read({ _meta: metadata({ ownerScope: 'owner-fixture', 'io.modelcontextprotocol/clientInfo': { name: 'owner-fixture', version: '1' } }) });
  const denied = await call(db, forged, { headers: { 'oai-authenticated-user-id': '' } }); assert.equal(denied.status, 401); assert.equal(db.calls.length, 0);
});

test('Base64-sentinel tool names decode to the exact body name and status arguments may be omitted', async t => {
  const db = database(t), body = read(); delete body.params.arguments;
  const result = await call(db, body, { headers: { 'mcp-name': `=?base64?${btoa(body.params.name)}?=` } });
  assert.equal(result.status, 200); assert.equal(result.body.result.resultType, 'complete'); assert.equal(result.body.result.isError, false);
  assert.equal(JSON.parse(result.body.result.content[0].text).setupRequired, true);
  const wrong = await call(db, read(), { headers: { 'mcp-name': `=?base64?${btoa('another_tool')}?=` } }); assert.equal(wrong.body.error.code, -32020);
  assert.equal(db.batchCount, 0);
});

test('unknown methods use modern HTTP 404 and unsupported continuations cannot reach a tool', async t => {
  const db = database(t);
  const missing = await call(db, envelope('not/a/method')); assert.equal(missing.status, 404); assert.equal(missing.body.error.code, -32601);
  for (const params of [{ requestState: 'unissued' }, { inputResponses: {} }]) assert.equal((await call(db, read(params))).body.error.code, -32602);
  assert.equal((await call(db, envelope('tools/list', { cursor: 'unissued' }))).body.error.code, -32602);
  assert.equal(db.calls.length, 0);
});

test('duplicate escaped metadata keys cannot create parser/header disagreement', async t => {
  const db = database(t); const body = envelope(), raw = JSON.stringify(body).replace('"io.modelcontextprotocol/protocolVersion":"2026-07-28"', '"io.modelcontextprotocol/protocolVersion":"1900-01-01","io.modelcontextprotocol/\\u0070rotocolVersion":"2026-07-28"');
  const req = request(body, { stream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(raw)); controller.close(); } }) });
  const response = await createScheduledJournalMcp().fetch(req, { DB: db }); assert.equal(response.status, 400); assert.equal((await response.json()).error, 'duplicate_json_key'); assert.equal(db.calls.length, 0);
});

test('aborting an unread body cancels the reader without waiting for its cancel callback', async t => {
  const db = database(t), controller = new AbortController(); let cancelled = false;
  const stream = new ReadableStream({ pull() {}, cancel() { cancelled = true; return new Promise(() => {}); } });
  const pending = createScheduledJournalMcp().fetch(request(envelope(), { stream, signal: controller.signal }), { DB: db });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  const response = await pending; assert.equal(response.status, 408); assert.equal((await response.json()).error, 'request_cancelled');
  assert.equal(cancelled, true); assert.equal(db.calls.length, 0);
});

test('oversized streamed body is cancelled even when stream cancellation never resolves', async t => {
  const db = database(t); let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(SCHEDULED_MCP_LIMITS.bodyBytes + 1)); }, cancel() { cancelled = true; return new Promise(() => {}); } });
  const response = await createScheduledJournalMcp().fetch(request(envelope(), { stream }), { DB: db });
  assert.equal(response.status, 413); assert.equal(cancelled, true); assert.equal(db.calls.length, 0);
});

test('an indefinitely stalled request body returns at the configured bound with no journal access', async t => {
  const db = database(t); let cancelled = false;
  const stream = new ReadableStream({ pull() {}, cancel() { cancelled = true; } });
  const started = Date.now(), response = await createScheduledJournalMcp().fetch(request(envelope(), { stream }), { DB: db });
  assert.equal(response.status, 408); assert.equal((await response.json()).error, 'operation_timed_out');
  assert.ok(Date.now() - started < SCHEDULED_MCP_LIMITS.bodyTimeoutMs + 2000); assert.equal(cancelled, true); assert.equal(db.calls.length, 0);
});

for (const order of ['abort_then_close', 'close_then_abort']) test(`final body read ${order} cannot reach a tool`, async t => {
  const db = database(t), controller = new AbortController(), body = read(); let pulls = 0;
  const stream = new ReadableStream({ pull(c) {
    if (++pulls === 1) c.enqueue(new TextEncoder().encode(JSON.stringify(body)));
    else if (order === 'abort_then_close') { controller.abort(); c.close(); }
    else { c.close(); controller.abort(); }
  } });
  const result = await call(db, body, { stream, signal: controller.signal });
  assert.deepEqual(result, { status: 408, body: { ok: false, error: 'request_cancelled' } });
  assert.equal(db.calls.length, 0);
});

test('immediate empty body fragments are bounded even with a frozen monotonic clock', async t => {
  t.mock.method(performance, 'now', () => 0);
  const db = database(t), body = read(); let pulls = 0, cancelled = false;
  const stream = new ReadableStream({ pull(c) {
    if (++pulls <= 20_000) c.enqueue(new Uint8Array(0));
    else { c.enqueue(new TextEncoder().encode(JSON.stringify(body))); c.close(); }
  }, cancel() { cancelled = true; return new Promise(() => {}); } });
  const result = await call(db, body, { stream });
  assert.deepEqual(result, { status: 413, body: { ok: false, error: 'mcp_request_too_fragmented' } });
  assert.equal(SCHEDULED_MCP_LIMITS.bodyChunks, 16_384); assert.ok(pulls <= SCHEDULED_MCP_LIMITS.bodyChunks + 2);
  assert.equal(cancelled, true); assert.equal(db.calls.length, 0);
});

test('monotonic body deadline catches immediate reads before a timer callback can run', async t => {
  let calls = 0; t.mock.method(performance, 'now', () => calls++ ? SCHEDULED_MCP_LIMITS.bodyTimeoutMs + 1 : 0);
  const db = database(t), body = read();
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(body))); c.close(); } });
  assert.deepEqual(await call(db, body, { stream }), { status: 408, body: { ok: false, error: 'operation_timed_out' } });
  assert.equal(db.calls.length, 0);
});
