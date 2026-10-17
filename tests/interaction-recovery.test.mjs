import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const scenarios=['loading-and-independent-controls','failure-retry-and-stale-result','module-retry-bypasses-cached-rejection','timeout-is-terminal-until-explicit-retry','disclosures-and-focus-survive-search-and-horizon','hash-popstate-and-search-escape','shortcut-respects-editors-modifiers-and-modal','expired-evidence-and-window-cannot-revive','source-age-boundary-preserves-disclosure','optional-source-view-preserves-default-contract','rejected-journal-submit-keeps-typed-draft','off-view-boundary-keeps-dialog-and-source-focus'];
for(const scenario of scenarios)test(`actual ESM interaction: ${scenario}`,()=>{
  const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/interaction-scenarios.mjs',import.meta.url)),scenario],{encoding:'utf8',env:process.env,timeout:15000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.equal(JSON.parse(result.stdout.trim()).passed,true);
});
