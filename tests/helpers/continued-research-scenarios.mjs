import assert from 'node:assert/strict';
import {boot} from './continued-research-harness.mjs';
// Keep the real module code and URL-keyed ESM cache. Only initial fixture exports
// are corrupted; an explicit retry must request a new URL and recover normally.
const corruptInitial=(filename,append)=>(url,code)=>new URL(url).pathname.endsWith(`/data/${filename}`)&&!new URL(url).search?`${code}\n${append}\n`:code;
function expectUnavailable(app){
  assert.match(app.text(),/Research notes could not be loaded/);
  assert.ok(app.query('[data-retry="research"]'));
  assert.match(app.live(),/Research notes unavailable.*Retry/);
  assert.equal(app.queryAll('.stock-card').length,0,'navigation replaces the old stock view');
  assert.equal(app.queryAll('.library-card').length,0,'no partial library commits');
  assert.equal(app.queryAll('.registry-card').length,0,'no partial source registry commits');
  assert.equal(app.query('#view-content').getAttribute('aria-busy'),'false');
}
async function retry(app){app.click(app.query('[data-retry="research"]'));await app.flush();assert.equal(app.query('[data-retry="research"]'),null);assert.match(app.live(),/ready/);}
const scenarios={
  async 'malformed-library-is-atomic-and-recovers'(){
    for(const corruption of ['nobelLibrary[0]=null;','nobelLibrary[0].laureates={bad:true};']){
      const app=await boot({moduleTransform:corruptInitial('nobel-corpus.js',corruption)});
      assert.equal(app.queryAll('.stock-card').length,6,'independent stock load succeeds');
      app.click(app.query('[data-horizon="next_week"]'));app.click(app.query('[data-view="library"]'));expectUnavailable(app);
      app.input('2013');expectUnavailable(app);await retry(app);
      assert.equal(app.query('#research-search').value,'2013');assert.equal(app.queryAll('.library-card').length,1);
      assert.equal(app.query('[data-horizon="next_week"]').getAttribute('aria-pressed'),'true');
      app.click(app.query('.library-card [data-detail]'));assert.equal(app.query('#detail-dialog').open,true);assert.match(app.query('#detail-content').textContent,/The idea/);
      assert.ok([...app.modules.keys()].some(url=>url.endsWith('/data/nobel-corpus.js?retry=2')),'retry bypasses cached corrupt module');
      app.click(app.query('#close-detail'));app.input('');assert.equal(app.queryAll('.library-card').length,16);
    }
  },
  async 'malformed-gates-and-layers-remain-navigable'(){
    for(const [filename,corruption] of [['research.js','studyState.gates[0]=null;'],['nobel-corpus.js','methodologyPublic.concentric_layers[0]=null;']]){
      const app=await boot({moduleTransform:corruptInitial(filename,corruption)});app.click(app.query('[data-view="methodology"]'));expectUnavailable(app);
      app.click(app.query('[data-detail="gates"]'));assert.equal(app.query('#detail-dialog').open,true);assert.match(app.query('#detail-content').textContent,/No empirical forecast study/);assert.equal(app.queryAll('#detail-content h3').length,0);
      app.click(app.query('#close-detail'));await retry(app);assert.equal(app.queryAll('.method-application h3').length,7);
      app.click(app.query('[data-detail="gates"]'));assert.equal(app.queryAll('#detail-content h3').length,4);assert.match(app.query('#detail-content').textContent,/No empirical forecast study/);
    }
  },
  async 'malformed-source-rows-never-partially-commit'(){
    for(const [filename,corruption] of [['research.js','sources[0]=null;'],['nobel-corpus.js','sources[0].id=null;']]){
      const app=await boot({moduleTransform:corruptInitial(filename,corruption)});app.click(app.query('[data-view="evidence"]'));expectUnavailable(app);
      assert.equal(app.query('[data-retry="evidence"]'),null,'independent evidence loader remains available');assert.equal(app.requestsSeen.filter(request=>request.kind==='evidence').length,1);
      await retry(app);assert.ok(app.queryAll('.registry-card').length>0);app.click(app.query('.registry-card [data-detail]'));
      assert.equal(app.query('#detail-dialog').open,true);assert.ok(app.query('#detail-content a'),'recovered source detail has its original URL');
      app.click(app.query('#close-detail'));app.click(app.query('[data-view="library"]'));assert.equal(app.queryAll('.library-card').length,16);
    }
  },
  async 'unused-fields-and-pending-notes-remain-supported'(){
    const app=await boot({moduleTransform:(url,code)=>new URL(url).pathname.endsWith('/data/research.js')?`${code}\nnobelLibrary[0]=null; studyState.gates[0].id=null;\n`:new URL(url).pathname.endsWith('/data/nobel-corpus.js')?`${code}\nmethodologyPublic.concentric_layers[0].required_evidence={unused:true}; nobelLibrary[0].sourceId=null;\n`:code});
    app.click(app.query('[data-view="library"]'));assert.equal(app.queryAll('.library-card').length,16);assert.match(app.live(),/ready/);
    app.input('2026 entry awaits');assert.equal(app.queryAll('.library-card').length,1);assert.match(app.text(),/awaits primary verification/);app.click(app.query('.library-card [data-detail]'));assert.equal(app.query('#detail-dialog').open,true);
    app.click(app.query('#close-detail'));app.input('');app.click(app.query('[data-view="methodology"]'));assert.equal(app.queryAll('.method-application h3').length,7);app.click(app.query('[data-detail="gates"]'));assert.equal(app.queryAll('#detail-content h3').length,4);
  }
};
const name=process.argv[2];assert.ok(Object.hasOwn(scenarios,name));await scenarios[name]();console.log(JSON.stringify({scenario:name,passed:true}));
