import test from 'node:test';
import assert from 'node:assert/strict';
import { rightsGate, assertSecUrl, SEC_TARGET, extractOriginalFact, fetchDocument, sha256, runCapture } from './sec-adapter.mjs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectEvidence } from '../dist/lib/evidence.js';

const at = '2026-10-16T23:40:00Z';
const review = {reviewId:'synthetic-test',version:1,reviewedAt:'2026-10-16T23:00:00Z',validFrom:'2026-10-16T23:00:00Z',expiresAt:'2026-10-17T00:00:00Z',termsUrl:'https://www.sec.gov/privacy',purpose:'historical_financial_facts',sourceBinding:{cik:SEC_TARGET.cik,accession:SEC_TARGET.accession,urls:[SEC_TARGET.url,SEC_TARGET.indexUrl]},operations:{fetch:'allowed',store:'allowed',transform:'allowed',display:'allowed'}};
const fixtureIndex = '<title>Form 10-K - Annual report</title> Apple Inc. 0000320193-23-000106 Filing Date 2023-11-03 Accepted 2023-11-02 18:08:27';
const fixture = '<xbrli:context id="c1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000320193</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2022-09-25</xbrli:startDate><xbrli:endDate>2023-09-30</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><ix:nonFraction name="us-gaap:NetIncomeLoss" contextRef="c1" unitRef="usd" scale="6" id="ni1">96,995</ix:nonFraction>';

test('rights are checked per operation and actual time', () => {
  assert.equal(rightsGate(review,'fetch',at),true);
  for (const state of ['unknown','denied','revoked']) assert.throws(()=>rightsGate({...review,operations:{display:state}},'display',at),/rights_display_not_allowed/);
  assert.throws(()=>rightsGate(review,'display','2026-10-17T01:00:00Z'),/rights_not_current/);
  assert.throws(()=>rightsGate({...review,validFrom:'2020-01-01T00:00:00Z'},'fetch',at),/rights_not_current/);
  assert.throws(()=>rightsGate({...review,reviewedAt:'2026-10-16T23:50:00Z'},'fetch',at),/rights_not_current/);
  assert.throws(()=>rightsGate(review,'fetch','2026-10-16T23:40:00'),/rights_timestamp_invalid/);
  assert.throws(()=>rightsGate({...review,reviewedAt:'2026-02-30T00:00:00Z'},'fetch',at),/rights_timestamp_invalid/);
});
test('network source is restricted to exact identity and documents',()=>{
  assert.equal(assertSecUrl(SEC_TARGET.url),SEC_TARGET.url);
  for (const url of [SEC_TARGET.url.replace('www.sec.gov','example.com'),SEC_TARGET.url.replace('320193/','123/'),SEC_TARGET.url+'?x=1',SEC_TARGET.url.replace('aapl-20230930.htm','other.htm')]) assert.throws(()=>assertSecUrl(url));
});
test('synthetic exact fact has explicit original context',()=>{
  const got = extractOriginalFact(fixture,fixtureIndex);
  assert.equal(got.value,96995); assert.equal(got.contextId,'c1');
  assert.equal(got.acceptedAt,'2023-11-02T18:08:27-04:00'); assert.equal(got.publishedDate,'2023-11-03');
});
test('wrong issuer, period, dimensions and missing original do not yield facts',()=>{
  for (const bad of [fixture.replace('0000320193','0000000001'),fixture.replace('2022-09-25','2023-01-01'),fixture.replace('</xbrli:entity>','<xbrli:segment><xbrldi:explicitMember>Product</xbrldi:explicitMember></xbrli:segment></xbrli:entity>')]) assert.throws(()=>extractOriginalFact(bad,fixtureIndex),/exact_fact_missing/);
  assert.throws(()=>extractOriginalFact(fixture,fixtureIndex.replace('Form 10-K -','Form 10-K/A -')),/amendment_not_original/);
});
test('wrong currency, per-share units, scale and conflict fail closed',()=>{
  for (const bad of [fixture.replace('iso4217:USD','iso4217:EUR'),fixture.replace('scale="6"','scale="9"'),fixture.replace('iso4217:USD','iso4217:USD</xbrli:measure><xbrli:measure>xbrli:shares'),fixture.replace('scale="6"','sign="-" scale="6"')]) assert.throws(()=>extractOriginalFact(bad,fixtureIndex),/fact_units_or_scale_invalid/);
  assert.throws(()=>extractOriginalFact(fixture+fixture.match(/<ix:nonFraction[\s\S]*$/)[0].replace('96,995','96,996'),fixtureIndex),/fact_context_conflict/);
});
test('rights denial blocks network before the fetcher is called',async()=>{
  let calls=0;
  await assert.rejects(fetchDocument(SEC_TARGET.url,{review:{...review,operations:{fetch:'denied'}},userAgent:'Cribscore/test',fetcher:async()=>{calls++;},now:()=>at}),/rights_fetch_not_allowed/);
  assert.equal(calls,0);
});
test('rights for another source or purpose cannot authorize this capture',()=>{
  assert.throws(()=>rightsGate({...review,sourceBinding:{...review.sourceBinding,cik:'0000000001'}},'fetch',at),/rights_source_binding_mismatch/);
  assert.throws(()=>rightsGate({...review,purpose:'model_training'},'transform',at),/rights_source_binding_mismatch/);
});
test('403 and 429 cause one stop, no retry',async()=>{
  for(const status of [403,429]) {
    let calls=0;
    await assert.rejects(fetchDocument(SEC_TARGET.url,{review,userAgent:'Cribscore/test',fetcher:async()=>{calls++; return new Response('blocked',{status});},now:()=>at}),new RegExp(`sec_http_${status}_stop_no_retry`));
    assert.equal(calls,1);
  }
});
test('successful fake response hashes exact bytes and records completion time',async()=>{
  const payload='<html>'+ 'synthetic '.repeat(20)+'</html>';
  const got = await fetchDocument(SEC_TARGET.url,{review,userAgent:'Cribscore/test',fetcher:async()=>new Response(payload,{headers:{'content-type':'text/html'}}),now:()=>at});
  assert.equal(got.sha256,sha256(Buffer.from(payload))); assert.equal(got.fetchedAt,at);
});

test('full mock capture retains private exact bytes, audit manifest and guard-compatible fact',async()=>{
  const root = await mkdtemp(join(tmpdir(),'cribscore-sec-test-'));
  try {
    await mkdir(join(root,'evidence')); await mkdir(join(root,'dist/data'),{recursive:true});
    await writeFile(join(root,'evidence/sec-rights-review.json'),JSON.stringify(review));
    const called=[], waits=[];
    const result = await runCapture({outputRoot:root,userAgent:'Cribscore/test',now:()=>at,wait:async ms=>{waits.push(ms);},fetcher:async (url,options)=>{
      called.push(url); assert.equal(options.redirect,'error');
      return new Response(url===SEC_TARGET.indexUrl?fixtureIndex:fixture,{headers:{'content-type':'text/html'}});
    }});
    assert.deepEqual(called,[SEC_TARGET.indexUrl,SEC_TARGET.url]); assert.deepEqual(waits,[1100]);
    const disk = JSON.parse(await readFile(join(root,'dist/data/sec-evidence.json'),'utf8'));
    assert.equal(disk.records.length,1); assert.deepEqual(disk,result);
    const record = disk.records[0]; assert.equal(record.source.publishedAt,null);
    assert.equal(inspectEvidence(record,{operation:'display',at}).eligible,true);
    assert.equal(await readFile(join(root,'evidence/sec-original',`${record.source.sha256}.html`),'utf8'),fixture);
    const manifest = JSON.parse(await readFile(join(root,'evidence/sec-capture-manifest.json'),'utf8'));
    assert.equal(manifest.documents.length,2); assert.equal(manifest.documents[1].sha256,sha256(fixture));
    assert.equal(JSON.stringify(disk).includes(fixture),false);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('full capture does not fetch or emit a record when first operation lacks rights',async()=>{
  const root = await mkdtemp(join(tmpdir(),'cribscore-sec-denial-'));
  try {
    await mkdir(join(root,'evidence'));
    await writeFile(join(root,'evidence/sec-rights-review.json'),JSON.stringify({...review,operations:{fetch:'unknown'}}));
    let calls=0;
    await assert.rejects(runCapture({outputRoot:root,userAgent:'Cribscore/test',now:()=>at,fetcher:async()=>{calls++;}}),/rights_fetch_not_allowed/);
    assert.equal(calls,0);
    await assert.rejects(readFile(join(root,'dist/data/sec-evidence.json')),/ENOENT/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('an existing corrupted audit file cannot inherit its filename hash',async()=>{
  const root = await mkdtemp(join(tmpdir(),'cribscore-sec-corrupt-'));
  try {
    await mkdir(join(root,'evidence/sec-original'),{recursive:true}); await mkdir(join(root,'dist/data'),{recursive:true});
    await writeFile(join(root,'evidence/sec-rights-review.json'),JSON.stringify(review));
    await writeFile(join(root,'evidence/sec-original',`${sha256(fixture)}.html`),'corrupt');
    await assert.rejects(runCapture({outputRoot:root,userAgent:'Cribscore/test',now:()=>at,wait:async()=>{},fetcher:async url=>new Response(url===SEC_TARGET.indexUrl?fixtureIndex:fixture,{headers:{'content-type':'text/html'}})}),/stored_audit_hash_conflict/);
    await assert.rejects(readFile(join(root,'dist/data/sec-evidence.json')),/ENOENT/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
