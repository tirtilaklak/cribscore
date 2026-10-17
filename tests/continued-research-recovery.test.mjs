import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for(const scenario of ['malformed-library-is-atomic-and-recovers','malformed-gates-and-layers-remain-navigable','malformed-source-rows-never-partially-commit','unused-fields-and-pending-notes-remain-supported'])test(`research module recovery: ${scenario}`,()=>{
  const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/continued-research-scenarios.mjs',import.meta.url)),scenario],{encoding:'utf8',env:process.env,timeout:15000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.equal(JSON.parse(result.stdout.trim()).passed,true);
});
