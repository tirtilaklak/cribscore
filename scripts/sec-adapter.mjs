import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SEC_TARGET = Object.freeze({
  cik: '0000320193', name: 'Apple Inc.', accession: '0000320193-23-000106',
  url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm',
  indexUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/0000320193-23-000106-index.html',
  concept: 'us-gaap:NetIncomeLoss', start: '2022-09-25', end: '2023-09-30'
});
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const instant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const parsed = Date.parse(value), date = Date.parse(`${value.slice(0,10)}T00:00:00Z`);
  if (!Number.isFinite(parsed) || !Number.isFinite(date) || new Date(date).toISOString().slice(0,10)!==value.slice(0,10)) return NaN;
  const time=value.slice(11,19).split(':').map(Number);
  if(time[0]>23||time[1]>59||time[2]>59) return NaN;
  if(!value.endsWith('Z')) { const zone=value.slice(-5).split(':').map(Number); if(zone[0]>14||zone[1]>59||(zone[0]===14&&zone[1]!==0))return NaN; }
  return parsed;
};

export function rightsGate(review, operation, at, target = SEC_TARGET) {
  const now = instant(at), reviewed = instant(review?.reviewedAt), start = instant(review?.validFrom), end = instant(review?.expiresAt);
  if (![now, reviewed, start, end].every(Number.isFinite)) fail('rights_timestamp_invalid');
  if (!review.reviewId || !Number.isSafeInteger(review.version) || review.version < 1 || review.termsUrl !== 'https://www.sec.gov/privacy') fail('rights_audit_missing');
  const binding = review.sourceBinding;
  if (review.purpose !== 'historical_financial_facts' || binding?.cik !== target.cik || binding?.accession !== target.accession
    || !Array.isArray(binding.urls) || binding.urls.length !== 2 || !binding.urls.includes(target.url) || !binding.urls.includes(target.indexUrl)) fail('rights_source_binding_mismatch');
  if (reviewed > now || start < reviewed || start > now || end <= now) fail('rights_not_current');
  if (review.operations?.[operation] !== 'allowed') fail(`rights_${operation}_not_allowed`);
  return true;
}

export function assertSecUrl(value, target = SEC_TARGET) {
  const u = new URL(value);
  const prefix = `/Archives/edgar/data/${Number(target.cik)}/${target.accession.replaceAll('-', '')}/`;
  if (u.protocol !== 'https:' || u.hostname !== 'www.sec.gov' || u.username || u.password || u.port || u.search || u.hash || !u.pathname.startsWith(prefix)) fail('source_identity_mismatch');
  if (value !== target.url && value !== target.indexUrl) fail('source_not_allowlisted');
  return u.href;
}

const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
const plain = s => s.replace(/<[^>]*>/g, '').replace(/&#160;|&nbsp;/g, ' ').trim();

// Deliberately narrow parser: one exact consolidated duration and USD concept.
// Segment contexts, per-share units, amendments, conflicts and absent scale fail.
export function extractOriginalFact(html, indexHtml, target = SEC_TARGET) {
  if (!indexHtml.includes(target.accession) || !indexHtml.includes('Apple Inc.')) fail('filing_identity_mismatch');
  const strippedIndex = indexHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  if (/Form 10-K\/A|Type: 10-K\/A/.test(strippedIndex)) fail('amendment_not_original');
  if (!/Form 10-K\s*[-–]/.test(strippedIndex)) fail('original_form_unverified');
  const contexts = new Map();
  for (const m of html.matchAll(/<(?:xbrli:)?context\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?context>/gi)) {
    const a = attrs(m[1]), body = m[2];
    const cik = body.match(/<(?:xbrli:)?identifier\b[^>]*>([^<]+)</i)?.[1]?.trim().padStart(10, '0');
    const start = body.match(/<(?:xbrli:)?startDate>([^<]+)</i)?.[1];
    const end = body.match(/<(?:xbrli:)?endDate>([^<]+)</i)?.[1];
    if (cik === target.cik && start === target.start && end === target.end && !/<(?:xbrli:)?segment\b|<(?:xbrli:)?scenario\b|explicitMember|typedMember/i.test(body)) contexts.set(a.id, {cik,start,end});
  }
  const usdUnits = new Set();
  for (const m of html.matchAll(/<(?:xbrli:)?unit\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?unit>/gi)) {
    const measures = [...m[2].matchAll(/<(?:xbrli:)?measure>([^<]+)</gi)].map(x=>x[1].trim());
    if (measures.length === 1 && measures[0] === 'iso4217:USD' && !/divide/i.test(m[2])) usdUnits.add(attrs(m[1]).id);
  }
  const found = [];
  for (const m of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)) {
    const a = attrs(m[1]);
    if (a.name !== target.concept || !contexts.has(a.contextref)) continue;
    if (!usdUnits.has(a.unitref) || a.scale !== '6' || a.sign || a['xsi:nil'] === 'true') fail('fact_units_or_scale_invalid');
    const n = plain(m[2]).replaceAll(',', '');
    if (!/^\d+(?:\.\d+)?$/.test(n)) fail('fact_numeric_format_invalid');
    found.push({value:Number(n),contextId:a.contextref,factId:a.id ?? null,unitId:a.unitref});
  }
  if (!found.length) fail('exact_fact_missing');
  if (new Set(found.map(x=>x.value)).size !== 1) fail('fact_context_conflict');
  const acceptance = strippedIndex.match(/Accepted\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)?.[1];
  const filed = strippedIndex.match(/Filing Date\s+(\d{4}-\d{2}-\d{2})/)?.[1];
  // This adapter covers this exact source only. Its observed acceptance falls in EDT.
  if (acceptance !== '2023-11-02 18:08:27' || filed !== '2023-11-03') fail('source_timestamp_context_unverified');
  return {...found[0],acceptedAt:'2023-11-02T18:08:27-04:00',publishedDate:filed};
}

export async function fetchDocument(url, {review, userAgent, fetcher = fetch, now = () => new Date().toISOString(), target = SEC_TARGET} = {}) {
  assertSecUrl(url, target);
  if (!userAgent || !/^Cribscore\//.test(userAgent) || userAgent.length > 250 || /[\r\n]/.test(userAgent)) fail('declared_user_agent_required');
  rightsGate(review, 'fetch', now(), target);
  const response = await fetcher(url, {headers:{'User-Agent':userAgent, 'Accept':'text/html'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if (!response.ok) fail(`sec_http_${response.status}_stop_no_retry`);
  if (!/text\/html/i.test(response.headers.get('content-type') ?? '')) fail('source_content_type_invalid');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 3_000_000 || bytes.length < 100) fail('source_size_invalid');
  return {bytes,sha256:sha256(bytes),fetchedAt:now()};
}

export async function runCapture({userAgent = process.env.CRIBSCORE_SEC_USER_AGENT, outputRoot = ROOT, fetcher = fetch,
  now = () => new Date().toISOString(), wait = ms => new Promise(r=>setTimeout(r,ms))} = {}) {
  const review = JSON.parse(await readFile(resolve(outputRoot,'evidence/sec-rights-review.json'),'utf8'));
  const index = await fetchDocument(SEC_TARGET.indexUrl,{review,userAgent,fetcher,now});
  // Sequential documents only, with a conservative one request per second ceiling.
  await wait(1100);
  const doc = await fetchDocument(SEC_TARGET.url,{review,userAgent,fetcher,now});
  rightsGate(review,'transform',now());
  const fact = extractOriginalFact(doc.bytes.toString('utf8'),index.bytes.toString('utf8'));
  const evidenceDir = resolve(outputRoot,'evidence/sec-original');
  await mkdir(evidenceDir,{recursive:true});
  rightsGate(review,'store',now());
  // Content-addressed private audit files; public dist receives facts only.
  for (const item of [index,doc]) {
    const path = resolve(evidenceDir,`${item.sha256}.html`);
    try { await writeFile(path,item.bytes,{flag:'wx'}); }
    catch(error) {
      if(error.code!=='EEXIST') throw error;
      if(sha256(await readFile(path))!==item.sha256) fail('stored_audit_hash_conflict');
    }
  }
  const ingestedAt = now();
  const record = {
    id:'aapl-2023-original-net-income', issuer:{name:SEC_TARGET.name,cik:SEC_TARGET.cik},
    metric:{taxonomy:'us-gaap',concept:'NetIncomeLoss',label:'Net income',accountingBasis:'US-GAAP'},
    value:fact.value,unit:'USD',scale:1000000,
    period:{start:SEC_TARGET.start,end:SEC_TARGET.end,type:'duration',fiscalYear:2023},scope:'consolidated',dimensions:[],
    source:{url:SEC_TARGET.url,indexUrl:SEC_TARGET.indexUrl,accession:SEC_TARGET.accession,form:'10-K',original:true,
      location:`Consolidated Statements of Operations, printed page 28; context ${fact.contextId}; fact ${fact.factId}`,
      sha256:doc.sha256,indexSha256:index.sha256,acceptedAt:fact.acceptedAt,acceptedTimezone:'America/New_York',
      publishedAt:null,publishedDate:fact.publishedDate,publishedTimePrecision:'date',publicAvailabilityObservedAt:doc.fetchedAt,
      fetchedAt:doc.fetchedAt,ingestedAt,mode:'reconstructed_public_history',parserVersion:'sec-original-v1',
      contextId:fact.contextId,factId:fact.factId,unitId:fact.unitId},rights:[review],
    limitations:['Historical as-reported observation; later non-reliance or restatement review is not complete.','Exact historical publication time is unknown. Public availability was observed at capture only.','No validated forecast, current valuation, price feed or investment action.']
  };
  rightsGate(review,'display',ingestedAt);
  const out = {schemaVersion:'1.0',status:'verified',observedAt:ingestedAt,records:[record],blockers:[],automation:{status:'manual-run-only',scheduleConfigured:false}};
  await writeFile(resolve(outputRoot,'evidence/sec-capture-manifest.json'),JSON.stringify({capturedAt:ingestedAt,reviewId:review.reviewId,documents:[{url:SEC_TARGET.indexUrl,...index,bytes:undefined},{url:SEC_TARGET.url,...doc,bytes:undefined}],recordId:record.id},null,2)+'\n');
  await writeFile(resolve(outputRoot,'dist/data/sec-evidence.json'),JSON.stringify(out,null,2)+'\n');
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await runCapture(); console.log(JSON.stringify({status:result.status,records:result.records.length,observedAt:result.observedAt})); }
  catch(error) { console.error(JSON.stringify({status:'blocked',reason:error.message})); process.exitCode=1; }
}
