// Plain-language layer on the actual ESM app in the offline fake DOM. Real data files;
// a few scenarios corrupt a module copy in memory. No browser or network.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {boot} from './continued-research-harness.mjs';
const project=process.env.CRIBSCORE_PROJECT_ROOT||fileURLToPath(new URL('../../',import.meta.url));
const load=path=>import(pathToFileURL(`${project}/${path}`).href);
const [{plainLanguage},research,corpus]=await Promise.all([load('dist/data/plain-language.js'),load('dist/data/research.js'),load('dist/data/nobel-corpus.js')]);
const after='2026-10-23T12:00:00Z';
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const plain=id=>{const entry=plainLanguage[id];assert.ok(entry,`plain entry ${id}`);return entry.plain;};
// The exact original, one click away inside its own closed disclosure. The summary shows
// "Original wording" and carries hidden context that names its passage for screen readers.
const disclosure=(key,original,context)=>`<details class="original-wording" data-state-key="${escape(key)}"><summary>Original wording<span class="sr-only"> for ${escape(context)}</span></summary><p>${escape(original)}</p></details>`;
const sources=[...research.sources,...corpus.sources].filter((source,index,all)=>all.findIndex(s=>s.id===source.id)===index);
const note=id=>corpus.nobelLibrary.find(item=>item.id===id);
const statusLabel=status=>status==='metadata_pending'?'Awaiting primary check':status?String(status).replaceAll('_',' '):'Not recorded';
const isPath=(url,name)=>new URL(url).pathname.endsWith(`/data/${name}`);
// Each disclosure is closed, shows the visible label "Original wording", and has one hidden
// context. With contexts given, the hidden names match them; in every case no two repeat.
function assertClosedDisclosures(app,selector,count,label,contexts){
  const found=app.queryAll(selector);assert.equal(found.length,count,`${label}: ${count} original-wording disclosures`);
  const names=found.map(detail=>{
    assert.equal(detail.open,false,`${label}: closed by default`);
    const summary=detail.querySelector('summary'),hidden=summary.querySelectorAll('.sr-only');
    assert.equal(summary.children.filter(child=>!child.className.split(/\s+/).includes('sr-only')).map(child=>child.textContent).join(''),'Original wording',`${label}: visible label`);
    assert.equal(hidden.length,1,`${label}: one hidden context`);assert.match(hidden[0].textContent,/^ for \S/,`${label}: hidden context names the passage`);
    return summary.textContent;
  });
  if(contexts)assert.deepEqual([...names].sort(),contexts.map(context=>`Original wording for ${context}`).sort(),`${label}: each disclosure names its passage`);
  assert.equal(new Set(names).size,names.length,`${label}: no two disclosures share a name`);
}
// What each view rendered before plain wording existed, built from the same data.
function assertOriginalsOnly(app,{except=[]}={}){
  app.click(app.query('[data-view="library"]'));let html=app.html();
  for(const item of corpus.nobelLibrary){
    const unchanged=`<p class="library-mechanism">${escape(item.mechanism)}</p><p class="library-use">`;
    if(except.includes(`library:${item.id}:mechanism`))assert.ok(!html.includes(unchanged),`${item.id} keeps its plain text`);else assert.ok(html.includes(unchanged),`${item.id} card renders as before`);
  }
  app.click(app.query('[data-view="methodology"]'));html=app.html();
  for(const layer of corpus.methodologyPublic.concentric_layers)assert.ok(html.includes(`<h3>${escape(layer.label)}</h3><p>${escape(layer.question)} ${escape(layer.result)}</p>`),`${layer.id} step renders as before`);
  assert.equal(app.queryAll('.method-application h3').length,7);
  app.click(app.query('[data-view="evidence"]'));html=app.html();
  for(const source of sources)assert.ok(html.includes(`<h3>${escape(source.name)}</h3><p>${escape(source.status||'Status not recorded')}</p></div>`),`${source.id} row renders as before`);
}
const scenarios={
  async 'library-cards-and-notes-lead-with-plain-wording'(){
    const app=await boot({at:after});app.click(app.query('[data-view="library"]'));
    const html=app.html();
    for(const item of corpus.nobelLibrary){
      const id=`library:${item.id}:mechanism`;
      assert.ok(html.includes(`<p class="library-mechanism">${escape(plain(id))}</p>${disclosure(id,item.mechanism,item.title)}<p class="library-use">`),`${item.id}: plain card text, then its exact original`);
    }
    assertClosedDisclosures(app,'details.original-wording',16,'library cards',corpus.nobelLibrary.map(item=>item.title));
    assert.equal((html.match(/class="card library-card"/g)||[]).length,16);
    const first=app.query('.library-card');
    assert.deepEqual(first.querySelectorAll('summary,button,a').map(node=>node.tagName),['SUMMARY','BUTTON','A'],'the disclosure sits in reading order before the card actions');
    app.click(app.query('[data-detail="library-nobel-2011"]'));
    const item=note('nobel-2011'),dialog=app.query('#detail-content').innerHTML;
    for(const [heading,field] of [['The idea','mechanism'],['What it means for our research','takeaway'],['What this does not establish','limits']]){
      const id=`library:nobel-2011:${field}`;
      assert.ok(dialog.includes(`<h3>${heading}</h3><p>${escape(plain(id))}</p>${disclosure(id,item[field],heading)}`),`${heading}: plain text, then the original`);
    }
    assert.ok(dialog.includes(`<dt>What was read</dt><dd>${escape(plain('library:nobel-2011:verificationScope'))}${disclosure('library:nobel-2011:verificationScope',item.verificationScope,'What was read')}</dd>`));
    assert.ok(dialog.includes(`<dt>Status</dt><dd>${escape(statusLabel(item.verificationStatus))}</dd>`),'the short Status row renders as before');
    assert.equal(app.queryAll('#detail-content h3').length,3,'the note keeps its three headings');
    assertClosedDisclosures(app,'#detail-content details.original-wording',4,'library note',['The idea','What it means for our research','What this does not establish','What was read']);
    app.click(app.query('#close-detail'));
    app.click(app.query('[data-detail="library-nobel-2026"]'));
    assert.match(app.query('#detail-content').textContent,/StatusAwaiting primary check/);
    assert.match(app.query('#detail-content').textContent,/What this does not establish/);
    app.click(app.query('#close-detail'));
  },
  async 'search-matches-plain-and-original-wording'(){
    const app=await boot({at:after});app.click(app.query('[data-view="library"]'));
    const item=note('nobel-2011'),plainOnly='surprise change in central bank',originalOnly='an observed rate change';
    assert.ok(plain('library:nobel-2011:mechanism').toLowerCase().includes(plainOnly)&&!item.mechanism.toLowerCase().includes(plainOnly),'the phrase is in the plain text only');
    assert.ok(item.mechanism.toLowerCase().includes(originalOnly)&&!plain('library:nobel-2011:mechanism').toLowerCase().includes(originalOnly),'the phrase is in the original only');
    app.input(plainOnly);assert.equal(app.queryAll('.library-card').length,1,'plain wording is searchable');
    app.input(originalOnly);assert.equal(app.queryAll('.library-card').length,1,'original wording is searchable');
    app.input('');assert.equal(app.queryAll('.library-card').length,16);
    // An opened disclosure survives a rerender, keyed by its passage id.
    const opened=app.queryAll('details.original-wording').find(detail=>detail.getAttribute('data-state-key')==='library:nobel-2011:mechanism');opened.open=true;
    app.input('2011');const again=app.queryAll('details.original-wording');assert.equal(again.length,1);assert.equal(again[0].open,true,'the disclosure stays open');
    app.input('');assert.equal(app.queryAll('details.original-wording').filter(detail=>detail.open).length,1,'only the opened disclosure is open');
    app.click(app.query('[data-view="evidence"]'));
    const status=sources.find(source=>plainLanguage[`registry:${source.id}:status`]),plainStatus=plain(`registry:${status.id}:status`);
    const withPlain=sources.filter(source=>plainLanguage[`registry:${source.id}:status`]?.plain===plainStatus).length;
    assert.ok(withPlain>0);
    app.input('was not read again');assert.ok(plainStatus.includes('was not read again'));assert.equal(app.queryAll('.registry-card').length,withPlain,'plain status is searchable');
    app.input('primary text not reread');assert.equal(app.queryAll('.registry-card').length,sources.filter(source=>String(source.status).includes('primary text not reread')).length,'original status is searchable');
  },
  async 'method-steps-and-open-checks-lead-with-plain-wording'(){
    const app=await boot({at:after});app.click(app.query('[data-view="methodology"]'));
    const html=app.html();
    assert.equal(app.queryAll('.method-application h3').length,7);
    for(const layer of corpus.methodologyPublic.concentric_layers){
      const question=plain(`method:layer:${layer.id}:question`),result=plain(`method:layer:${layer.id}:result`);
      assert.ok(html.includes(`<h3>${escape(layer.label)}</h3><p>${escape(question)} ${escape(result)}</p>${disclosure(`method:layer:${layer.id}`,`${layer.question} ${layer.result}`,layer.label)}`),`${layer.id}: plain step, then its original`);
    }
    assertClosedDisclosures(app,'.method-application details.original-wording',7,'method steps',corpus.methodologyPublic.concentric_layers.map(layer=>layer.label));
    app.click(app.query('[data-detail="gates"]'));
    const dialog=app.query('#detail-content').innerHTML;
    assert.equal(app.queryAll('#detail-content h3').length,4);
    for(const gate of research.studyState.gates){const id=`gate:${gate.id}:detail`;assert.ok(dialog.includes(`<h3>${escape(gate.label)} · ${escape(gate.state)}</h3><p>${escape(plain(id))}</p>${disclosure(id,gate.detail,gate.label)}`),`${gate.id}: plain detail, then its original`);}
    assertClosedDisclosures(app,'#detail-content details.original-wording',4,'open checks',research.studyState.gates.map(gate=>gate.label));
    assert.match(app.query('#detail-content').textContent,/No empirical forecast study is validated or frozen\.$/,'the footer stays last');
  },
  async 'sources-rows-and-dialogs-lead-with-plain-wording'(){
    const app=await boot({at:after});app.click(app.query('[data-view="evidence"]'));
    const html=app.html();let plainRows=0,unchanged=0;
    for(const source of sources){
      const id=`registry:${source.id}:status`;
      if(plainLanguage[id]){plainRows++;assert.ok(html.includes(`<h3>${escape(source.name)}</h3><p>${escape(plain(id))}</p>${disclosure(id,source.status,source.name)}</div>`),`${source.id}: plain status, then its original`);}
      else {unchanged++;assert.ok(html.includes(`<h3>${escape(source.name)}</h3><p>${escape(source.status||'Status not recorded')}</p></div>`),`${source.id}: a status without an entry renders as before`);}
    }
    assert.ok(plainRows>0&&unchanged>0,'both kinds of row are present');
    assert.equal((html.match(/class="card registry-card"/g)||[]).length,25);
    assertClosedDisclosures(app,'.registry-card details.original-wording',plainRows,'source rows',sources.filter(source=>plainLanguage[`registry:${source.id}:status`]).map(source=>source.name));
    const source=sources.find(item=>item.id==='nobel-background-2012');
    app.click(app.query('[data-detail="source-nobel-background-2012"]'));
    const dialog=app.query('#detail-content').innerHTML;
    assert.ok(dialog.includes(`<dt>Source type</dt><dd>${escape(source.type)}</dd>`),'rows without plain wording render as before');
    for(const [label,field] of [['Status','status'],['What we may do with it','rightsStatus']]){const id=`registry:${source.id}:${field}`;assert.ok(dialog.includes(`<dt>${label}</dt><dd>${escape(plain(id))}${disclosure(id,source[field],label)}</dd>`),`${label}: plain text, then the original`);}
    const scope=`registry:${source.id}:verificationScope`;
    assert.ok(dialog.includes(`<h3>What was checked</h3><p>${escape(plain(scope))}</p>${disclosure(scope,source.verificationScope,'What was checked')}`));
    assertClosedDisclosures(app,'#detail-content details.original-wording',3,'source dialog',['Status','What we may do with it','What was checked']);
    assert.ok(app.query('#detail-content a'),'the source keeps its link');
    app.click(app.query('#close-detail'));
    const data=sources.find(item=>item.id==='fred-alfred');
    app.click(app.query('[data-detail="source-fred-alfred"]'));
    const fred=app.query('#detail-content').innerHTML;
    assert.ok(fred.includes(`<dt>Status</dt><dd>${escape(data.status)}</dd>`),'a short status renders as before');
    assert.ok(fred.includes(`<dt>What we may do with it</dt><dd>${escape(plain('registry:fred-alfred:rightsStatus'))}${disclosure('registry:fred-alfred:rightsStatus',data.rightsStatus,'What we may do with it')}</dd>`));
  },
  async 'a-missing-plain-module-leaves-every-original-as-before'(){
    const app=await boot({at:after,failImport:url=>isPath(url,'plain-language.js')});
    app.click(app.query('[data-view="library"]'));assert.match(app.live(),/ready/);
    assertOriginalsOnly(app);
    for(const view of ['library','methodology','evidence']){app.click(app.query(`[data-view="${view}"]`));assert.doesNotMatch(app.html(),/original-wording/,`${view}: no disclosure without plain wording`);}
    app.click(app.query('[data-view="library"]'));app.click(app.query('[data-detail="library-nobel-2011"]'));
    const item=note('nobel-2011'),dialog=app.query('#detail-content').innerHTML;
    assert.ok(dialog.includes(`<h3>The idea</h3><p>${escape(item.mechanism)}</p><h3>What it means for our research</h3><p>${escape(item.takeaway)}</p><h3>What this does not establish</h3><p>${escape(item.limits)}</p>`));
    assert.ok(dialog.includes(`<dt>What was read</dt><dd>${escape(item.verificationScope)}</dd>`));
    const malformed=await boot({at:after,moduleTransform:(url,code)=>isPath(url,'plain-language.js')?code.replace('export const plainLanguage =','export const plainLanguage = null &&'):code});
    assertOriginalsOnly(malformed);assert.doesNotMatch(malformed.html(),/original-wording/);
  },
  async 'a-missing-or-outdated-entry-shows-only-that-original'(){
    // One id no longer has an entry, and one original changed after its plain text was checked.
    const edited=`${note('nobel-2013').mechanism} Edited after review.`;
    const app=await boot({at:after,moduleTransform:(url,code)=>isPath(url,'plain-language.js')?code.replace('"library:nobel-2012:mechanism"','"library:nobel-2012:retired"'):isPath(url,'nobel-corpus.js')&&!new URL(url).search?`${code}\nnobelLibrary.find(item=>item.id==='nobel-2013').mechanism=${JSON.stringify(edited)};\n`:code});
    app.click(app.query('[data-view="library"]'));const html=app.html();
    assert.ok(html.includes(`<p class="library-mechanism">${escape(note('nobel-2012').mechanism)}</p><p class="library-use">`),'no entry: the original renders as before');
    assert.ok(html.includes(`<p class="library-mechanism">${escape(edited)}</p><p class="library-use">`),'outdated entry: the current original renders alone');
    assert.ok(!html.includes(escape(plain('library:nobel-2013:mechanism'))),'an outdated plain text never shows');
    assertClosedDisclosures(app,'details.original-wording',14,'the other cards');
    app.input('2013');app.click(app.query('[data-detail="library-nobel-2013"]'));
    const dialog=app.query('#detail-content').innerHTML;
    assert.ok(dialog.includes(`<h3>The idea</h3><p>${escape(edited)}</p><h3>`),'the note shows the current original alone');
    assert.ok(dialog.includes(`<h3>What it means for our research</h3><p>${escape(plain('library:nobel-2013:takeaway'))}</p>`),'unchanged passages keep their plain text');
  },
  async 'a-gate-without-an-id-shows-its-original'(){
    const app=await boot({at:after,moduleTransform:(url,code)=>isPath(url,'research.js')?`${code}\nstudyState.gates[0].id=null;\n`:code});
    app.click(app.query('[data-view="methodology"]'));app.click(app.query('[data-detail="gates"]'));
    const [first,...rest]=research.studyState.gates,dialog=app.query('#detail-content').innerHTML;
    assert.ok(dialog.includes(`<h3>${escape(first.label)} · ${escape(first.state)}</h3><p>${escape(first.detail)}</p><h3>`),'no id: the original renders as before');
    for(const gate of rest)assert.ok(dialog.includes(`<p>${escape(plain(`gate:${gate.id}:detail`))}</p>`));
    assert.equal(app.queryAll('#detail-content h3').length,4);
  },
  async 'a-stalled-plain-module-leaves-every-original-within-2-seconds'(){
    // The plain module never finishes. The originals wait at most 2 seconds for it, well before
    // the 12 second "taking longer" notice and the 30 second load timeout.
    const app=await boot({at:after,moduleTransform:(url,code)=>isPath(url,'plain-language.js')?`${code}\nawait new Promise(()=>{});\n`:code});
    app.click(app.query('[data-view="library"]'));
    assert.equal(app.queryAll('.library-card').length,0,'the originals wait briefly for plain wording');assert.match(app.live(),/Research notes loading\./);
    await app.advance(1999);assert.equal(app.queryAll('.library-card').length,0,'still inside the 2 second limit');
    await app.advance(1);assert.equal(app.queryAll('.library-card').length,16,'16 library cards at the 2 second limit');
    assert.match(app.live(),/ready/);assert.doesNotMatch(app.live(),/unavailable|longer than expected/);
    assertOriginalsOnly(app);
    for(const view of ['library','methodology','evidence']){app.click(app.query(`[data-view="${view}"]`));assert.doesNotMatch(app.html(),/original-wording/,`${view}: no disclosure without plain wording`);}
    await app.advance(40000);app.click(app.query('[data-view="library"]'));
    assert.equal(app.queryAll('.library-card').length,16,'the cards stay after the load timeout would have fired');assert.doesNotMatch(app.html(),/original-wording|Research notes unavailable/);
    app.click(app.query('[data-view="methodology"]'));assert.equal(app.queryAll('.method-application h3').length,7,'7 method steps');
  },
  async 'a-slow-plain-module-counts-only-within-2-seconds'(){
    const slow=ms=>(url,code)=>isPath(url,'plain-language.js')?`await new Promise(resolve=>setTimeout(resolve,${ms}));\n${code}`:code;
    // Inside the limit: the plain wording shows as usual.
    const quick=await boot({at:after,moduleTransform:slow(1500)});quick.click(quick.query('[data-view="library"]'));
    assert.equal(quick.queryAll('.library-card').length,0);
    await quick.advance(1500);assert.equal(quick.queryAll('.library-card').length,16);
    assertClosedDisclosures(quick,'details.original-wording',16,'plain wording inside the limit',corpus.nobelLibrary.map(item=>item.title));
    // After the limit: the originals show, and the late plain wording never replaces them, even on a rerender.
    const late=await boot({at:after,moduleTransform:slow(2500)});late.click(late.query('[data-view="library"]'));
    await late.advance(2000);assert.equal(late.queryAll('.library-card').length,16,'the originals show at the limit');
    assertOriginalsOnly(late);
    await late.advance(1000);
    assertOriginalsOnly(late);
    for(const view of ['library','methodology','evidence']){late.click(late.query(`[data-view="${view}"]`));assert.doesNotMatch(late.html(),/original-wording/,`${view}: the late module changes nothing`);}
  },
  async 'each-original-wording-disclosure-names-its-passage'(){
    // Screen reader users who list controls hear which passage each disclosure belongs to.
    const title='Policy & "transmission" <2011>';
    const app=await boot({at:after,moduleTransform:(url,code)=>isPath(url,'nobel-corpus.js')?`${code}\nnobelLibrary.find(item=>item.id==='nobel-2011').title=${JSON.stringify(title)};\n`:code});
    app.click(app.query('[data-view="library"]'));
    const titles=corpus.nobelLibrary.map(item=>item.id==='nobel-2011'?title:item.title);
    assertClosedDisclosures(app,'details.original-wording',16,'library cards',titles);
    assert.ok(app.html().includes(`<summary>Original wording<span class="sr-only"> for ${escape(title)}</span></summary>`),'the hidden context is escaped');
    app.click(app.query('[data-view="methodology"]'));
    assertClosedDisclosures(app,'details.original-wording',7,'method steps',corpus.methodologyPublic.concentric_layers.map(layer=>layer.label));
    app.click(app.query('[data-view="evidence"]'));
    const named=sources.filter(source=>plainLanguage[`registry:${source.id}:status`]).map(source=>source.name);
    assertClosedDisclosures(app,'details.original-wording',named.length,'source rows',named);
    // The same visible label sits in front of every hidden context.
    for(const summary of app.queryAll('details.original-wording summary'))assert.match(summary.textContent,/^Original wording for \S/);
  },
  async 'plain-and-original-text-is-escaped-everywhere'(){
    // Markup characters in a plain text or in its original render as text in every new builder:
    // the library card, the method step, the source row and the note, checks and source dialogs.
    // A passage whose plain text no longer matches its original shows the original alone, escaped too.
    // Ids and labels carry markup as well: a gate id reaches data-state-key, a gate label the
    // open-checks heading, a layer label the step heading. A step whose question and result have no
    // usable plain text, and a dialog row without one, still escape their originals.
    const hostile='<b>&"\'',original=label=>`Original ${label} ${hostile} wording.`,plainText=label=>`Plain ${label} ${hostile} wording.`;
    const gateId=`calibration${hostile}`,gateLabel=`Calibration ${hostile} check`,layerLabel=`Economy ${hostile} step`,sourceType=`Type ${hostile} here`;
    const ids={mechanism:'library:nobel-2011:mechanism',question:'method:layer:macro:question',result:'method:layer:macro:result',gate:`gate:${gateId}:detail`,status:'registry:nobel-background-2012:status',rights:'registry:nobel-background-2012:rightsStatus'};
    const originals=Object.fromEntries(Object.keys(ids).map(key=>[key,original(key)])),outdated=original('outdated'),outdatedScope=original('outdated scope'),fedQuestion=original('fed question'),fedResult=original('fed result');
    const groups=Object.entries(ids).map(([key,id])=>({original_sha256:createHash('sha256').update(originals[key],'utf8').digest('hex'),plain:plainText(key),ids:[id]}));
    const app=await boot({at:after,moduleTransform:(url,code)=>{
      if(isPath(url,'plain-language.js'))return code.replace('export const plainLanguage =',`groups.push(...${JSON.stringify(groups)});\nexport const plainLanguage =`);
      if(isPath(url,'nobel-corpus.js'))return `${code}\nnobelLibrary.find(item=>item.id==='nobel-2011').mechanism=${JSON.stringify(originals.mechanism)};\nObject.assign(nobelLibrary.find(item=>item.id==='nobel-2013'),{mechanism:${JSON.stringify(outdated)},verificationScope:${JSON.stringify(outdatedScope)}});\nObject.assign(methodologyPublic.concentric_layers.find(layer=>layer.id==='macro'),{label:${JSON.stringify(layerLabel)},question:${JSON.stringify(originals.question)},result:${JSON.stringify(originals.result)}});\nObject.assign(methodologyPublic.concentric_layers.find(layer=>layer.id==='fed_response'),{question:${JSON.stringify(fedQuestion)},result:${JSON.stringify(fedResult)}});\nObject.assign(sources.find(source=>source.id==='nobel-background-2012'),{type:${JSON.stringify(sourceType)},status:${JSON.stringify(originals.status)},rightsStatus:${JSON.stringify(originals.rights)}});\n`;
      if(isPath(url,'research.js'))return `${code}\nObject.assign(studyState.gates.find(gate=>gate.id==='calibration'),{id:${JSON.stringify(gateId)},label:${JSON.stringify(gateLabel)},detail:${JSON.stringify(originals.gate)}});\n`;
      return code;
    }});
    const noRawMarkup=(html,label)=>assert.doesNotMatch(html,/<b>/,`${label}: no raw markup from the text`);
    app.click(app.query('[data-view="library"]'));let html=app.html();
    const item=note('nobel-2011');
    assert.ok(html.includes(`<p class="library-mechanism">${escape(plainText('mechanism'))}</p>${disclosure(ids.mechanism,originals.mechanism,item.title)}`),'library card: the plain text and its original are escaped');
    noRawMarkup(html,'library cards');
    const card=app.queryAll('.library-card').find(node=>node.querySelector('[data-detail="library-nobel-2011"]'));
    assert.equal(card.querySelector('.library-mechanism').textContent,plainText('mechanism'),'the plain text reads as text');
    assert.equal(card.querySelector('details.original-wording p').textContent,originals.mechanism,'the original reads as text');
    assert.ok(html.includes(`<p class="library-mechanism">${escape(outdated)}</p><p class="library-use">`),'library card without a usable plain text: the original alone, escaped');
    app.click(app.query('[data-detail="library-nobel-2011"]'));let dialog=app.query('#detail-content').innerHTML;
    assert.ok(dialog.includes(`<h3>The idea</h3><p>${escape(plainText('mechanism'))}</p>${disclosure(ids.mechanism,originals.mechanism,'The idea')}`),'library note: escaped');
    noRawMarkup(dialog,'library note');app.click(app.query('#close-detail'));
    app.click(app.query('[data-detail="library-nobel-2013"]'));dialog=app.query('#detail-content').innerHTML;
    assert.ok(dialog.includes(`<h3>The idea</h3><p>${escape(outdated)}</p><h3>`),'library note without a usable plain text: the original alone, escaped');
    assert.ok(dialog.includes(`<dt>What was read</dt><dd>${escape(outdatedScope)}</dd>`),'a dialog row without a usable plain text: the original alone, escaped');
    noRawMarkup(dialog,'library note without plain text');app.click(app.query('#close-detail'));
    // Real data: the 2018 limits say "R&D" in both versions.
    app.click(app.query('[data-detail="library-nobel-2018"]'));dialog=app.query('#detail-content').innerHTML;
    const limits=note('nobel-2018').limits,limitsPlain=plain('library:nobel-2018:limits');
    assert.ok(limits.includes('R&D')&&limitsPlain.includes('R&D'),'both versions of the 2018 limits name R&D');
    assert.ok(dialog.includes(`<h3>What this does not establish</h3><p>${escape(limitsPlain)}</p>${disclosure('library:nobel-2018:limits',limits,'What this does not establish')}`),'2018 note: both versions escaped');
    assert.equal((dialog.match(/R&amp;D/g)||[]).length,2,'R&amp;D in the plain text and in the original');assert.ok(!dialog.includes('R&D'),'no raw ampersand');
    app.click(app.query('#close-detail'));
    app.click(app.query('[data-view="methodology"]'));html=app.html();
    assert.ok(html.includes(`<h3>${escape(layerLabel)}</h3><p>${escape(plainText('question'))} ${escape(plainText('result'))}</p>${disclosure('method:layer:macro',`${originals.question} ${originals.result}`,layerLabel)}`),'method step: label, question, result and original escaped');
    const fed=corpus.methodologyPublic.concentric_layers.find(layer=>layer.id==='fed_response');
    assert.ok(html.includes(`<h3>${escape(fed.label)}</h3><p>${escape(fedQuestion)} ${escape(fedResult)}</p><h3>`),'method step without a usable plain text: question and result alone, escaped');
    assert.ok(html.includes(`<dt>${escape(gateLabel)}</dt>`),'the gate label in the status list is escaped');
    noRawMarkup(html,'method steps');
    app.click(app.query('[data-detail="gates"]'));dialog=app.query('#detail-content').innerHTML;
    const gate=research.studyState.gates.find(item=>item.id==='calibration');
    assert.ok(dialog.includes(`<h3>${escape(gateLabel)} · ${escape(gate.state)}</h3><p>${escape(plainText('gate'))}</p>${disclosure(ids.gate,originals.gate,gateLabel)}`),'open checks: the gate label, the id in data-state-key and both texts escaped');
    assert.ok(dialog.includes(`data-state-key="${escape(ids.gate)}"`),'the state key is escaped');
    assert.equal(app.queryAll('#detail-content details.original-wording').find(detail=>detail.getAttribute('data-state-key')===ids.gate)?.querySelector('p').textContent,originals.gate,'the state key reads back as the exact id');
    noRawMarkup(dialog,'open checks');app.click(app.query('#close-detail'));
    app.click(app.query('[data-view="evidence"]'));html=app.html();
    const source=sources.find(item=>item.id==='nobel-background-2012');
    assert.ok(html.includes(`<h3>${escape(source.name)}</h3><p>${escape(plainText('status'))}</p>${disclosure(ids.status,originals.status,source.name)}</div>`),'source row: escaped');
    noRawMarkup(html,'source rows');
    app.click(app.query('[data-detail="source-nobel-background-2012"]'));dialog=app.query('#detail-content').innerHTML;
    assert.ok(dialog.includes(`<dt>Source type</dt><dd>${escape(sourceType)}</dd>`),'a dialog row with no plain key: escaped');
    assert.ok(dialog.includes(`<dt>Status</dt><dd>${escape(plainText('status'))}${disclosure(ids.status,originals.status,'Status')}</dd>`),'source dialog status: escaped');
    assert.ok(dialog.includes(`<dt>What we may do with it</dt><dd>${escape(plainText('rights'))}${disclosure(ids.rights,originals.rights,'What we may do with it')}</dd>`),'source dialog rights: escaped');
    noRawMarkup(dialog,'source dialog');
  },
  async 'a-search-that-matches-only-the-original-opens-it'(){
    // A search can match words that sit only in a closed original. That original opens, so the
    // matched words are on screen. The forced state is never saved: clearing the search restores
    // the reader's own choice.
    const app=await boot({at:after});app.click(app.query('[data-view="library"]'));
    const own=app.queryAll('details.original-wording').find(detail=>detail.getAttribute('data-state-key')==='library:nobel-2012:mechanism');own.open=true;
    const phrase='an observed rate change';
    app.input(phrase);
    const [card,...others]=app.queryAll('.library-card');assert.equal(others.length,0,'one card matches');
    const opened=card.querySelector('details.original-wording');
    assert.equal(opened.getAttribute('data-state-key'),'library:nobel-2011:mechanism');
    assert.equal(opened.open,true,'the original that holds the match is open');
    assert.ok(opened.querySelector('p').textContent.toLowerCase().includes(phrase),'the matched words are in the open original');
    assert.ok(!card.querySelector('.library-mechanism').textContent.toLowerCase().includes(phrase),'the plain text does not hold them');
    assert.match(app.live(),/1 result shown\./);
    app.input('surprise change in central bank');
    assert.equal(app.queryAll('.library-card').length,1);assert.equal(app.query('details.original-wording').open,false,'a match in the plain text leaves the original closed');
    app.input(phrase);assert.equal(app.query('details.original-wording').open,true);
    app.input('');
    const open=app.queryAll('details.original-wording').filter(detail=>detail.open).map(detail=>detail.getAttribute('data-state-key'));
    assert.deepEqual(open,['library:nobel-2012:mechanism'],'clearing the search closes the forced original and keeps the reader’s own');
    app.click(app.query('[data-view="evidence"]'));
    const reread='primary text not reread',expected=sources.filter(source=>String(source.status).includes(reread)&&plainLanguage[`registry:${source.id}:status`]).length;
    assert.ok(expected>0);
    app.input(reread);
    const rows=app.queryAll('.registry-card');assert.equal(rows.length,expected,'every matching source row is shown');
    for(const row of rows){const detail=row.querySelector('details.original-wording');assert.equal(detail.open,true,'its original is open');assert.ok(detail.querySelector('p').textContent.includes(reread),'with the matched words');}
    app.input('was not read again');
    assert.equal(app.queryAll('.registry-card').length,expected);assert.equal(app.queryAll('.registry-card details.original-wording').filter(detail=>detail.open).length,0,'a plain match leaves every original closed');
    app.input('');assert.equal(app.queryAll('details.original-wording').filter(detail=>detail.open).length,0,'nothing stays open after the search');
  },
  async 'originals-at-29-seconds-still-load-when-the-plain-module-stalls'(){
    // The research module arrives at 29 seconds, 1 second before the 30 second load timeout, and the
    // plain module never finishes. The wait for plain wording ends 1 second before the deadline, so
    // the originals load. A fixed 2 second wait would run past the deadline and fail the whole load.
    const app=await boot({at:after,moduleTransform:(url,code)=>isPath(url,'plain-language.js')?`${code}\nawait new Promise(()=>{});\n`:isPath(url,'research.js')?`await new Promise(resolve=>setTimeout(resolve,29000));\n${code}`:code});
    app.click(app.query('[data-view="library"]'));
    await app.advance(28999);
    assert.equal(app.queryAll('.library-card').length,0,'the originals are not here yet');assert.match(app.live(),/taking longer than expected/);
    await app.advance(1);
    assert.equal(app.queryAll('.library-card').length,16,'16 library cards as soon as the originals arrive');
    assert.match(app.live(),/ready/);assert.doesNotMatch(app.live(),/unavailable/);
    assertOriginalsOnly(app);
    await app.advance(40000);app.click(app.query('[data-view="library"]'));
    assert.equal(app.queryAll('.library-card').length,16,'the cards stay after the load timeout would have fired');assert.doesNotMatch(app.html(),/original-wording|Research notes unavailable/);
    // Originals at 27.5 seconds: the wait is cut to 1.5 seconds, still 1 second before the deadline.
    const late=await boot({at:after,moduleTransform:(url,code)=>isPath(url,'plain-language.js')?`${code}\nawait new Promise(()=>{});\n`:isPath(url,'research.js')?`await new Promise(resolve=>setTimeout(resolve,27500));\n${code}`:code});
    late.click(late.query('[data-view="library"]'));
    await late.advance(28999);assert.equal(late.queryAll('.library-card').length,0,'still waiting for plain wording');
    await late.advance(1);assert.equal(late.queryAll('.library-card').length,16,'the originals show 1 second before the deadline');
    assert.doesNotMatch(late.live(),/unavailable/);
  },
  async 'a-plain-module-that-throws-leaves-every-original'(){
    // Reading the plain entries throws. The load treats it like a missing plain module.
    const app=await boot({at:after,moduleTransform:(url,code)=>isPath(url,'plain-language.js')?code.replace('export const plainLanguage =','export const plainLanguage = new Proxy({},{ownKeys(){throw new Error("hostile plain module");}});\nconst unusedPlainLanguage ='):code});
    app.click(app.query('[data-view="library"]'));
    assert.match(app.live(),/ready/);assert.doesNotMatch(app.live(),/unavailable/);
    assertOriginalsOnly(app);
    for(const view of ['library','methodology','evidence']){app.click(app.query(`[data-view="${view}"]`));assert.doesNotMatch(app.html(),/original-wording|could not be loaded/,`${view}: the originals alone`);}
  },
  async 'each-term-is-explained-once-per-page'(){
    // The owner's voice rule: explain a term once per page, at its first use. A page is one view or
    // one dialog. The original wording inside its disclosure and hidden screen reader text do not
    // count. A term is keyed by its last word; "an exogenous experiment" and "natural experiments"
    // are different ideas, so that head word is keyed by its last two words.
    const app=await boot({at:after});
    const twoWordHeads=new Set(['experiment']);
    const visible=html=>html.replace(/<details class="original-wording"[\s\S]*?<\/details>/g,' ').replace(/<span class="sr-only">[\s\S]*?<\/span>/g,'').replace(/<[^>]+>/g,' ').replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
    const stem=word=>word.toLowerCase().replace(/’s$|'s$/,'').replace(/s$/,'');
    const check=(page,html)=>{
      const seen=new Map();let count=0;
      for(const [,phrase,gloss] of visible(html).matchAll(/((?:[\p{L}’'-]+\s+)?[\p{L}’'-]+)\s\(([^()]*)\)/gu)){
        const words=phrase.trim().split(/\s+/),head=stem(words.at(-1)),key=twoWordHeads.has(head)&&words.length>1?`${stem(words.at(-2))} ${head}`:head;
        assert.ok(!seen.has(key),`${page}: "${key}" is explained twice: (${seen.get(key)}) and (${gloss})`);seen.set(key,gloss);count++;
      }
      return count;
    };
    let glosses=0;
    for(const view of ['library','methodology','evidence']){app.click(app.query(`[data-view="${view}"]`));glosses+=check(view,app.html());}
    app.click(app.query('[data-view="library"]'));
    for(const item of corpus.nobelLibrary){app.click(app.query(`[data-detail="library-${item.id}"]`));glosses+=check(`note ${item.id}`,app.query('#detail-content').innerHTML);app.click(app.query('#close-detail'));}
    app.click(app.query('[data-view="methodology"]'));app.click(app.query('[data-detail="gates"]'));glosses+=check('open checks',app.query('#detail-content').innerHTML);app.click(app.query('#close-detail'));
    app.click(app.query('[data-view="evidence"]'));
    for(const source of sources){app.click(app.query(`[data-detail="source-${source.id}"]`));glosses+=check(`source ${source.id}`,app.query('#detail-content').innerHTML);app.click(app.query('#close-detail'));}
    assert.ok(glosses>100,`the explanations were found (${glosses})`);
    // The check sees a repeat: the 2013 card explains "returns", so a second card may not.
    assert.throws(()=>check('library with a repeat',`<p>Returns (the gain or loss from an investment) vary.</p><p>So do returns (gains or losses).</p>`),/"return" is explained twice/);
    assert.doesNotThrow(()=>check('different experiments',`<p>An exogenous experiment (a change from outside) and natural experiments (real events) differ.</p>`));
  }
};
const name=process.argv[2];assert.ok(Object.hasOwn(scenarios,name),`known scenario ${name}`);await scenarios[name]();console.log(JSON.stringify({scenario:name,passed:true}));
