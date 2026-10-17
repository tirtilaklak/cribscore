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
for(const asset of manifest.publicAssets){
  assert.equal(digest(await readFile(new URL(asset.path,root))),asset.sha256,`Public source changed after build: ${asset.path}`);
  const response=await worker.fetch(new Request(origin+'/'+asset.path.slice(5)),{});
  assert.equal(response.status,200);assert.equal(createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex'),asset.sha256,asset.path);
}
assert.equal((await worker.fetch(new Request(origin+'/'),{})).status,200);
assert.equal(await(await worker.fetch(new Request(origin+'/',{method:'HEAD'}),{})).text(),'');
for(const path of ['/server/index.js','/.openai/hosting.json','/README.md','/evidence/private.json','/not-found'])assert.equal((await worker.fetch(new Request(origin+path),{})).status,404,path);
assert.equal((await worker.fetch(new Request(origin+'/',{method:'POST'}),{})).status,405);
assert.equal((await worker.fetch(new Request(origin+'/api/journal'),{})).status,401);
assert.equal((await worker.fetch(new Request(origin+'/api/journal',{headers:{'oai-authenticated-user-id':'validation-only'}}),{})).status,503);
console.log(`Worker validated: ${manifest.publicAssets.length} exact public assets, API auth/storage boundaries, and private paths excluded.`);
