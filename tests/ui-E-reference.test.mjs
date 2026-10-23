import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const scenarios=['sources-lede-states-the-expired-permission','rights-that-end-mid-session-are-explained-from-the-record','two-facts-from-one-filing-have-distinct-opener-names','registry-groups-and-visible-field-search','rail-keeps-pinned-pairs-and-the-timing-dialog','library-cards-without-topic-chips','method-leads-with-its-status','unknown-counts-and-failed-files-show-words'];
for(const scenario of scenarios)test(`reference pages: ${scenario}`,()=>{
  const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/ui-E-scenarios.mjs',import.meta.url)),scenario],{encoding:'utf8',env:process.env,timeout:15000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.equal(JSON.parse(result.stdout.trim()).passed,true);
});

test('reference-page dialog openers announce a dialog and the E style block keeps the protected tokens untouched',async()=>{
  const [app,css]=await Promise.all([readFile(new URL('../dist/app.js',import.meta.url),'utf8'),readFile(new URL('../dist/style.css',import.meta.url),'utf8')]);
  const openers=app.match(/<button[^>]*data-detail=[^>]*>/g)||[];
  const kinds=openers.map(opener=>opener.match(/data-detail="([a-z-]+?)(?:-?\$\{|")/)?.[1]);
  assert.deepEqual([...new Set(kinds)].sort(),['evidence-state','fact','gates','library','source','source-note','timing'],'every dialog kind has an opener in the views');
  for(const opener of openers)assert.match(opener,/aria-haspopup="dialog"/,opener);
  const start=css.indexOf('/* == area:E reference == */'),end=css.indexOf('/* == end area:E == */');
  assert.ok(start>0&&end>start,'one marked E block');
  const block=css.slice(start,end);
  assert.doesNotMatch(block,/--(?:ink|muted|paper|white)\s*:/,'no protected token is declared');
  assert.doesNotMatch(block,/(?:^|[},])\s*(?:dialog\s+)?\.detail-copy\s*\{/,'no rule targets exactly .detail-copy');
  assert.doesNotMatch(block,/\.record-code[^{]*\{[^}]*(?:^|;)\s*(?:color|background)\s*:/,'no colour or background on .record-code');
});
