import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {serializeResearchSlate,preparePublicCase,prepareSlateMetadata,SLATE_SCHEMA,SUPPORTED_SCORE_POLICY} from '../server/research-slate/research-slate.mjs';
import {inspectFeedAuthorization,TIINGO_TERMS,TIINGO_TERMS_VERSION} from '../server/market-data/tiingo-eod.mjs';

// Explicit synthetic chronology; presentation review legitimately follows cutoff.
const at='2026-10-17T01:15:00Z',cutoff='2026-10-17T01:00:00Z',expires='2026-10-24T00:00:00Z';
const assessedAt='2026-10-17T01:05:00.123Z',metadataReviewedAt='2026-10-17T01:10:00.234Z',copyReviewedAt='2026-10-17T01:12:00.345Z';
const window={horizon_id:'next_week',entry_at:'2026-10-19T13:30:00Z',exit_at:'2026-10-23T20:00:00Z'};
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
function bindCase(value,w=window,cut=cutoff){
  const prepared=preparePublicCase(value);assert.equal(prepared.ok,true);
  value.public_review={state:'reviewed',audience:'owner_private',review_id:'SYNTHETIC-CASE-REVIEW',security_id:value.security_id,
    ...w,source_cutoff_at:cut,reviewed_at:copyReviewedAt,expires_at:expires,content_sha256:prepared.sha256};
  return value;
}
function bindMetadata(input){
  const prepared=prepareSlateMetadata(input.slateMetadata);assert.equal(prepared.ok,true);
  input.slateMetadata.review={state:'reviewed',audience:'owner_private',review_id:'SYNTHETIC-METADATA-REVIEW',
    ...input.window,source_cutoff_at:input.sourceCutoffAt,reviewed_at:metadataReviewedAt,expires_at:expires,content_sha256:prepared.sha256};
  return input;
}
function fixture(scores=[75,50]){
  const ids=scores.map((_,i)=>'SYNTHETIC-'+i),tickers=['AAA','BBB','CCC','DDD','EEE','FFF','GGG','HHH','III','JJJ'];
  return bindMetadata({at,sourceCutoffAt:cutoff,window:{...window},displayExpiresAt:'2026-10-18T00:00:00Z',
    assessmentContext:{universe_version:'SYNTHETIC-US-v2',assessed_at:assessedAt,price_session:{date:'2026-10-16',closed_at:'2026-10-16T20:00:00Z'}},
    slateMetadata:{universe_version:'SYNTHETIC-US-v2',counts:{roster:24,screened:scores.length+2,blocked:2,eligible:scores.length},
      price_session:{date:'2026-10-16',closed_at:'2026-10-16T20:00:00Z'},
      source_health:{state:'partial_at_cutoff',label:'Synthetic assessment covers a reviewed subset; other sources remain incomplete.'}},
    displayBounds:{authorization_expires_at:expires,entitlement_expires_at:expires,derived_review_expires_at:expires,score_review_expires_at:expires},
    scorerResult:{policy_version:SUPPORTED_SCORE_POLICY,audience:'owner_private',ranking_basis:'reviewed_research_evidence',predictive_status:'unvalidated',limit:10,
      eligible_count:scores.length,withheld:[{security_id:'SYNTHETIC-BLOCKED-A',status:'withheld'},{security_id:'SYNTHETIC-BLOCKED-B',status:'withheld'}],rows:scores.map((score,i)=>({security_id:ids[i],policy_version:SUPPORTED_SCORE_POLICY,audience:'owner_private',status:'scored',
        predictive_status:'unvalidated',expected_return:null,gain_probability:null,score,components:{fundamentals:2,catalyst:1,price_action:2,macro:1},
        ...window,source_cutoff_at:cutoff,research_rank:scores.indexOf(score)+1,display_order:i+1,tied_priority:scores.filter(x=>x===score).length>1}))},
    publicCases:ids.map((id,i)=>bindCase({security_id:id,ticker:tickers[i],company:'Synthetic Company '+i,
      thesis:'Operating improvement could support the case if the next report confirms it.',downside:'A weaker report would invalidate the operating case.',invalidation_trigger:'Withdraw if the next report cuts annual operating guidance.',
      catalyst:{label:'Synthetic earnings report',kind:'scheduled_event',timing:{precision:'exact',at:'2026-10-20T20:45:00Z'},source_url:'https://investors.example.com/reports/'+i},
      sources:[{label:'Company report',url:'https://investors.example.com/reports/'+i}]}))});
}
const parsed=value=>JSON.parse(serializeResearchSlate(value).serialized);

test('compact slate contains exact dates, coarse score and public evidence under mandatory review labels',()=>{
  const input=fixture(),result=serializeResearchSlate(input),p=JSON.parse(result.serialized);
  assert.equal(result.ok,true);assert.equal(result.status,'review_required');assert.equal(result.schemaVersion,SLATE_SCHEMA);
  assert.equal(result.methodVersion,SUPPORTED_SCORE_POLICY);assert.equal(p.audience,'owner_private');
  assert.equal(Object.hasOwn(p,'publication_status'),false);assert.equal(p.predictive_status,'unvalidated');assert.match(p.label,/Unvalidated research/);
  assert.equal(p.display_expires_at,input.displayExpiresAt);
  assert.deepEqual(p.horizon,{id:window.horizon_id,entry_at:window.entry_at,exit_at:window.exit_at});assert.equal(p.source_cutoff_at,cutoff);
  assert.equal(p.rows.length,2);assert.equal(p.rows[0].research_score,75);assert.equal(p.rows[0].research_rank,1);
  assert.deepEqual(p.metadata.counts,{roster:24,screened:4,blocked:2,eligible:2});assert.equal(p.rows[0].tied_priority,false);
  assert.ok(Date.parse(cutoff)<Date.parse(assessedAt)&&Date.parse(assessedAt)<Date.parse(metadataReviewedAt)&&Date.parse(metadataReviewedAt)<Date.parse(copyReviewedAt)&&Date.parse(copyReviewedAt)<Date.parse(at));
  assert.equal(p.rows[0].catalyst.timing.at,'2026-10-20T20:45:00Z');assert.equal(p.rows[0].catalyst.window_position,'in_window');
  assert.deepEqual(p.rows[0].sources,input.publicCases[0].sources);
});
test('unknown fields and deeply nested raw/private sentinels have no serialized output path',()=>{
  const input=fixture(),secret='SENSITIVE_SENTINEL_NEVER_COPY';
  const extras={raw:{close:secret},adjusted:{volume:secret},actions:{dividend:secret},returns:secret,probabilities:secret,
    private_holdings:[secret],entitlement:{token:secret},token:secret,sourcehash:secret,nested:{more:{token:secret}}};
  Object.assign(input.scorerResult,extras);Object.assign(input.scorerResult.rows[0],extras);Object.assign(input.window,extras);
  for(const c of input.publicCases){Object.assign(c,extras);Object.assign(c.catalyst,extras);Object.assign(c.sources[0],extras);Object.assign(c.public_review,extras);}
  const result=serializeResearchSlate(input);assert.equal(result.ok,true);assert.equal(JSON.parse(result.serialized).rows.length,2);
  assert.ok(!result.serialized.includes(secret));
  for(const field of ['raw','adjusted','actions','returns','probabilities','private_holdings','entitlement','token','sourcehash','content_sha256','expected_return','gain_probability','components','security_id']){
    assert.ok(!result.serialized.includes('"'+field+'"'),field);
  }
});
test('prototype keys and ignored getters do not leak, execute or pollute output',()=>{
  const input=fixture(),secret='PROTOTYPE_SECRET';let calls=0;
  const extra=JSON.parse('{"__proto__":{"token":"PROTOTYPE_SECRET"},"constructor":{"prototype":{"token":"PROTOTYPE_SECRET"}}}');
  for(const target of [input.scorerResult,input.scorerResult.rows[0],input.publicCases[0],input.publicCases[0].sources[0]]){
    for(const key of Object.keys(extra))Object.defineProperty(target,key,{value:extra[key],enumerable:true});
    Object.defineProperty(target,'ignored_secret',{get(){calls++;return secret;},enumerable:true});
  }
  const result=serializeResearchSlate(input);assert.equal(result.ok,true);assert.ok(!result.serialized.includes(secret));assert.equal(calls,0);
  assert.equal(Object.prototype.token,undefined);assert.ok(!result.serialized.includes('__proto__'));
});
test('inherited public fields cannot satisfy a reviewed case',()=>{
  const input=fixture();input.publicCases[0]=Object.create(input.publicCases[0]);
  const result=serializeResearchSlate(input);assert.equal(JSON.parse(result.serialized).rows.length,1);
  assert.equal(result.withheld[0].reason,'public_case_missing_or_duplicate');
});
test('missing or duplicate case identity withholds affected rows without filling five',()=>{
  const missing=fixture();missing.publicCases.shift();
  const a=parsed(missing);assert.equal(a.rows.length,1);assert.equal(a.rows[0].research_rank,2);assert.equal(a.withheld_count,1);
  const duplicate=fixture();duplicate.publicCases.push(structuredClone(duplicate.publicCases[0]));
  const b=parsed(duplicate);assert.equal(b.rows.length,1);assert.equal(b.rows[0].ticker,'BBB');
  const empty=fixture();empty.publicCases=[];assert.deepEqual(parsed(empty).rows,[]);
});
test('duplicate scorer security IDs and duplicate public tickers are withheld',()=>{
  const duplicate=fixture();duplicate.scorerResult.rows[1].security_id=duplicate.scorerResult.rows[0].security_id;
  assert.equal(parsed(duplicate).rows.length,0);
  const ticker=fixture();ticker.publicCases[1].ticker='AAA';bindCase(ticker.publicCases[1]);
  assert.equal(parsed(ticker).rows.length,0);
});
test('changed prose, source, identity, expired or future public reviews cannot reuse approval',()=>{
  const later=fixture();later.publicCases[0].public_review.reviewed_at=at;assert.equal(parsed(later).rows.length,2,'copy review after source cutoff is legitimate through serializer time');
  for(const edit of [c=>c.thesis='Changed after review',c=>c.sources[0].label='Changed after review',c=>c.public_review.security_id='OTHER',
    c=>c.public_review.expires_at=at,c=>c.public_review.audience='public',c=>c.public_review.entry_at='2026-10-20T13:30:00Z',
    c=>c.public_review.reviewed_at='2026-10-17T01:15:00.001Z',c=>delete c.public_review]){
    const input=fixture();edit(input.publicCases[0]);assert.equal(parsed(input).rows.length,1);
  }
});
test('token-bearing URLs, credentials, fragments, non-HTTPS and local addresses withhold a case',()=>{
  const urls=['https://investors.example.com/report?token=TOP_SECRET','https://investors.example.com/report?api_key=TOP_SECRET',
    'https://TOP_SECRET@investors.example.com/report','https://investors.example.com/report#token=TOP_SECRET',
    'https://investors.example.com/token/TOP_SECRET','https://investors.example.com/%74oken/TOP_SECRET',
    'javascript:alert(1)','http://investors.example.com/report','https://127.0.0.1/report','https://0x7f000001/report','https://private.local/report'];
  for(const url of urls){
    const input=fixture();input.publicCases[0].sources[0].url=url;input.publicCases[0].catalyst.source_url=url;
    const result=serializeResearchSlate(input);assert.equal(JSON.parse(result.serialized).rows.length,1,url);assert.ok(!result.serialized.includes('TOP_SECRET'));
  }
});
test('case projection requires direct, distinct evidence and a dated catalyst linked to it',()=>{
  for(const edit of [c=>c.sources=[],c=>c.sources.push(structuredClone(c.sources[0])),c=>c.catalyst.timing.at='2026-02-30T00:00:00Z',
    c=>c.catalyst.source_url='https://investors.example.com/other',c=>c.company='<script>bad</script>']){
    const input=fixture();edit(input.publicCases[0]);assert.equal(parsed(input).rows.length,1);
  }
});
test('a dated catalyst outside the horizon is labeled without inventing in-window timing',()=>{
  const input=fixture();input.publicCases[0].catalyst.timing.at='2026-10-16T20:00:00Z';bindCase(input.publicCases[0]);
  input.publicCases[1].catalyst.timing.at='2026-10-26T20:00:00Z';bindCase(input.publicCases[1]);
  assert.deepEqual(parsed(input).rows.map(x=>x.catalyst.window_position),['before_window','after_window']);
});
test('policy, audience, horizon, forecast and row ranking mismatches fail closed',()=>{
  for(const edit of [r=>r.audience='public',r=>r.policy_version='future',r=>r.expected_return=0.05,r=>r.gain_probability=0.8,
    r=>r.predictive_status='validated',r=>r.horizon_id='next_day',r=>r.source_cutoff_at=at,r=>r.research_rank=9,r=>r.display_order=2,r=>r.status='withheld']){
    const input=fixture();edit(input.scorerResult.rows[0]);assert.equal(parsed(input).rows.length,1);
  }
  for(const change of [{audience:'public'},{policy_version:'future'},{predictive_status:'validated'}]){
    const input=fixture();Object.assign(input.scorerResult,change);assert.equal(serializeResearchSlate(input).ok,false);
  }
});
test('invalid coarse scores, order, clock and date values cannot produce a slate',()=>{
  for(const value of [NaN,Infinity,-1,101,74,undefined]){
    const input=fixture();input.scorerResult.rows[0].score=value;assert.equal(serializeResearchSlate(input).ok,false);
  }
  const ordered=fixture([50,75]);assert.equal(serializeResearchSlate(ordered).ok,false);
  for(const change of [{at:window.entry_at},{at:'2026-02-30T00:00:00Z'},{sourceCutoffAt:'2026-10-18T00:00:00Z'},
    {window:{...window,horizon_id:'month'}},{window:{...window,exit_at:window.entry_at}}]){
    assert.equal(serializeResearchSlate({...fixture(),...change}).ok,false);
  }
});
test('ties retain competition rank and a next-day window is preserved exactly',()=>{
  const input=fixture([75,75,50]);assert.deepEqual(parsed(input).rows.map(x=>x.research_rank),[1,1,3]);assert.deepEqual(parsed(input).rows.map(x=>x.tied_priority),[true,true,false]);
  const day={horizon_id:'next_day',entry_at:window.entry_at,exit_at:'2026-10-19T20:00:00Z'};
  input.window=day;for(const row of input.scorerResult.rows)Object.assign(row,day);
  for(const c of input.publicCases)bindCase(c,day);bindMetadata(input);
  assert.deepEqual(parsed(input).horizon,{id:'next_day',entry_at:day.entry_at,exit_at:day.exit_at});
});
test('serialization is deterministic, does not mutate inputs and handles a legitimate empty slate',()=>{
  const input=fixture(),before=structuredClone(input),first=serializeResearchSlate(input);
  assert.equal(serializeResearchSlate(input).serialized,first.serialized);assert.deepEqual(input,before);
  const empty=fixture([]),result=serializeResearchSlate(empty);assert.equal(result.ok,true);assert.deepEqual(JSON.parse(result.serialized).rows,[]);
});
test('fractional UTC job, cutoff, horizon and catalyst clocks retain exact strings',()=>{
  const input=fixture();input.at='2026-10-17T01:15:00.123Z';input.sourceCutoffAt='2026-10-17T01:00:00.12Z';
  input.window={...window,entry_at:'2026-10-19T13:30:00.1Z',exit_at:'2026-10-23T20:00:00.001Z'};
  for(const row of input.scorerResult.rows)Object.assign(row,input.window,{source_cutoff_at:input.sourceCutoffAt});
  for(const c of input.publicCases){c.catalyst.timing.at='2026-10-20T20:45:00.120Z';bindCase(c,input.window,input.sourceCutoffAt);}
  bindMetadata(input);
  const p=parsed(input);assert.equal(p.rows.length,2);assert.equal(p.generated_at,input.at);assert.equal(p.source_cutoff_at,input.sourceCutoffAt);
  assert.equal(p.horizon.entry_at,input.window.entry_at);assert.equal(p.horizon.exit_at,input.window.exit_at);assert.equal(p.rows[0].catalyst.timing.at,'2026-10-20T20:45:00.120Z');
  input.scorerResult.rows[0].entry_at='2026-10-19T13:30:00.100Z';
  assert.equal(parsed(input).rows.length,1,'equivalent timestamps do not bypass exact-string bindings');
  for(const invalid of ['2026-02-30T01:15:00.123Z','2026-10-17T01:15:00.1234Z','2026-10-17T01:15:00.123+00:00']){
    assert.equal(serializeResearchSlate({...input,at:invalid}).ok,false);
  }
});
test('unknown fields and extra cases cannot change scores, while mismatched full eligible counts reject',()=>{
  const input=fixture(),before=serializeResearchSlate(input).serialized;
  input.scorerResult.rows[0].components.unsupported=100000;
  input.scorerResult.rows[0].component_count=99;input.scorerResult.case_count=999;
  input.publicCases.push(fixture([75,50,25]).publicCases[2]);
  assert.equal(serializeResearchSlate(input).serialized,before);
  assert.equal(parsed(input).rows.length,2);assert.equal(parsed(input).rows[0].research_score,75);
  input.scorerResult.eligible_count=999;assert.equal(serializeResearchSlate(input).ok,false,'full eligible count is part of the v2 assessment contract');
});
test('display expiry requires every explicit deadline and never invents or rounds a minimum',()=>{
  const input=fixture();input.displayExpiresAt='2026-10-17T02:00:00.001Z';
  input.displayBounds.derived_review_expires_at=input.displayExpiresAt;
  assert.equal(parsed(input).display_expires_at,input.displayExpiresAt);
  for(const key of Object.keys(input.displayBounds)){
    const missing=structuredClone(input);delete missing.displayBounds[key];assert.equal(serializeResearchSlate(missing).ok,false,key);
    const earlier=structuredClone(input);earlier.displayBounds[key]='2026-10-17T02:00:00Z';assert.equal(serializeResearchSlate(earlier).ok,false,key);
  }
  for(const displayExpiresAt of [undefined,at,'2026-10-24T00:00:00Z','2026-02-30T00:00:00.001Z']){
    assert.equal(serializeResearchSlate({...fixture(),displayExpiresAt}).ok,false);
  }
  const noBounds=fixture();delete noBounds.displayBounds;assert.equal(serializeResearchSlate(noBounds).ok,false);
});
test('holding-window exit and each admitted public-case review constrain display life',()=>{
  const input=fixture();input.displayExpiresAt=window.exit_at;assert.equal(parsed(input).rows.length,2);
  input.displayExpiresAt='2026-10-23T20:00:00.001Z';assert.equal(serializeResearchSlate(input).ok,false);
  const shortCase=fixture();shortCase.publicCases[0].public_review.expires_at='2026-10-17T02:00:00Z';
  const p=parsed(shortCase);assert.equal(p.rows.length,1);assert.equal(p.rows[0].ticker,'BBB');assert.equal(p.display_expires_at,shortCase.displayExpiresAt);
});
test('exact output binds to the integrated auth helper only after separate synthetic review',()=>{
  const output=serializeResearchSlate(fixture());
  const auth={provider:'tiingo',dataset:'eod',plan:'power',approved:true,reviewedAt:at,expiresAt:expires,
    operations:['display_derived'],reviewId:'SYNTHETIC',termsURL:TIINGO_TERMS,termsVersion:TIINGO_TERMS_VERSION,supplementalTermsReviewed:true,
    entitlement:{active:true,verifiedAt:at,expiresAt:expires,evidenceId:'SYNTHETIC'}};
  assert.equal(inspectFeedAuthorization(auth,{at,operation:'display_derived',output}).ok,false);
  auth.derivedOutputReview={approved:true,reviewId:'SYNTHETIC-ONLY',reviewedAt:at,expiresAt:expires,audience:'owner_private',
    sourceDataAbsent:true,nonSubstitutive:true,nonReconstructible:true,schemaVersion:output.schemaVersion,methodVersion:output.methodVersion,sha256:sha(output.serialized)};
  assert.equal(inspectFeedAuthorization(auth,{at,operation:'display_derived',output}).ok,true);
  assert.equal(inspectFeedAuthorization(auth,{at,operation:'display_derived',output:{...output,serialized:output.serialized+' '}}).ok,false);
  assert.equal(output.status,'review_required','private return envelope never issues approval');
  assert.equal(Object.hasOwn(JSON.parse(output.serialized),'publication_status'),false,'bound publication bytes do not contain a permanently stale draft flag');
});
