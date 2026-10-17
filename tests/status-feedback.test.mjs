import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDocument} from './helpers/interaction-dom.mjs';
const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function updateLoadStatus()'),source.indexOf('async function startLoad('));
function renderStatus({view='journal',feedback=true,kindStatus=null}={}){
 const document=createDocument(`<body><span id="breadcrumb-current">${view==='prices'?'Prices':'Journal'}</span><section id="view-content">${feedback?'<p class="desk-feedback" role="status">Nothing saved: invalid decimal.</p>':''}</section></body>`);
 let announced;const state={view,query:''},loadConfig={synthetic:{label:'Synthetic data'}},loadRuns=new Map();
 new Function('state','$','loadKindsForView','loadStatus','loadConfig','loadRuns','announce',`${code};updateLoadStatus();`)(state,selector=>document.querySelector(selector),()=>kindStatus?['synthetic']:[],()=>kindStatus,loadConfig,loadRuns,message=>{announced=message;});
 return {announced,busy:document.querySelector('#view-content').getAttribute('aria-busy'),feedback:document.querySelector('.desk-feedback')?.textContent};
}
test('existing Journal and Prices feedback is not contradicted by a second ready announcement',()=>{
 for(const view of ['journal','prices']){const result=renderStatus({view});assert.equal(result.announced,'');assert.equal(result.feedback,'Nothing saved: invalid decimal.');}
});
test('ordinary ready status remains when no desk feedback exists',()=>{assert.equal(renderStatus({feedback:false}).announced,'Journal ready.');});
test('genuine file loading remains announced even with desk feedback',()=>{const result=renderStatus({kindStatus:'loading'});assert.equal(result.announced,'Synthetic data loading.');assert.equal(result.busy,'true');});
test('genuine file failure remains announced even with desk feedback',()=>{const result=renderStatus({kindStatus:'unavailable'});assert.equal(result.announced,'Synthetic data unavailable. Retry is available.');assert.equal(result.busy,'false');});
