import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournal,enrollPublication,validateJournal,projectJournal} from '../dist/lib/journal.js';
import {renderJournalView} from '../dist/lib/journal-view.js';

test('malformed retained source references cannot hide a valid saved decision',async()=>{
  const at='2026-10-17T20:00:00Z';
  const payload={schema_version:'synthetic-source-view',policy_version:'synthetic-policy',generated_at:at,horizon:{id:'next_day',entry_at:'2026-10-19T13:30:00Z',exit_at:'2026-10-19T20:00:00Z'},rows:[{ticker:'AAA',company:'Synthetic source-view fixture',sources:[null,0,true,'not-a-reference',[],{}, {url:'javascript:alert(1)',label:'Unsafe link'}, {url:'https://example.invalid/source',label:null},{url:'https://example.invalid/other',label:'<script>untrusted label</script>'}]}]};
  const payloadBytes=JSON.stringify(payload),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payloadBytes));
  const publication={publicationId:'synthetic-source-publication',publishedAt:at,payloadBytes,payloadHash:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join(''),policyVersion:payload.policy_version,snapshotVersion:payload.schema_version,horizonId:'next_day',entities:[{symbol:'AAA',entityId:'synthetic-AAA'}]};
  const enrolled=await enrollPublication(createJournal({journalId:'synthetic-source-view',at}),{id:'synthetic-enrollment',at,publication});assert.equal(enrolled.ok,true);assert.equal((await validateJournal(enrolled.journal)).ok,true);
  const before=JSON.stringify(enrolled.journal),model=projectJournal(enrolled.journal),modelBefore=JSON.stringify(model);
  const html=renderJournalView(model);assert.match(html,/Synthetic source-view fixture/);assert.match(html,/Saved decision context/);assert.match(html,/Source link unavailable/);assert.match(html,/href="https:\/\/example.invalid\/source"[^>]*>Source link</);assert.match(html,/&lt;script&gt;untrusted label&lt;\/script&gt;/);assert.doesNotMatch(html,/href="javascript:|<script>/);
  assert.equal(JSON.stringify(model),modelBefore);assert.equal(JSON.stringify(enrolled.journal),before);
});
