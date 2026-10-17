import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchTiingoEod,inspectFeedAuthorization,TIINGO_TERMS,TIINGO_TERMS_VERSION} from './tiingo-eod.mjs';

// Every value is synthetic. These fixtures are not production approval or entitlement evidence.
const at='2026-10-17T01:15:00Z', expiresAt='2026-10-18T00:00:00Z';
const output={schemaVersion:'SYNTHETIC-SCHEMA-1',methodVersion:'SYNTHETIC-METHOD-1',serialized:JSON.stringify({items:[{id:'SYNTHETIC',classification:'watch'}]})};
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const review=()=>({
  provider:'tiingo',dataset:'eod',plan:'power',approved:true,reviewedAt:at,expiresAt,
  operations:['fetch','persist_source','persist_derived','display_derived'],reviewId:'SYNTHETIC-APPROVAL',
  termsURL:TIINGO_TERMS,termsVersion:TIINGO_TERMS_VERSION,supplementalTermsReviewed:true,
  entitlement:{active:true,verifiedAt:at,expiresAt,evidenceId:'SYNTHETIC-ENTITLEMENT'},
  sourceRetention:{mode:'delete_on_entitlement_end',cleanupVerifiedAt:at,evidenceId:'SYNTHETIC-CLEANUP-TEST'},
  derivedOutputReview:{approved:true,reviewId:'SYNTHETIC-OUTPUT-REVIEW',reviewedAt:at,expiresAt,
    audience:'owner_private',sourceDataAbsent:true,nonSubstitutive:true,nonReconstructible:true,
    schemaVersion:output.schemaVersion,methodVersion:output.methodVersion,sha256:hash(output.serialized)}
});
const inspect=(authorization,operation='fetch',changes={})=>inspectFeedAuthorization(authorization,{at,operation,output,...changes});
const request={ticker:'TEST',securityId:'SYNTHETIC-ID',startDate:'2026-10-01',endDate:'2026-10-16',token:'SYNTHETIC-NOT-A-SECRET',at,clock:()=>at};
const bar={date:'2026-10-16T00:00:00.000Z',open:100,high:103,low:98,close:102,volume:1000000,adjOpen:100,adjHigh:103,adjLow:98,adjClose:102,adjVolume:1000000,divCash:0,splitFactor:1};

test('raw display, generic persistence and unknown operations remain denied even if listed',()=>{
  for(const operation of ['display_raw','display_source','persist','anything','']){
    const auth=review();auth.operations.push(operation);
    assert.deepEqual(inspect(auth,operation).reasons,['operation_not_supported']);
    assert.equal(inspect(auth).ok,false,'invalid operation lists cannot be reused for fetch');
  }
});
test('only the reviewed Power terms profile can fetch',async()=>{
  const changes=[{plan:'starter'},{plan:'trial'},{plan:'paid'},{plan:'Power'},{plan:'enterprise'},
    {termsVersion:'SYNTHETIC'},{termsVersion:'2026-10-05'},{termsURL:'https://app.tiingo.com/tos'},
    {supplementalTermsReviewed:false},{entitlement:null}];
  let calls=0;
  for(const change of changes){
    const result=await fetchTiingoEod({...request,authorization:{...review(),...change},fetchImpl:async()=>{calls++;}});
    assert.equal(result.ok,false,JSON.stringify(change));
  }
  assert.equal(calls,0);
});
test('active entitlement needs current verification and evidence before every operation',()=>{
  const updates=[{active:false},{evidenceId:''},{verifiedAt:'2026-10-17T01:15:01Z'},
    {expiresAt:at},{verifiedAt:'2026-02-30T00:00:00Z'},{expiresAt:'2026-13-01T00:00:00Z'}];
  for(const update of updates)for(const operation of review().operations){
    const auth=review();Object.assign(auth.entitlement,update);
    assert.deepEqual(inspect(auth,operation).reasons,['power_entitlement_required']);
  }
});
test('entitlement expiry during a fetch discards the result',async()=>{
  const auth=review();auth.entitlement.expiresAt='2026-10-17T01:15:01Z';
  let calls=0,ticks=0;
  const result=await fetchTiingoEod({...request,authorization:auth,clock:()=>ticks++?auth.entitlement.expiresAt:at,
    fetchImpl:async()=>{calls++;return new Response(JSON.stringify([bar]),{headers:{'content-type':'application/json'}});}});
  assert.equal(calls,1);assert.equal(result.data,null);
  assert.deepEqual(result.reasons,['power_entitlement_required']);
});
test('source persistence is independently denied without a current cleanup attestation',()=>{
  const updates=[undefined,{mode:'forever',cleanupVerifiedAt:at,evidenceId:'SYNTHETIC'},
    {mode:'delete_on_entitlement_end',cleanupVerifiedAt:at,evidenceId:''},
    {mode:'delete_on_entitlement_end',cleanupVerifiedAt:'2026-10-17T01:15:01Z',evidenceId:'SYNTHETIC'}];
  for(const sourceRetention of updates){
    const auth={...review(),sourceRetention};
    assert.equal(inspect(auth).ok,true,'fetch does not imply source persistence');
    assert.deepEqual(inspect(auth,'persist_source').reasons,['source_retention_review_required']);
  }
  assert.equal(inspect(review(),'persist_source').ok,true);
});
test('a paid subscription and source retention approval grant no derived display or storage rights',()=>{
  const auth=review();delete auth.derivedOutputReview;
  assert.equal(inspect(auth,'persist_source').ok,true);
  for(const operation of ['persist_derived','display_derived']){
    assert.deepEqual(inspect(auth,operation).reasons,['derived_output_review_required']);
  }
});
test('derived output review requires all policy findings and the owner-private audience',()=>{
  const changes=[{approved:false},{reviewId:''},{audience:'public'},{sourceDataAbsent:false},
    {nonSubstitutive:false},{nonReconstructible:false},{reviewedAt:'2026-10-17T01:15:01Z'},{expiresAt:at}];
  for(const change of changes)for(const operation of ['persist_derived','display_derived']){
    const auth=review();Object.assign(auth.derivedOutputReview,change);
    assert.deepEqual(inspect(auth,operation).reasons,['derived_output_review_required']);
  }
});
test('derived review binds exact serialized bytes, schema and method',()=>{
  for(const operation of ['persist_derived','display_derived']){
    assert.equal(inspect(review(),operation).ok,true);
    assert.deepEqual(inspect(review(),operation,{output:{...output,serialized:output.serialized+' '}}).reasons,['derived_output_changed']);
    assert.deepEqual(inspect(review(),operation,{output:{...output,serialized:JSON.stringify({close:102})}}).reasons,['derived_output_changed']);
    for(const change of [{schemaVersion:'changed'},{methodVersion:'changed'},{serialized:''}]){
      assert.deepEqual(inspect(review(),operation,{output:{...output,...change}}).reasons,['derived_output_binding_invalid']);
    }
    assert.deepEqual(inspect(review(),operation,{output:undefined}).reasons,['derived_output_binding_invalid']);
  }
});
test('revoked operation and expired output review cannot reuse a valid content hash',()=>{
  const auth=review();auth.operations=['fetch'];
  assert.deepEqual(inspect(auth,'display_derived').reasons,['operation_not_authorized']);
  const expired=review();expired.derivedOutputReview.expiresAt=at;
  assert.deepEqual(inspect(expired,'persist_derived').reasons,['derived_output_review_required']);
});
