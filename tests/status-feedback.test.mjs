import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDocument} from './helpers/interaction-dom.mjs';
import {renderJournalView} from '../dist/lib/journal-view.js';
import {renderPriceView} from '../dist/lib/price-view.js';
import {renderPriceSetup} from '../dist/lib/price-setup.js';
const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function updateLoadStatus()'),source.indexOf('async function startLoad('));
function renderStatus({view='journal',feedback=true,kindStatus=null,setup=null}={}){
 const document=createDocument(`<body><span id="breadcrumb-current">${view==='prices'?'Prices':'Journal'}</span><section id="view-content">${feedback?'<p class="desk-feedback">Nothing saved: invalid decimal.</p>':''}${setup?renderPriceSetup({status:setup,reasons:[]}):''}</section></body>`);
 let announced;const state={view,query:''},loadConfig={synthetic:{label:'Synthetic data'}},loadRuns=new Map();
 new Function('state','$','loadKindsForView','loadStatus','loadConfig','loadRuns','announce',`${code};updateLoadStatus();`)(state,selector=>document.querySelector(selector),()=>kindStatus?['synthetic']:[],()=>kindStatus,loadConfig,loadRuns,message=>{announced=message;});
 return {announced,busy:document.querySelector('#view-content').getAttribute('aria-busy'),feedback:document.querySelector('.desk-feedback')?.textContent};
}
test('persistent live region carries detailed Journal and Prices feedback instead of a ready announcement',()=>{
 for(const view of ['journal','prices']){const result=renderStatus({view});assert.equal(result.announced,'Nothing saved: invalid decimal.');assert.equal(result.feedback,result.announced);}
});
test('inline feedback does not add a competing live region',()=>{
 for(const html of [renderJournalView({entries:[],summary:{}},{feedback:'Synthetic failure'}),renderPriceView({status:'unavailable',points:[],issues:[]},{feedback:'Synthetic failure'})]){
  const node=createDocument('<body>'+html+'</body>').querySelector('.desk-feedback');assert.ok(node);assert.equal(node.getAttribute('role'),null);assert.equal(node.getAttribute('aria-live'),null);assert.equal(node.textContent,'Synthetic failure');
 }
});
test('ordinary ready status remains when no desk feedback exists',()=>{assert.equal(renderStatus({feedback:false}).announced,'Journal ready.');});
test('genuine file loading remains announced even with desk feedback',()=>{const result=renderStatus({kindStatus:'loading'});assert.equal(result.announced,'Synthetic data loading.');assert.equal(result.busy,'true');});
test('genuine file failure remains announced even with desk feedback',()=>{const result=renderStatus({kindStatus:'unavailable'});assert.equal(result.announced,'Synthetic data unavailable. Retry is available.');assert.equal(result.busy,'false');});

test('setup progress and outcome use the persistent region with no competing inline live region',()=>{
 for(const status of ['loading','unavailable','setup_required','configured_unverified']){
  const node=createDocument('<body>'+renderPriceSetup({status,reasons:[]})+'</body>').querySelector('[data-price-setup-status]');
  assert.equal(node.getAttribute('role'),null);assert.equal(node.getAttribute('aria-live'),null);
  assert.equal(renderStatus({view:'prices',feedback:false,setup:status}).announced,node.textContent);
 }
 assert.equal(renderStatus({view:'prices',feedback:false,setup:'unchecked'}).announced,'Prices ready.');
 assert.equal(renderStatus({view:'prices',feedback:true,setup:'setup_required'}).announced,'Nothing saved: invalid decimal.');
});
