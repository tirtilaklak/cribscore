import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledJournalMcp } from '../server/journal/scheduled-mcp.mjs';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { handleJournalRequest } from '../server/journal-api.js';
import { SQLiteD1 } from './helpers/sqlite-d1.mjs';
import { base, ENROLL, observationContext } from './fixtures/journal-observer.mjs';

test('observation advertises non-idempotence because a successful no-op can later append on exact retry', async t => {
  const db = new SQLiteD1(); t.after(() => db.close());
  const origin = 'https://synthetic-idempotence.invalid';
  let now = ENROLL;
  const observer = createJournalObserver({ readObservationContext: observationContext, clock: () => now });
  const service = createScheduledJournalMcp({ observer, writesEnabled: true, now: () => now });
  const headers = { origin, 'content-type': 'application/json', 'oai-authenticated-user-id': 'synthetic-owner' };
  const setup = await handleJournalRequest(new Request(origin + '/api/journal', { method: 'POST', headers,
    body: JSON.stringify({ expectedRevision: 0, journal: base() }),
  }), { DB: db }, { now: () => now });
  assert.equal(setup.status, 200);
  async function call(method, params = {}) {
    const response = await service.fetch(new Request(origin + '/mcp', { method: 'POST',
      headers: { ...headers, 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} }, ...params } }),
    }), { DB: db });
    assert.equal(response.status, 200);
    return response.json();
  }
  const observe = async args => {
    const rpc = await call('tools/call', { name: 'journal_observe_scheduled', arguments: args });
    assert.equal(rpc.result.isError, false);
    return JSON.parse(rpc.result.content[0].text);
  };
  const initial = await observe({ expectedJournalId: base().journalId, expectedRevision: 0, requestId: 'synthetic-initial' });
  assert.equal(initial.appendedEvents, 2);
  const exactArgs = { expectedJournalId: base().journalId, expectedRevision: 2, requestId: 'synthetic-noop-retry' };
  const noOp = await observe(exactArgs);
  assert.equal(noOp.appendedEvents, 0); assert.equal(noOp.revision, 2);
  const batchesBeforeRetry = db.batchCount;
  now = '2026-11-25T14:00:00Z';
  const retry = await observe(exactArgs);
  assert.equal(retry.appendedEvents, 2); assert.equal(retry.revision, 4);
  assert.equal(db.batchCount, batchesBeforeRetry + 1);
  assert.deepEqual(retry.eventCounts, { abstain: 4 });
  const listed = (await call('tools/list')).result.tools;
  assert.equal(listed.find(tool => tool.name === 'journal_observe_scheduled').annotations.idempotentHint, false);
  assert.equal(listed.find(tool => tool.name === 'journal_observation_status').annotations.idempotentHint, true);
});
