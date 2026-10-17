import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for(const scenario of ['shifted-offset-window-retains-precise-utc','missing-selected-window-never-borrows-dates','pending-window-updates-open-dialog'])test(`retained timing runtime: ${scenario}`,()=>{
  const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/retained-timing-scenarios.mjs',import.meta.url)),scenario],{encoding:'utf8',env:process.env,timeout:15000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.equal(JSON.parse(result.stdout.trim()).passed,true);
});
