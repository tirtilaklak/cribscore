import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import worker from '../dist/server/index.js';

const manifest=JSON.parse(await readFile(new URL('../docs/worker-build-manifest.json',import.meta.url),'utf8'));
const root=new URL('../',import.meta.url);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [path,hash] of Object.entries(manifest.sourceFiles||{}))assert.equal(digest(await readFile(new URL(path,root))),hash,`Source changed after build: ${path}`);
assert.ok(Object.keys(manifest.sourceFiles||{}).length>0,'Build source hashes required');
for(const path of Object.keys(manifest.sourceFiles||{}))assert.doesNotMatch(path,/(^|\/)(tests?|fixtures?)(\/|$)|\.test\.[cm]?js$/,'Test-only source must not enter the production Worker');
const publicPaths=[];async function walk(prefix=''){for(const entry of await readdir(new URL(`dist/${prefix}`,root),{withFileTypes:true})){if(entry.name.startsWith('.')||(!prefix&&entry.name==='server'))continue;const path=prefix+entry.name;if(entry.isDirectory())await walk(path+'/');else publicPaths.push('dist/'+path);}}await walk();
assert.deepEqual(publicPaths.sort(),manifest.publicAssets.map(asset=>asset.path).sort(),'Public asset inventory changed after build');
assert.equal(digest(await readFile(new URL(manifest.bundle.path,root))),manifest.bundle.sha256,'Worker bundle changed after build');
const origin='https://cribscore-test.invalid';
const fetch=(path,init)=>worker.fetch(new Request(origin+path,init),{});
const security={'content-security-policy':/^default-src 'none'; script-src 'self'; style-src 'self'(?: 'sha256-[A-Za-z0-9+/]+=*')*; img-src 'self'; connect-src 'self'; frame-src https:\/\/www\.tradingview-widget\.com; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https:\/\/chatgpt\.com https:\/\/\*\.chatgpt\.com https:\/\/\*\.openai\.com$/,'strict-transport-security':/^max-age=31536000$/,'x-content-type-options':/^nosniff$/,'referrer-policy':/^no-referrer$/};
const assertSecured=(response,label)=>{for(const [name,pattern] of Object.entries(security))assert.match(response.headers.get(name)||'',pattern,`${label}: ${name}`);};
const policy=(await fetch('/')).headers.get('content-security-policy');
for(const asset of manifest.publicAssets){
  const bytes=await readFile(new URL(asset.path,root)),path='/'+asset.path.slice(5),etag=`"${asset.sha256}"`;
  assert.equal(digest(bytes),asset.sha256,`Public source changed after build: ${asset.path}`);
  if(asset.path.endsWith('.html'))for(const [,style] of bytes.toString('utf8').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))assert.ok(policy.includes(`'sha256-${createHash('sha256').update(style).digest('base64')}'`),`Inline style not admitted by the policy: ${asset.path}`);
  const response=await fetch(path);
  assert.equal(response.status,200);assert.equal(createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex'),asset.sha256,asset.path);
  assertSecured(response,asset.path);assert.equal(response.headers.get('etag'),etag,asset.path);assert.equal(response.headers.get('cache-control'),'public, max-age=300, must-revalidate',asset.path);
  const cached=await fetch(path,{headers:{'If-None-Match':etag}});
  assert.equal(cached.status,304,asset.path);assert.equal(await cached.text(),'');assert.equal(cached.headers.get('etag'),etag,asset.path);assertSecured(cached,asset.path);
}
assert.equal((await fetch('/')).status,200);
assert.equal(await(await fetch('/',{method:'HEAD'})).text(),'');
for(const path of ['/server/index.js','/.openai/hosting.json','/README.md','/evidence/private.json','/not-found']){const response=await fetch(path);assert.equal(response.status,404,path);assertSecured(response,path);}
const rejected=await fetch('/',{method:'POST'});assert.equal(rejected.status,405);assertSecured(rejected,'POST /');
const unauthenticated=await fetch('/api/journal');assert.equal(unauthenticated.status,401);assertSecured(unauthenticated,'/api/journal');
assert.equal(unauthenticated.headers.get('cache-control'),'private, no-store');assert.equal(unauthenticated.headers.get('etag'),null);
assert.equal((await fetch('/api/journal',{headers:{'oai-authenticated-user-id':'validation-only'}})).status,503);
console.log(`Worker validated: ${manifest.publicAssets.length} exact public assets with ETags, security headers on every response, API auth/storage boundaries, and private paths excluded.`);
