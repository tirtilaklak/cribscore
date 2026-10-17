import test from 'node:test';
import assert from 'node:assert/strict';
import { commitRefresh, projectArchive, planRefresh } from '../dist/lib/refresh.js';
import { archive, event, options, correctionEvent, renewal, planInput } from './fixtures.mjs';

test('candidate cannot extend the expiry of an existing capture audit identity', () => {
  const previous = archive();
  previous.records[0].rights[0].expiresAt = '2026-10-17T10:30:00Z';
  const update = correctionEvent();
  // Same reviewId, version and original audited-at timestamp as the expired audit.
  // No actual newly observed renewal and no termsEvidence are supplied.
  const result = commitRefresh(previous, update, options);
  assert.equal(result.accepted, false, 'edited audit embedded in candidate must not authorize a later operation');
});

test('index-only byte changes cannot authorize a changed filing fact', () => {
  const previous = archive(); previous.records[0].source.indexSha256 = 'c'.repeat(64);
  const update = correctionEvent();
  update.candidate.source.sha256 = previous.records[0].source.sha256;
  update.candidate.source.indexSha256 = 'd'.repeat(64);
  update.changeReview.sourceHash = update.candidate.source.sha256;
  const result = commitRefresh(previous, update, options);
  assert.equal(result.accepted, false, 'same document cannot acquire a new financial value because index bytes changed');
});

test('hash capitalization cannot make identical filing bytes new evidence', () => {
  const previous = archive(), update = correctionEvent();
  update.candidate.source.sha256 = previous.records[0].source.sha256.toUpperCase();
  update.changeReview.sourceHash = update.candidate.source.sha256;
  assert.equal(commitRefresh(previous, update, options).accepted, false);
});

test('additional read inspector cannot mutate an immutable observation', () => {
  const previous = archive(), original = structuredClone(previous);
  projectArchive(previous, { ...options, inspectEvidence(record) {
    record.issuer.name = 'MUTATED ISSUER';
    record.source.sha256 = 'f'.repeat(64);
    return { eligible: true };
  }});
  assert.deepEqual(previous, original, 'additional inspector must receive isolated input');
});

test('additional commit inspector cannot mutate an admitted candidate after validation', () => {
  const update = correctionEvent();
  let calls = 0;
  const result = commitRefresh(archive(), update, { ...options, inspectEvidence(record) {
    calls++;
    if (calls === 5) record.period.end = '2025-09-30';
    return { eligible: true };
  }});
  assert.ok(!result.accepted || result.archive.records.at(-1).period.end === '2023-09-30', 'injected inspector must not alter the validated exact period');
});

test('additional inspector cannot alter the global exact-context constraints', () => {
  let sharedExpected;
  projectArchive(archive(), { ...options, inspectEvidence(record, settings) {
    sharedExpected = settings.expected;
    settings.expected.metricConcept = 'Revenues';
    return { eligible: true };
  }});
  try { assert.equal(projectArchive(archive(), options).facts.length, 1); }
  finally { sharedExpected.metricConcept = 'NetIncomeLoss'; }
});

test('numerical display applies exact allowlisted review URL scope', () => {
  const previous = archive();
  previous.records[0].rights[0].sourceBinding.urls.push('https://www.sec.gov/other-source');
  assert.equal(projectArchive(previous, options).facts.length, 0);
});

test('malformed archive runs fail closed during planning', () => {
  const input = planInput(); input.lastArchive.runs = {};
  assert.equal(planRefresh(input).allowed, false);
});

test('a new commit cannot precede the prior transaction commit', () => {
  const first = commitRefresh(archive(), correctionEvent(), options);
  assert.equal(first.accepted, true);
  const update = { ...event('failed'), runId: 'SYNTHETIC-earlier-commit', expectedRevision: 2,
    startedAt: '2026-10-17T11:01:01Z', checkedAt: '2026-10-17T11:01:30Z',
    failure: { code: 'synthetic_failure' } };
  const result = commitRefresh(first.archive, update, { at: '2026-10-17T11:02:00Z' });
  assert.equal(result.accepted, false, 'a revision cannot be committed before its parent revision exists');
});

test('a new candidate audit identity still requires contemporary terms evidence', () => {
  const update = correctionEvent();
  update.candidate.rights[0].reviewId = 'SYNTHETIC-new-audit-without-terms';
  update.candidate.rights[0].reviewedAt = update.candidate.rights[0].validFrom = '2026-10-17T10:45:00Z';
  assert.equal(commitRefresh(archive(), update, options).accepted, false);
});

test('a replay after a later rights revocation stays idempotent without exposing blocked facts', () => {
  const update = event(), first = commitRefresh(archive(), update, options);
  const revoke = renewal(); revoke.operations.display = 'revoked';
  revoke.reviewedAt = revoke.validFrom = '2026-10-17T12:01:00Z';
  const second = commitRefresh(first.archive, {
    runId: 'SYNTHETIC-run-3', expectedRevision: 2,
    startedAt: '2026-10-17T12:00:01Z', checkedAt: '2026-10-17T12:02:00Z',
    outcome: 'failed', failure: { code: 'rights_review_required' }, rightsReviews: [revoke]
  }, { at: '2026-10-17T12:03:00Z' });
  assert.equal(second.accepted, true);
  assert.equal(commitRefresh(second.archive, update, { at: '2026-10-17T12:04:00Z' }).accepted, true);
  assert.equal(projectArchive(second.archive, { at: '2026-10-17T12:04:00Z' }).facts.length, 0);
});
