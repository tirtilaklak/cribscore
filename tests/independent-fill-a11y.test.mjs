// Independent regression using the shared form harness and synthetic records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createFormHarness,at} from './helpers/form-harness.mjs';
const root=resolve(process.env.CRIBSCORE_PROJECT||new URL('..',import.meta.url).pathname);
const J=await import(pathToFileURL(resolve(root,'dist/lib/journal.js')).href);
const harness=await createFormHarness({root});
async function fixture(revise){
 const publishedAt='2026-10-17T16:00:00Z',payload={schema_version:'synthetic-review-v1',policy_version:'synthetic-review-policy',generated_at:publishedAt,horizon:{id:'next_day',entry_at:'2026-10-19T13:30:00Z',exit_at:'2026-10-19T20:00:00Z'},rows:[{ticker:'AAA',company:'Synthetic independent accessibility fixture only'}]};
 const payloadBytes=JSON.stringify(payload),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payloadBytes));
 const publication={publicationId:'synthetic-independent-publication',publishedAt,payloadBytes,payloadHash:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),policyVersion:payload.policy_version,snapshotVersion:payload.schema_version,horizonId:'next_day',entities:[{symbol:'AAA',entityId:'synthetic-AAA'}]};
 const enrolled=await J.enrollPublication(J.createJournal({journalId:'synthetic-independent-fill-a11y',at:publishedAt}),{id:'synthetic-enrollment',at,publication});assert.equal(enrolled.ok,true);
 const intentId=enrolled.journal.events.find(e=>e.kind==='paper_intent').id;
 const confirmed=await J.recordActualConfirmation(enrolled.journal,{id:'synthetic-confirmation',at,intentId,confirmed:true});assert.equal(confirmed.ok,true);
 if(!revise)return confirmed.journal;
 const filled=await J.recordActualFill(confirmed.journal,{id:'synthetic-fill',at,intentId,side:'buy',occurredAt:'2026-10-17T17:00:00Z',quantity:'1',price:'100',fee:'0',currency:'USD'});assert.equal(filled.ok,true);return filled.journal;
}
for(const revise of [false,true])test(`${revise?'revised':'new'} actual-fill rejection identifies its numeric field and focuses the preserved draft`,{concurrency:false},async t=>{
 const h=await harness(t,{initial:await fixture(revise)}),kind=revise?'revise-fill':'save-fill',form=h.query(`[data-journal-form="${kind}"]`);assert.ok(form);form.closest('details').open=true;
 for(const [name,value] of Object.entries({side:'buy',occurredAt:'2026-10-17T17:00',quantity:'abc',price:'100',fee:'0',reason:'Synthetic correction'})){
  const field=form.querySelector(`[name="${name}"]`);if(field){field.value=value;field.dispatch({type:'input',target:field});}
 }
 const quantity=form.querySelector('[name="quantity"]');form.querySelector('button').focus();await h.submit(form);
 const observed={kind,feedback:h.query('.desk-feedback')?.textContent,quantity:quantity.value,invalid:quantity.getAttribute('aria-invalid'),describedby:quantity.getAttribute('aria-describedby'),activeId:h.document.activeElement?.id,activeTag:h.document.activeElement?.tagName,activeName:h.document.activeElement?.getAttribute('name'),draftPreserved:h.query(`[data-journal-form="${kind}"]`)===form,mutationRequests:h.requests.filter(r=>r.method==='POST'&&!r.url.endsWith('/observe')).length};
 console.log(JSON.stringify(observed));if(process.env.CRIBSCORE_QA_FILL_EVIDENCE)await writeFile(resolve(process.env.CRIBSCORE_QA_FILL_EVIDENCE,kind+'.json'),JSON.stringify(observed,null,2));
 assert.equal(observed.mutationRequests,0);assert.equal(observed.draftPreserved,true);assert.equal(observed.quantity,'abc');
 assert.equal(observed.invalid,'true','rejected numeric field must be identified');assert.ok(observed.describedby,'field must reference explanatory text');assert.equal(h.document.activeElement,quantity,'focus must identify first rejected field');
});
const field=(form,name)=>form.querySelector(`[name="${name}"]`);
const edit=(form,name,value)=>{const input=field(form,name);input.value=value;input.dispatch({type:'input',target:input});return input;};
const populate=(form,changes={})=>{for(const [name,value] of Object.entries({side:'buy',occurredAt:'2026-10-17T17:00',quantity:'1',price:'100',fee:'0',...changes}))edit(form,name,value);};
const posts=h=>h.requests.filter(r=>r.method==='POST'&&!r.url.endsWith('/observe'));

test('all invalid correction fields have distinct descriptions, survive navigation, and clear as corrected',{concurrency:false},async t=>{
 const h=await harness(t,{initial:await fixture(true)}),form=h.query('[data-journal-form="revise-fill"]');form.closest('details').open=true;
 populate(form,{occurredAt:'2026-02-30T17:00',quantity:'0',price:'1e2',fee:'-1'});edit(form,'reason','   ');await h.submit(form);
 const names=['occurredAt','quantity','price','fee','reason'],descriptions=[];
 for(const name of names){const input=field(form,name),description=input.getAttribute('aria-describedby');assert.equal(input.getAttribute('aria-invalid'),'true',name);assert.ok(description);assert.ok(h.query(`[id="${description}"]`)?.textContent);descriptions.push(description);const label=h.query(`[id="${input.getAttribute('aria-labelledby')}"]`);assert.ok(label);assert.ok(!label.textContent.includes('Enter '));}
 assert.equal(new Set(descriptions).size,names.length);assert.equal(h.document.activeElement,field(form,'occurredAt'));assert.equal(posts(h).length,0);
 h.state.view='prices';h.render();h.state.view='journal';h.render();assert.equal(h.query('[data-journal-form="revise-fill"]'),form);assert.equal(form.closest('details').open,true);assert.equal(field(form,'price').value,'1e2');assert.equal(field(form,'reason').getAttribute('aria-invalid'),'true');
 for(const [name,value] of Object.entries({occurredAt:'2026-10-17T17:00:00.123',quantity:'2.00000001',price:'101.123456',fee:'0.000001',reason:'Synthetic price and quantity correction'})){edit(form,name,value);assert.equal(field(form,name).getAttribute('aria-invalid'),null,name);assert.equal(field(form,name).getAttribute('aria-describedby'),null,name);}
 await h.submit(form);assert.equal(posts(h).length,1);const correction=h.remote().events.at(-1);assert.equal(correction.kind,'fill_revision');assert.equal(correction.data.replacement.occurredAt,'2026-10-17T17:00:00.123Z');assert.equal(correction.data.replacement.quantity,'2.00000001');assert.equal(correction.data.replacement.price,'101.123456');assert.equal(correction.data.replacement.fee,'0.000001');
});

test('oversell remains a contextual quantity error and preserves the rejected draft across navigation',{concurrency:false},async t=>{
 const h=await harness(t,{initial:await fixture(true)}),form=h.query('[data-journal-form="save-fill"]');form.closest('details').open=true;populate(form,{side:'sell',quantity:'2'});await h.submit(form);
 assert.match(h.query('.desk-feedback').textContent,/oversell/);assert.equal(h.document.activeElement,field(form,'quantity'));assert.equal(field(form,'quantity').getAttribute('aria-invalid'),'true');assert.match(h.query(`[id="${field(form,'quantity').getAttribute('aria-describedby')}"]`).textContent,/exceeds.*shares/);assert.equal(posts(h).length,0);
 h.state.view='prices';h.render();h.state.view='journal';h.render();assert.equal(h.query('[data-journal-form="save-fill"]'),form);assert.equal(field(form,'quantity').value,'2');assert.equal(field(form,'quantity').getAttribute('aria-invalid'),'true');
 edit(form,'quantity','1');await h.submit(form);assert.equal(posts(h).length,1);assert.equal(h.remote().events.filter(e=>e.kind==='actual_fill').length,2);assert.equal(h.remote().events.at(-1).data.fill.side,'sell');
});

test('future and prepublication fills identify the UTC field without saving',{concurrency:false},async t=>{
 const h=await harness(t,{initial:await fixture(false)}),form=h.query('[data-journal-form="save-fill"]');
 for(const occurredAt of ['2026-10-17T15:59','2026-10-17T18:01']){populate(form,{occurredAt});await h.submit(form);assert.match(h.query('.desk-feedback').textContent,/future or prepublication actual fill/);assert.equal(h.document.activeElement,field(form,'occurredAt'));assert.equal(field(form,'occurredAt').getAttribute('aria-invalid'),'true');assert.match(h.query(`[id="${field(form,'occurredAt').getAttribute('aria-describedby')}"]`).textContent,/at or after publication/);assert.equal(posts(h).length,0);}
});

test('UTC input rejects offsets and calendar rollover, and a reason-only rejection focuses its own field',{concurrency:false},async t=>{
 const h=await harness(t,{initial:await fixture(true)}),form=h.query('[data-journal-form="revise-fill"]');
 for(const occurredAt of ['2026-10-17T17:00+02:00','2026-10-17T24:00','2026-02-30T17:00']){populate(form,{occurredAt});edit(form,'reason','Synthetic UTC review');await h.submit(form);assert.equal(field(form,'occurredAt').getAttribute('aria-invalid'),'true');assert.equal(h.document.activeElement,field(form,'occurredAt'));assert.equal(posts(h).length,0);}
 populate(form);edit(form,'reason','invalid\nreason');await h.submit(form);assert.equal(field(form,'occurredAt').getAttribute('aria-invalid'),null);assert.equal(field(form,'reason').getAttribute('aria-invalid'),'true');assert.equal(h.document.activeElement,field(form,'reason'));assert.equal(posts(h).length,0);
});
