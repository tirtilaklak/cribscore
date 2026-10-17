import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseSecSubmissions, parseSecCompanyFactsCandidates, parseBlsMonthly, parseBlsSeries, normalizeH15Rows, wasObservedBy, secSourceUrl, isoInstant, assessEvidenceFreshness} from './official-adapters.mjs';
const cik = '0001065280';
const at = '2026-10-17T01:00:00Z';
const capture = url => ({url, retrievedAt: at, mode: 'synthetic_fixture'});
const rawCapture = (url, bytes) => ({url,retrievedAt:at,mode:'raw_response',status:'retrieved',sha256:createHash('sha256').update(bytes).digest('hex')});
const submissions = () => ({cik: 1065280, name: 'Synthetic issuer', tickers: ['TEST'], exchanges: ['TEST'], filings: {recent: {
  accessionNumber: ['0001065280-26-000001'], filingDate: ['2026-10-16'], reportDate: ['2026-09-30'],
  acceptanceDateTime: ['2026-10-16T19:30:00Z'], form: ['10-Q'], primaryDocument: ['test.htm']}, files: []}});
test('SEC recent columns preserve accession/timestamps without inferred publication', () => {
  const data = parseSecSubmissions(submissions(), capture(secSourceUrl('submissions', cik)), cik);
  assert.equal(data.records[0].exactPublicDisseminationAt, null);
  assert.equal(data.records[0].statementContextValidated, false);
  assert.equal(data.coverage.completeHistory, false);
  assert.equal(data.records[0].source.eligibleForRanking, false);
});
test('SEC mismatched columns and issuer fail before emitting records', () => {
  const bad = submissions(); bad.filings.recent.form = [];
  assert.throws(() => parseSecSubmissions(bad, capture(secSourceUrl('submissions', cik)), cik), /misaligned/);
  assert.throws(() => parseSecSubmissions(submissions(), capture(secSourceUrl('submissions', '320193')), '320193'), /issuer_identity/);
});
test('SEC future acceptance and path escape fail', () => {
  const bad = submissions(); bad.filings.recent.acceptanceDateTime[0] = '2026-10-18T00:00:00Z';
  assert.throws(() => parseSecSubmissions(bad, capture(secSourceUrl('submissions', cik)), cik), /future_filing/);
  bad.filings.recent.acceptanceDateTime[0] = '2026-10-16T00:00:00Z'; bad.filings.recent.primaryDocument[0] = '../other';
  assert.throws(() => parseSecSubmissions(bad, capture(secSourceUrl('submissions', cik)), cik), /unsafe_primary/);
});
test('source URLs and raw capture hashes cannot be omitted or substituted', () => {
  assert.throws(() => parseSecSubmissions(submissions(), capture('https://evil.example'), cik), /source_identity/);
  assert.throws(() => parseSecSubmissions(submissions(), {...capture(secSourceUrl('submissions', cik)),mode:'raw_response',status:'retrieved'}, cik), /capture_hash/);
});
const fact = {start:'2026-01-01',end:'2026-06-30',val:123,accn:'0001065280-26-000001',filed:'2026-07-15',form:'10-Q',fy:2026,fp:'Q2'};
const facts = () => ({cik:1065280,entityName:'Synthetic issuer',facts:{'us-gaap':{NetIncomeLoss:{units:{USD:[fact,{...fact,val:125,accn:'0001065280-26-000002',form:'10-Q/A',filed:'2026-08-01'}]}}}}});
const selector = {cik,taxonomy:'us-gaap',concept:'NetIncomeLoss',unit:'USD'};
test('companyfacts preserves conflicting/amended candidate values without validation', () => {
  const rows = parseSecCompanyFactsCandidates(facts(),capture(secSourceUrl('companyfacts',cik)),selector);
  assert.deepEqual(rows.map(row=>row.rawReportedValue),[123,125]);
  assert.ok(rows.every(row=>row.dimensions === null && row.contextId === null && !row.statementContextValidated));
  assert.ok(rows.every(row=>!row.source.eligibleForRanking));
});
test('companyfacts exact unit and taxonomy are required', () => {
  assert.throws(()=>parseSecCompanyFactsCandidates(facts(),capture(secSourceUrl('companyfacts',cik)),{...selector,unit:'USD/shares'}), /unit_missing/);
  assert.throws(()=>parseSecCompanyFactsCandidates(facts(),capture(secSourceUrl('companyfacts',cik)),{...selector,taxonomy:'custom'}), /unsupported_taxonomy/);
});
test('capture time controls observed-by; filing date does not backdate it', () => {
  const bytes=JSON.stringify(submissions());
  const cap = rawCapture(secSourceUrl('submissions',cik),bytes);
  const row = parseSecSubmissions(bytes, cap, cik).records[0];
  assert.equal(wasObservedBy(row,'2026-10-16T23:00:00Z'),false);
  assert.equal(wasObservedBy(row,'2026-10-17T01:00:00Z'),true);
  assert.equal(wasObservedBy({...row,source:{...row.source,mode:undefined}},at),false);
  assert.equal(wasObservedBy({...row,source:{...row.source,firstObservedAt:'2026-10-16T00:00:00Z'}},at),false);
  assert.equal(wasObservedBy(parseSecSubmissions(submissions(),capture(secSourceUrl('submissions',cik)),cik).records[0],'2026-10-18T01:00:00Z'),false);
});
const seriesId = 'LNS14000000';
const blsCap = capture(`https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}`);
const bls = () => ({status:'REQUEST_SUCCEEDED',Results:{series:[{seriesID:seriesId,data:[{year:'2026',period:'M09',value:'4.2',footnotes:[{code:'P',text:'Preliminary'}]},{year:'2026',period:'M08',value:'-',footnotes:[{}]}]}]}});
test('BLS missing value stays null, units unknown, preliminary note retained', () => {
  const rows = parseBlsMonthly(bls(), blsCap, seriesId);
  assert.equal(rows[1].rawReportedValue,null); assert.equal(rows[0].unit,null);
  assert.equal(rows[0].footnotes[0].code,'P'); assert.equal(rows[0].originalReleaseAt,null);
  assert.equal(rows[0].originalVintageVerified,false);
});
test('BLS M13 annual average cannot be treated as December/monthly', () => {
  const data = bls(); data.Results.series[0].data[0].period='M13';data.Results.series[0].data[0].year='2025';
  assert.throws(()=>parseBlsMonthly(data,blsCap,seriesId), /nonmonthly_period/);
});
test('BLS full series preserves annual averages and every footnote separately', () => {
  const data=bls(); data.Results.series[0].data.push({year:'2025',period:'M13',periodName:'Annual',value:'310.000',footnotes:[{}]});
  const rows=parseBlsSeries(data,blsCap,seriesId);
  assert.equal(rows[2].period,'2025');assert.equal(rows[2].periodKind,'annual_average');
  assert.equal(rows[2].rawPeriod,'M13');assert.equal(rows[2].rawReportedString,'310.000');assert.deepEqual(rows[2].footnotes,[{}]);
  assert.deepEqual(rows[1].footnotes,[{}]);
});
test('BLS unsuccessful responses and wrong series fail closed', () => {
  assert.throws(()=>parseBlsMonthly({...bls(),status:'REQUEST_FAILED'},blsCap,seriesId), /unsuccessful/);
  const data = bls(); data.Results.series[0].seriesID='OTHER';
  assert.throws(()=>parseBlsMonthly(data,blsCap,seriesId), /identity_mismatch/);
});
test('H15 release, observation and retrieved dates remain distinct; missing is null', () => {
  const rows = normalizeH15Rows({releaseDate:'2026-10-16',rows:[{series:'test',observationDate:'2026-10-15',value:null,missingMarker:'n.a.'}]},capture('https://www.federalreserve.gov/releases/h15/'));
  assert.equal(rows[0].value,null); assert.equal(rows[0].observationDate,'2026-10-15');
  assert.equal(rows[0].releaseDate,'2026-10-16'); assert.equal(rows[0].realtime,false);
  assert.equal(rows[0].source.retrievedAt,at);
});
test('H15 future/duplicate rows are rejected; invalid UTC dates do not roll over', () => {
  const row = {series:'test',observationDate:'2026-10-17',value:3};
  assert.throws(()=>normalizeH15Rows({releaseDate:'2026-10-16',rows:[row]},capture('https://www.federalreserve.gov/releases/h15/')), /after_release/);
  row.observationDate='2026-10-15';
  assert.throws(()=>normalizeH15Rows({releaseDate:'2026-10-16',rows:[row,row]},capture('https://www.federalreserve.gov/releases/h15/')), /duplicate/);
  assert.throws(()=>isoInstant('2026-02-30T00:00:00Z'), /invalid/);
});
test('fresh transport cannot refresh a months-old filing or a synthetic fixture', () => {
  const row = {filedDate:'2026-07-17',period:{end:'2025-06-30'},source:{retrievedAt:at,mode:'raw_response'}};
  const state = assessEvidenceFreshness(row,'2026-10-17T02:00:00Z',{maxRetrievalAgeHours:12,maxObservationAgeDays:3});
  assert.equal(state.retrievalStatus,'within_age_policy');
  assert.equal(state.observationStatus,'old_observation');
  assert.equal(state.observationDate,'2025-06-30');
  assert.equal(state.filingDate,'2026-07-17');
  assert.equal(state.eligibleForRanking,false);
  assert.equal(assessEvidenceFreshness({...row,source:{...row.source,mode:'synthetic_fixture'}},at).retrievalStatus,'fixture_not_live');
});
test('raw JSON parser verifies original bytes and rejects payload substitution', () => {
  const bytes=JSON.stringify(submissions()), cap=rawCapture(secSourceUrl('submissions',cik),bytes);
  assert.throws(()=>parseSecSubmissions(submissions(),cap,cik), /raw_capture_bytes_required/);
  assert.throws(()=>parseSecSubmissions(bytes.replace('Synthetic issuer','Changed issuer'),cap,cik), /raw_capture_hash_mismatch/);
  const row=parseSecSubmissions(bytes,cap,cik).records[0];
  assert.equal(row.source.rawCaptureHashVerified,true);
  assert.throws(()=>{row.source.firstObservedAt='2020-01-01T00:00:00Z';},TypeError);
});
test('failed capture cannot become observed evidence and H15 rows cannot claim raw validation', () => {
  const bytes=JSON.stringify(submissions()),cap=rawCapture(secSourceUrl('submissions',cik),bytes);
  assert.throws(()=>parseSecSubmissions(bytes,{...cap,status:'blocked'},cik), /capture_not_retrieved/);
  assert.equal(wasObservedBy({source:{mode:'raw_response',firstObservedAt:at,retrievedAt:at,captureStatus:'blocked',rawCaptureHashVerified:true}},at),false);
  assert.throws(()=>normalizeH15Rows({releaseDate:'2026-10-16',rows:[]},{...cap,url:'https://www.federalreserve.gov/releases/h15/'}), /raw_h15_parser_unavailable/);
});
test('SEC nested rendering paths are allowed while path traversal remains rejected', () => {
  const data=submissions(); data.filings.recent.primaryDocument[0]='xslF345X05/ownership.xml';
  assert.match(parseSecSubmissions(data,capture(secSourceUrl('submissions',cik)),cik).records[0].primaryDocumentUrl,/xslF345X05\/ownership.xml$/);
  data.filings.recent.primaryDocument[0]='xslF345X05/../ownership.xml';
  assert.throws(()=>parseSecSubmissions(data,capture(secSourceUrl('submissions',cik)),cik), /unsafe_primary_document/);
});
test('stale transport and future clocks fail freshness without changing original timestamps', () => {
  const row = {observationDate:'2026-10-15',source:{retrievedAt:at,mode:'web_tool_read'}};
  assert.equal(assessEvidenceFreshness(row,'2026-10-18T01:00:00Z').retrievalStatus,'stale_capture');
  assert.equal(assessEvidenceFreshness(row,'2026-10-16T01:00:00Z').retrievalStatus,'clock_or_future_capture_error');
  assert.equal(row.source.retrievedAt,at);
  assert.throws(()=>assessEvidenceFreshness(row,at,{maxRetrievalAgeHours:0}), /invalid_freshness_policy/);
});

test('BLS monthly freshness preserves period precision and never invents a release day', () => {
  const rows=parseBlsSeries(bls(),blsCap,seriesId);
  assert.deepEqual(rows[0].observationPeriod,{start:'2026-09-01',end:'2026-09-30',kind:'month'});
  const state=assessEvidenceFreshness(rows[0],at,{maxObservationAgeDays:14});
  assert.equal(state.observationDate,null);
  assert.equal(state.dateBasis,null);
  assert.equal(state.observationAgeCalendarDays,null);
  assert.equal(state.periodEndAgeCalendarDays,17);
  assert.equal(state.periodDateBasis,'month_period_end');
  assert.equal(state.observationStatus,'old_period');
  assert.equal(state.exactPublishedAt,null);
  assert.equal(state.vintageAsOf,at);
  assert.equal(state.originalVintageVerified,false);
  assert.throws(()=>assessEvidenceFreshness({...rows[0],observationPeriod:{...rows[0].observationPeriod,end:'2026-10-16'}},at),/invalid_observation_period/);
});

test('BLS monthly boundaries handle leap years and annual average stays a full year', () => {
  const data=bls();
  data.Results.series[0].data=[{year:'2024',period:'M02',value:'1'},{year:'2025',period:'M13',value:'2'}];
  const rows=parseBlsSeries(data,blsCap,seriesId);
  assert.deepEqual(rows[0].observationPeriod,{start:'2024-02-01',end:'2024-02-29',kind:'month'});
  assert.deepEqual(rows[1].observationPeriod,{start:'2025-01-01',end:'2025-12-31',kind:'annual_average'});
  assert.equal(assessEvidenceFreshness(rows[1],at).periodDateBasis,'annual_average_period_end');
});

test('BLS rejects overflowing numeric strings and malformed observations without treating them as missing', () => {
  const data=bls(); data.Results.series[0].data[0].value='9'.repeat(400);
  assert.throws(()=>parseBlsSeries(data,blsCap,seriesId),/bls_number_invalid/);
  data.Results.series[0].data=null;
  assert.throws(()=>parseBlsSeries(data,blsCap,seriesId),/bls_data_missing/);
  data.Results.series[0].data=[null];
  assert.throws(()=>parseBlsSeries(data,blsCap,seriesId),/bls_observation_invalid/);
});

test('a correct raw hash does not license lossy UTF-8 decoding of SEC identifiers', () => {
  const bytes=Buffer.from(JSON.stringify(submissions()).replace('Synthetic issuer','START'));
  const start=bytes.indexOf('START'); bytes[start]=0xff;
  assert.throws(()=>parseSecSubmissions(bytes,rawCapture(secSourceUrl('submissions',cik),bytes),cik),/captured_json_invalid/);
});
