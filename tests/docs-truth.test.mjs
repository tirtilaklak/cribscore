// Operating documents must describe the hosting model and manifest as they are.
// The Site is public with owner-only routes; the hosting manifest declares only d1/r2.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('README and operations docs do not describe the Site as private',async()=>{
  for(const path of ['README.md','docs/worker-journal-operations.md','docs/scheduled-journal.md','docs/launch-checklist.md','docs/public-audience.md']){
    assert.doesNotMatch(await read(path),/remains private|existing private Site|private audience/,path);
  }
});

test('scheduled-journal.md agrees with .openai/hosting.json about the mcp capability',async()=>{
  const hosting=JSON.parse(await read('.openai/hosting.json'));
  const doc=await read('docs/scheduled-journal.md');
  assert.equal(doc.includes('does not yet declare the `mcp` capability'),!Object.hasOwn(hosting,'mcp'));
  assert.doesNotMatch(doc,/declares\nits hosting capability|declares its hosting capability/);
});
