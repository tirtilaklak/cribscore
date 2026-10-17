import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planOfficialSourceRecovery} from './capture-recovery.mjs';
const url='https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0';
const retainedBytes=Buffer.from('{"synthetic":true}');
const attempt=()=>({url,status:'retrieved',method:'GET',retryCount:0,mode:'raw_response',httpStatus:200,contentType:'application/json',startedAt:'2026-10-17T01:28:32.019Z',retrievedAt:'2026-10-17T01:28:32.346Z',sha256:createHash('sha256').update(retainedBytes).digest('hex'),byteLength:retainedBytes.byteLength});
const input=()=>({url,attempts:[attempt()],retainedBytes,at:'2026-10-17T05:00:00Z'});

test('recovery verifies bytes and preserves capture clock; cache expiry requests new scope without a retry',()=>{
  const args=input(), before=structuredClone(args.attempts);
  const reused=planOfficialSourceRecovery(args);
  assert.equal(reused.action,'reuse_retained_capture');
  assert.equal(reused.retainedCaptureAt,args.attempts[0].retrievedAt);
  assert.equal(reused.requestAllowed,false);
  assert.equal(reused.eligibleForRanking,false);
  assert.deepEqual(args.attempts,before);
  assert.equal(planOfficialSourceRecovery({...args,at:'2026-10-18T05:00:00Z'}).reason,'retained_capture_stale');
  assert.equal(planOfficialSourceRecovery({...args,retainedBytes:Buffer.from('bad')}).reason,'retained_bytes_mismatch');
  assert.equal(planOfficialSourceRecovery({...args,retainedBytes:undefined}).action,'verify_retained_bytes');
});

test('a later failed or uncertain attempt cannot disappear behind earlier successful cached bytes',()=>{
  for(const status of ['blocked','failed','denied','pending','attempting','uncertain']) {
    const args=input(); args.attempts.push({url,status,startedAt:'2026-10-17T03:00:00Z'});
    const result=planOfficialSourceRecovery(args);
    assert.equal(result.action,['blocked','failed','denied'].includes(status)?'stop':'inspect_uncertain_outcome');
    assert.equal(result.automaticRetryAllowed,false);
    assert.equal(result.retainedCaptureAt,null);
  }
  const args=input(); args.attempts=[{url,status:'blocked',startedAt:'2026-10-17T03:00:00Z'},attempt()];
  assert.equal(planOfficialSourceRecovery(args).reason,'attempt_history_clock_invalid');
});

test('Treasury HTTP 200 HTML rejection remains stopped and is not promoted by status-only edits',()=>{
  const treasury='https://home.treasury.gov/treasury-daily-interest-rate-xml-feed?data=daily_treasury_yield_curve&field_tdr_date_value=2026';
  const args=input(); args.url=treasury; args.attempts=[{...attempt(),url:treasury,status:'blocked',contentType:'text/html; charset=utf-8'}];
  assert.equal(planOfficialSourceRecovery(args).reason,'prior_attempt_stopped_no_automatic_retry');
  args.attempts[0].status='retrieved';
  assert.equal(planOfficialSourceRecovery(args).reason,'capture_content_type_mismatch');
  args.attempts[0].contentType='application/atom+xml';
  assert.equal(planOfficialSourceRecovery(args).reason,'treasury_xml_parser_unavailable');
});

test('manual recovery scope cannot be created by malformed, future, cross-source or missing history',()=>{
  assert.equal(planOfficialSourceRecovery({...input(),attempts:undefined}).reason,'attempt_history_required');
  assert.equal(planOfficialSourceRecovery({...input(),attempts:[]}).action,'request_manual_scope');
  assert.equal(planOfficialSourceRecovery({...input(),url:url+'?alternate=1'}).reason,'official_endpoint_not_supported');
  const args=input(); args.attempts[0].url='https://data.sec.gov/submissions/CIK0001065280.json';
  assert.equal(planOfficialSourceRecovery(args).reason,'attempt_history_source_mismatch');
  args.attempts[0]=attempt();args.attempts[0].retrievedAt='2026-10-18T01:00:00Z';
  assert.equal(planOfficialSourceRecovery(args).reason,'capture_clock_invalid');
});
