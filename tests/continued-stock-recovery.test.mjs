import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for(const scenario of ['missing-and-malformed-horizons-recover-with-query','failed-retry-keeps-valid-alternate-horizon','source-catalog-loss-fails-closed-and-retries','unrenderable-data-keeps-a-retry-path'])test(`selected stock readiness: ${scenario}`,()=>{
  const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/continued-stock-scenarios.mjs',import.meta.url)),scenario],{encoding:'utf8',env:process.env,timeout:15000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.equal(JSON.parse(result.stdout.trim()).passed,true);
});
