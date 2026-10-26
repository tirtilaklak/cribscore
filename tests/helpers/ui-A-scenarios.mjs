import assert from 'node:assert/strict';
import {boot,retained} from './continued-research-harness.mjs';
// Area A shell scenarios on the actual ESM app in the offline DOM. A click here
// carries a mouse button and preventDefault, like a browser click on a link.
const press=(app,element,extra={})=>{assert.ok(element,'control exists');let prevented=false;element.focus();element.dispatch({type:'click',target:element,button:0,preventDefault(){prevented=true;},...extra});return prevented;};
const scenarios={
  async 'menu-links-route-plain-clicks-only'(){
    const app=await boot();
    const library=app.query('a.nav-item[data-view="library"]');
    assert.equal(library.getAttribute('href'),'#library');
    for(const modifier of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]){
      assert.equal(press(app,library,modifier),false,`a modified click (${JSON.stringify(modifier)}) is left to the browser`);
      assert.equal(app.location.hash,'','a modified click does not route inside the app');
      assert.equal(app.query('a.nav-item[data-view="research"]').getAttribute('aria-current'),'page');
      assert.equal(library.getAttribute('aria-current'),null);
    }
    assert.equal(press(app,library),true,'a plain click is routed inside the app');
    assert.equal(app.location.hash,'#library');
    assert.equal(app.query('a.nav-item[data-view="library"]').getAttribute('aria-current'),'page');
    assert.equal(app.queryAll('.nav-item[aria-current="page"]').length,1);
    assert.equal(app.document.title,'Library · Cribscore');
    assert.equal(app.query('#page-eyebrow').textContent,'Reference');
    assert.equal(app.query('#page-title').textContent,'The Nobel library.');
    assert.equal(app.document.activeElement.id,'main','navigation still focuses the main region');
    assert.equal(press(app,app.query('a.brand')),true,'the brand returns to the stock desk');
    assert.equal(app.location.hash,'#research');
    assert.equal(app.query('a.nav-item[data-view="research"]').getAttribute('aria-current'),'page');
    assert.equal(app.document.title,'Stock desk · Cribscore');
  },
  async 'each-view-keeps-its-own-search'(){
    const app=await boot({stockPayload:retained});
    app.input('TXN');assert.equal(app.queryAll('.stock-card').length,1);
    assert.equal(app.live(),'Stock desk ready for “TXN”. 2 results shown.','the count covers the company case and its earnings call');
    app.click(app.query('[data-view="library"]'));
    assert.equal(app.query('#research-search').value,'','the library opens with its own empty search');
    assert.equal(app.queryAll('.library-card').length,16,'a stock desk query never filters the library');
    app.input('2013');assert.equal(app.queryAll('.library-card').length,1);
    assert.equal(app.live(),'Library ready for “2013”. 1 result shown.');
    app.click(app.query('[data-view="research"]'));
    assert.equal(app.query('#research-search').value,'TXN','the desk query returns with the desk');
    assert.equal(app.queryAll('.stock-card').length,1);
    app.click(app.query('[data-view="library"]'));
    assert.equal(app.query('#research-search').value,'2013');assert.equal(app.queryAll('.library-card').length,1);
    app.click(app.query('[data-view="evidence"]'));
    assert.equal(app.query('#research-search').value,'');assert.ok(app.queryAll('.registry-card').length>1,'sources stay unfiltered');
    app.input('zzzz-no-such-source');
    assert.equal(app.live(),'Sources ready for “zzzz-no-such-source”. 0 results shown.');
  },
  async 'controls-follow-the-view'(){
    const app=await boot();
    assert.doesNotMatch(app.html(),/Ranked upside|stock-shortlist|Top pick|aria-label="[^"]*(?:rank|pick|upside)/i,'the desk and its wrapper add no ranking language');
    const expected={research:[false,false,false,'Search stocks and events'],prices:[true,true,true,null],journal:[true,true,true,null],evidence:[false,true,false,'Search sources'],library:[false,true,false,'Search notes'],methodology:[true,true,true,null]};
    for(const [view,[toolbar,horizon,search,label]] of Object.entries(expected)){
      app.click(app.query(`[data-view="${view}"]`));
      assert.equal(app.query('.research-toolbar').hidden,toolbar,`${view}: toolbar hidden`);
      assert.equal(app.query('.horizon-group').hidden,horizon,`${view}: window toggle hidden`);
      assert.equal(app.query('.search-box').hidden,search,`${view}: search hidden`);
      if(label){assert.equal(app.query('#research-search').getAttribute('placeholder'),label);assert.equal(app.query('#search-label').textContent,label,'the visible placeholder and the accessible label agree');}
      assert.equal(app.queryAll('[data-horizon]').length,2,'both window buttons stay in the DOM');
      assert.equal(app.queryAll('[data-horizon][aria-pressed="true"]').length,1,'one window stays pressed');
      const main=app.query('#main');main.focus();
      assert.equal(app.key(main,'/'),Boolean(label),`"/" only acts where search shows (${view})`);
      assert.equal(app.document.activeElement.id,label?'research-search':'main');
    }
  },
  async 'retry-recovery-focuses-the-view-fallback'(){
    const app=await boot({failImport:url=>url.endsWith('/lib/desk-tools.js')});
    app.click(app.query('[data-view="prices"]'));
    assert.ok(app.query('[data-desk-state="unavailable"]'),'the failure panel marks its state');
    assert.equal(app.live(),'Workspace unavailable. Prices and the journal did not load. Your saved records are unchanged. Press Retry, or reload the page.');
    assert.doesNotMatch(app.live(),/ready/i);
    assert.equal(app.query('#view-content').getAttribute('aria-busy'),'false');
    const retry=app.query('[data-retry-tools]');retry.focus();app.click(retry);
    // Before the retried module arrives, the page already says it is loading.
    assert.ok(app.query('[data-desk-state="loading"]'),'Retry replaces the failure panel with the loading panel at once');
    assert.equal(app.query('[data-desk-state="unavailable"]'),null);
    assert.equal(app.query('#view-content').getAttribute('aria-busy'),'true');
    assert.equal(app.live(),'Loading prices.');
    assert.equal(app.document.activeElement.textContent,'Loading prices','focus moves to the loading heading');
    await app.flush();
    assert.equal(app.query('[data-desk-state]'),null,'the recovered view replaces the failure panel');
    const target=app.query('[data-focus-fallback]');
    assert.ok(target,'the recovered Prices view offers a focus fallback');
    assert.equal(app.document.activeElement,target,'focus lands on the view fallback target');
    assert.doesNotMatch(app.live(),/unavailable/i);
  },
  async 'retry-that-fails-again-keeps-the-failure-in-view'(){
    const app=await boot({failImport:url=>url.includes('/lib/desk-tools.js')});
    app.click(app.query('[data-view="journal"]'));
    const retry=app.query('[data-retry-tools]');retry.focus();app.click(retry);
    assert.ok(app.query('[data-desk-state="loading"]'));assert.equal(app.live(),'Loading the journal.');
    await app.flush();
    assert.ok(app.query('[data-desk-state="unavailable"]'),'a second failure shows the failure panel again');
    assert.equal(app.query('#view-content').getAttribute('aria-busy'),'false');
    assert.equal(app.live(),'Workspace unavailable. Prices and the journal did not load. Your saved records are unchanged. Press Retry, or reload the page.');
    assert.equal(app.document.activeElement.textContent,'Workspace unavailable','focus stays in the panel, on its heading');
    assert.ok(app.query('[data-retry-tools]'),'Retry is offered again');
  },
  async 'unknown-hash-keeps-the-view-and-its-address'(){
    const app=await boot();
    app.click(app.query('[data-view="library"]'));
    app.route('https://offline.invalid/#nonsense','hashchange');
    assert.equal(app.query('#page-title').textContent,'The Nobel library.','an unknown hash keeps the current view');
    assert.equal(app.location.hash,'#library','the address shows the current view again');
    app.route('https://offline.invalid/?horizon=next_week#nonsense','hashchange');
    assert.equal(app.location.hash,'#library');assert.equal(app.location.search,'?horizon=next_week','the window choice stays in the address');
    assert.equal(app.query('[data-horizon="next_week"]').getAttribute('aria-pressed'),'true');
    app.route('https://offline.invalid/?horizon=next_week#methodology','hashchange');
    assert.equal(app.query('#page-title').textContent,'The method.','a known hash still routes');
    assert.equal(app.location.hash,'#methodology');
  }
};
const name=process.argv[2];assert.ok(Object.hasOwn(scenarios,name),`known scenario ${name}`);await scenarios[name]();console.log(JSON.stringify({scenario:name,passed:true}));
