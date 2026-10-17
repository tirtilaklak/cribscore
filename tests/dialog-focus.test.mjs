// Exact app lifecycle/navigation handlers with a queued dialog-close event.
// Offline synthetic markup; this does not model native Tab containment.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDocument} from './helpers/interaction-dom.mjs';
const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const renderer=source.slice(source.indexOf('function disclosureKey('),source.indexOf('let rightsExpiryTimer;'));
const navigation=source.slice(source.indexOf('function navigate('),source.indexOf('function detailRows('));
const locationSync=source.slice(source.indexOf('function syncLocation('),source.indexOf("window.addEventListener('hashchange'"));
const closeHandler=source.split('\n').find(line=>line.startsWith("$('#detail-dialog').addEventListener('close'"));
function client(){
  const document=createDocument('<body><main id="main" tabindex="-1"><section id="view-content"></section></main><dialog id="detail-dialog"><button id="close-detail">Close</button><h2 id="detail-title"></h2><span id="detail-kicker"></span><div id="detail-content"></div></dialog></body>');
  const state={view:'research',horizon:'next_week'},location={href:'https://synthetic.example/?horizon=next_week#research',hash:'#research',search:'?horizon=next_week'},queued=[];
  const dialog=document.querySelector('#detail-dialog');let opener;
  dialog.showModal=()=>{opener=document.activeElement;dialog.open=true;document.querySelector('#close-detail').focus();};
  dialog.close=()=>{if(!dialog.open)return;dialog.open=false;opener?.focus();queued.push(()=>{for(const fn of dialog.listeners.get('close')||[])fn({type:'close',target:dialog});});};
  const api=new Function('document','state','location',`const titles={research:[],library:[]};let lastFocus,renderedView,renderedContentHTML;const disclosureState=new Map(),$=s=>document.querySelector(s);${renderer}
    function render(){renderContent(state.view==='research'?'<button data-detail="timing">Timing '+state.horizon+'</button>':'<button data-detail="library-synthetic">Library</button>');}
    ${navigation}\n${locationSync}\n${closeHandler}\nrender();return {details,syncLocation};`)(document,state,location);
  return {document,state,dialog,query:s=>document.querySelector(s),open(){document.querySelector('[data-detail]').focus();api.details('Synthetic detail','<p>Detail</p>');},route(href){const u=new URL(href);Object.assign(location,{href:u.href,hash:u.hash,search:u.search});api.syncLocation();},flush(){while(queued.length)queued.shift()();}};
}

test('queued close after same-view horizon history navigation leaves focus at the main region',()=>{
  const h=client();h.open();assert.equal(h.dialog.open,true);
  h.route('https://synthetic.example/?horizon=next_day#research');
  assert.equal(h.state.horizon,'next_day');assert.equal(h.dialog.open,false);assert.equal(h.document.activeElement.id,'main');
  h.flush();assert.equal(h.document.activeElement.id,'main','A delayed close event must not override navigation focus with the remapped old dialog opener');
});

test('ordinary queued close restores its opener',()=>{
  const h=client(),opener=h.query('[data-detail]');h.open();h.dialog.close();h.flush();assert.equal(h.document.activeElement,opener);
});

test('queued close after navigation to another view leaves focus at main',()=>{
  const h=client();h.open();h.route('https://synthetic.example/#library');h.flush();assert.equal(h.document.activeElement.id,'main');
});


test('navigation also supersedes an earlier user close whose event is still queued',()=>{
  const h=client();h.open();h.dialog.close();assert.equal(h.dialog.open,false);
  h.route('https://synthetic.example/?horizon=next_day#research');h.flush();assert.equal(h.document.activeElement.id,'main');
});
