// Executes the compiled production Worker and checks the response headers the
// public Site depends on: revalidating asset caching and one security policy
// that the shipped HTML, scripts and styles actually satisfy. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import worker from '../dist/server/index.js';
import { publicAssets } from '../worker/generated-assets.js';
import { hostedChartEmbedURL } from '../dist/lib/hosted-chart.js';

const root=new URL('../',import.meta.url),origin='https://worker-headers.invalid';
const sha256=(value,encoding='hex')=>createHash('sha256').update(value).digest(encoding);
const get=(path,init={})=>worker.fetch(new Request(origin+path,init),{});
const assetCache='public, max-age=300, must-revalidate';
const sameOrigin=/^(?:\.{1,2}\/|\/(?!\/))/;
const directives=response=>Object.fromEntries(response.headers.get('content-security-policy').split(';').map(directive=>{const [name,...values]=directive.trim().split(/\s+/);return [name,values];}));
const fixedHeaders={'strict-transport-security':'max-age=31536000','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
function assertSecured(response,label){
  assert.ok(response.headers.get('content-security-policy'),`${label}: policy missing`);
  for(const [name,value] of Object.entries(fixedHeaders))assert.equal(response.headers.get(name),value,`${label}: ${name}`);
}

test('assets carry a strong ETag from their bytes and answer If-None-Match with 304',async()=>{
  const html=await readFile(new URL('dist/index.html',root)),etag=`"${sha256(html)}"`;
  const fresh=await get('/');
  assert.equal(fresh.status,200);assert.equal(fresh.headers.get('etag'),etag);
  assert.equal(fresh.headers.get('cache-control'),assetCache);assert.equal(fresh.headers.get('content-type'),'text/html; charset=utf-8');
  assert.equal(await fresh.text(),html.toString('utf8'));
  for(const header of [etag,`W/${etag}`,`"stale", ${etag}`,'*']){
    const cached=await get('/',{headers:{'If-None-Match':header}});
    assert.equal(cached.status,304,header);assert.equal(await cached.text(),'',header);
    assert.equal(cached.headers.get('etag'),etag,header);assert.equal(cached.headers.get('cache-control'),assetCache,header);
    assertSecured(cached,header);
  }
  const changed=await get('/',{headers:{'If-None-Match':'"0000"'}});
  assert.equal(changed.status,200);assert.equal(await changed.text(),html.toString('utf8'));
  const head=await get('/',{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(head.headers.get('etag'),etag);assert.equal(await head.text(),'');
  assert.equal((await get('/',{method:'HEAD',headers:{'If-None-Match':etag}})).status,304);
  const robots=await get('/robots.txt');
  assert.equal(robots.status,200);assert.equal(robots.headers.get('content-type'),'text/plain; charset=utf-8');
  assert.equal(robots.headers.get('etag'),`"${sha256(await readFile(new URL('dist/robots.txt',root)))}"`);
  assert.notEqual(robots.headers.get('etag'),etag);
});

test('every response carries the security headers while API responses stay private and uncached',async()=>{
  const responses={index:await get('/'),missing:await get('/missing'),method:await get('/',{method:'POST'}),journal:await get('/api/journal'),setup:await get('/api/market-data/setup')};
  for(const [label,response] of Object.entries(responses))assertSecured(response,label);
  assert.equal(responses.missing.status,404);assert.equal(responses.method.status,405);assert.equal(responses.journal.status,401);
  for(const label of ['journal','setup']){
    assert.equal(responses[label].headers.get('cache-control'),'private, no-store',label);
    assert.equal(responses[label].headers.get('etag'),null,label);
  }
  for(const label of ['missing','method'])assert.equal(responses[label].headers.get('etag'),null,label);
  const policies=new Set(Object.values(responses).map(response=>response.headers.get('content-security-policy')));
  assert.equal(policies.size,1,'One policy applies to every response');
});

test('the content security policy is exactly what the served pages, scripts and styles need',async()=>{
  const policy=directives(await get('/'));
  assert.deepEqual(policy['default-src'],["'none'"]);
  assert.deepEqual(policy['script-src'],["'self'"]);
  assert.deepEqual(policy['connect-src'],["'self'"]);
  assert.deepEqual(policy['img-src'],["'self'"]);
  assert.deepEqual(policy['base-uri'],["'none'"]);
  assert.deepEqual(policy['form-action'],["'self'"]);
  assert.deepEqual(policy['frame-ancestors'],["'self'",'https://chatgpt.com','https://*.chatgpt.com','https://*.openai.com']);
  assert.deepEqual(policy['frame-src'],[new URL(hostedChartEmbedURL('SPY')).origin],'Only the hosted chart origin may be framed');
  assert.equal(policy['style-src'][0],"'self'");
  const admitted=policy['style-src'].slice(1),shipped=new Set();
  for(const [path,asset] of Object.entries(publicAssets)){
    if(asset.type.startsWith('text/html')){
      for(const [tag] of asset.body.matchAll(/<[a-z][^>]*>/gi)){
        assert.doesNotMatch(tag,/\son[a-z]+\s*=/i,`${path}: inline event handler ${tag}`);
        assert.doesNotMatch(tag,/\sstyle\s*=/i,`${path}: inline style attribute ${tag}`);
        assert.doesNotMatch(tag,/^<base\b/i,`${path}: base element`);
        assert.doesNotMatch(tag,/^<form\b[^>]*\saction\s*=/i,`${path}: form action`);
      }
      for(const [,attributes,content] of asset.body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
        assert.equal(content.trim(),'',`${path}: inline script`);
        assert.match(attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/)?.[1]??'',sameOrigin,`${path}: script source`);
      }
      for(const [,style] of asset.body.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)){
        const hash=`'sha256-${sha256(style,'base64')}'`;shipped.add(hash);
        assert.ok(admitted.includes(hash),`${path}: inline style block is not admitted`);
      }
      for(const [,,url] of asset.body.matchAll(/<(link|img|iframe|source|video|audio|object|embed)\b[^>]*\b(?:src|href|data)\s*=\s*["']([^"']+)["']/gi))assert.match(url,sameOrigin,`${path}: resource ${url}`);
    }else if(asset.type.startsWith('text/javascript')){
      for(const [call,target] of asset.body.matchAll(/\bfetch\(\s*([^,)]+)/g)){
        const literal=target.trim().match(/^(['"`])(.*)\1$/);
        assert.ok(literal&&sameOrigin.test(literal[2]),`${path}: fetch must name a same-origin path: ${call}`);
      }
      for(const [,specifier] of asset.body.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g))if(specifier!==undefined)assert.match(specifier,sameOrigin,`${path}: module ${specifier}`);
      assert.doesNotMatch(asset.body,/\beval\(|new Function\(|importScripts\(|new (?:Shared)?Worker\(|new (?:EventSource|WebSocket)\(|sendBeacon\(|\.srcdoc\s*=|['"]srcdoc['"]|setAttribute\(\s*['"]style['"]|\sstyle=["']/,`${path}: construct the policy would block`);
    }else if(asset.type.startsWith('text/css')){
      assert.doesNotMatch(asset.body,/@import|@font-face/,`${path}: external style or font`);
      for(const [,url] of asset.body.matchAll(/url\(\s*["']?([^"')]+)/g))assert.match(url,sameOrigin,`${path}: ${url}`);
    }
  }
  assert.deepEqual([...admitted].sort(),[...shipped].sort(),'Every admitted style hash belongs to a shipped block');
});

test('the static preview refuses hidden files and the server bundle like the Worker build does',async t=>{
  for(const path of ['dist/.openai/hosting.json','dist/server/index.js'])await readFile(new URL(path,root));
  const child=spawn(process.execPath,[fileURLToPath(new URL('scripts/serve.mjs',root))],{env:{...process.env,CRIBSCORE_PORT:'0'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{
    let output='';child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});
    child.on('exit',code=>reject(Error(`preview exited with ${code}`)));
    setTimeout(()=>reject(Error('preview did not start')),10_000).unref();
  });
  const request=async path=>{const response=await fetch(base+path);await response.arrayBuffer();return response;};
  const index=await request('/');
  assert.equal(index.status,200);assert.equal(index.headers.get('content-type'),'text/html; charset=utf-8');
  assert.equal((await request('/robots.txt')).headers.get('content-type'),'text/plain; charset=utf-8');
  for(const path of ['/.openai/hosting.json','/server/index.js','/server/','/data/../.openai/hosting.json','/..%2fpackage.json','/lib/../../package.json'])assert.equal((await request(path)).status,404,path);
});
