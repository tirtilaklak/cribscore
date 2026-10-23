// Area A shell and menus: static markup, stylesheet guarantees, the live region
// and the actual app in the offline DOM. No browser and no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createDocument} from './helpers/interaction-dom.mjs';
const dist=fileURLToPath(new URL('../dist/',import.meta.url));
const html=await readFile(path.join(dist,'index.html'),'utf8');
const css=await readFile(path.join(dist,'style.css'),'utf8');
const app=await readFile(path.join(dist,'app.js'),'utf8');
const G1='Private preview of unvalidated research. Nothing here is a forecast or a recommendation.';

// Rules with their nesting at-rules, in file order. Comments are removed first.
function cssRules(text){
  const source=text.replace(/\/\*[\s\S]*?\*\//g,''),rules=[];let i=0;
  const block=at=>{while(i<source.length){const open=source.indexOf('{',i),close=source.indexOf('}',i);if(close>=0&&(open<0||close<open)){i=close+1;return;}if(open<0){i=source.length;return;}const prelude=source.slice(i,open).trim();i=open+1;if(prelude.startsWith('@'))block([...at,prelude]);else{const end=source.indexOf('}',i);rules.push({at,selectors:prelude.split(/,(?![^(]*\))/).map(value=>value.trim()),body:source.slice(i,end)});i=end+1;}}};
  block([]);return rules;
}
const declaration=(rule,name)=>rule.body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1]?.trim();

test('the sidebar is one labelled nav landmark with two groups of three links in route order',()=>{
  const document=createDocument(html);
  const nav=document.querySelector('nav.sidebar');
  assert.ok(nav,'the whole sidebar is a nav element');
  assert.equal(nav.getAttribute('aria-label'),'Main');
  assert.equal(document.querySelectorAll('nav').length,1,'one navigation landmark');
  assert.equal(document.querySelectorAll('aside').length,0,'no complementary landmark around the menu');
  const groups=document.querySelectorAll('ul.nav-group');
  assert.equal(groups.length,2);
  const labels=groups.map(group=>document.querySelector(`#${group.getAttribute('aria-labelledby')}`)?.textContent);
  assert.deepEqual(labels,['Daily work','Reference']);
  const links=groups.map(group=>group.querySelectorAll('a.nav-item').map(link=>[link.getAttribute('href'),link.dataset.view,link.textContent.trim()]));
  assert.deepEqual(links,[[['#research','research','Stock desk'],['#prices','prices','Prices'],['#journal','journal','Journal']],[['#evidence','evidence','Sources'],['#library','library','Library'],['#methodology','methodology','Method']]]);
  assert.equal(document.querySelectorAll('.nav-item').length,6,'every element with nav-item is a menu link');
  assert.equal(document.querySelectorAll('button.nav-item').length,0);
  const current=document.querySelectorAll('[aria-current="page"]');
  assert.equal(current.length,1);assert.equal(current[0].dataset.view,'research');
  for(const icon of document.querySelectorAll('.nav-item svg')){assert.equal(icon.getAttribute('aria-hidden'),'true');assert.equal(icon.getAttribute('focusable'),'false');}
  assert.equal(document.querySelectorAll('.nav-item svg').length,6);
  const first=document.querySelector('[data-view="research"]');
  assert.equal(first.className.split(/\s+/).includes('nav-item'),true,'the first research route control is the menu link that carries aria-current');
});

test('the brand returns to the desk without posing as a menu item',()=>{
  const brand=createDocument(html).querySelector('a.brand');
  assert.equal(brand.getAttribute('href'),'#research');
  assert.equal(brand.dataset.go,'research');
  assert.equal(brand.dataset.view,undefined);
  assert.match(brand.getAttribute('aria-label'),/^Cribscore\b/,'the accessible name starts with the visible word');
});

test('the shell drops repeated chrome and keeps the private preview line at the top',()=>{
  for(const removed of ['methodology-shortcut','preview-pill','sidebar-note','sidebar-bottom','workspace-label','nav-indicator','topbar-date'])assert.doesNotMatch(html,new RegExp(`class="[^"]*\\b${removed}\\b`),`${removed} is gone`);
  assert.doesNotMatch(html,/Why this method\?/);
  const document=createDocument(html);
  const line=document.querySelector('#workspace-date');
  assert.equal(line.textContent,G1);assert.equal(line.tagName,'P');
  assert.ok(line.closest('header.topbar'),'the line lives in the page banner');
  const crumb=document.querySelector('#breadcrumb-current');
  assert.ok(crumb,'the live label source stays in the DOM');
  assert.equal(crumb.closest('.breadcrumb').getAttribute('hidden'),'','the old breadcrumb stays hidden');
  assert.match(document.querySelector('.main-footer').textContent,/Unvalidated research/);
  assert.equal((app.match(/\$\('#workspace-date'\)\.textContent/g)||[]).length,1,'the workspace-date statement stays a single slice anchor');
  assert.ok(app.includes(`$('#workspace-date').textContent='${G1}';`));
});

test('the static page matches the stock desk row and the head carries icon, previews and honest metadata',async()=>{
  const document=createDocument(html);
  assert.match(html,/<title>Stock desk · Cribscore<\/title>/);
  assert.equal(document.querySelector('#page-eyebrow').textContent,'Daily work');
  assert.equal(document.querySelector('#page-title').textContent,'The stock desk.');
  assert.equal(document.querySelector('#page-description').textContent,'Company cases from the last dated research review.');
  assert.match(html,/<meta name="theme-color" content="#142b25">/);
  assert.match(html,/<meta name="color-scheme" content="only light">/);
  const description=html.match(/<meta name="description" content="([^"]+)">/)?.[1];
  assert.match(description,/unvalidated/i);assert.match(description,/No forecasts or recommendations\./);
  assert.doesNotMatch(description,/next trading day|catalyst|pick|signal/i);
  const icon=html.match(/<link rel="icon" href="([^"]+)" type="image\/svg\+xml">/)?.[1];
  assert.equal(icon,'./favicon.svg');
  assert.match(await readFile(path.join(dist,'favicon.svg'),'utf8'),/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>[\s\S]*<\/svg>$/);
  const preloads=[...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(match=>match[1]);
  assert.deepEqual(preloads,['./lib/candidates.js','./lib/stock-view.js','./lib/source-freshness.js','./lib/research-slate-view.js']);
  for(const href of [icon,...preloads])assert.ok((await stat(path.join(dist,href))).isFile(),`${href} exists`);
  // Each preload is a static import of app.js or of a module app.js imports statically.
  const staticImports=async file=>[...(await readFile(path.join(dist,file),'utf8')).matchAll(/^import [^;]* from '(\.\/[^']+)';$/gm)].map(match=>path.posix.join(path.posix.dirname(file),match[1]));
  const graph=new Set(),queue=['app.js'];
  while(queue.length){const file=queue.shift();for(const child of await staticImports(file))if(!graph.has(child)){graph.add(child);queue.push(child);}}
  for(const href of preloads)assert.ok(graph.has(href.replace('./','')),`${href} is part of the first render graph`);
  assert.doesNotMatch(html,/desk-tools\.js/,'the journal and prices graph is not preloaded');
});

test('without JavaScript the page says what is missing and keeps both halves of the preview limit',()=>{
  const body=html.slice(html.indexOf('<body'));
  const card=body.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
  assert.ok(card,'a noscript card exists in the body');
  assert.ok(body.indexOf('<noscript>')>body.indexOf('<main')&&body.indexOf('<noscript>')<body.indexOf('</main>'),'the card sits inside main');
  assert.match(card,/<h2>Cribscore needs JavaScript\.<\/h2>/);
  assert.match(card,/shows no live prices\./);assert.match(card,/makes no investment recommendations\./);
  const head=html.slice(0,html.indexOf('</head>'));
  assert.match(head,/<noscript><style>[^<]*#view-content\{display:none\}<\/style><\/noscript>/);
  assert.match(html,/<div class="loading-state">Loading Cribscore\. If this message stays, reload the page\.<\/div>/);
});

test('the window toggle and search use plain labels that stay true after a window passes',()=>{
  const document=createDocument(html);
  const group=document.querySelector('.segmented');
  assert.equal(group.getAttribute('role'),'group');assert.equal(group.getAttribute('aria-label'),'Research window');
  assert.deepEqual(document.querySelectorAll('[data-horizon]').map(button=>[button.dataset.horizon,button.textContent]),[['next_day','1 trading day'],['next_week','5 trading days']]);
  const input=document.querySelector('#research-search');
  assert.equal(input.getAttribute('placeholder'),document.querySelector('#search-label').textContent,'the placeholder repeats the accessible label');
  assert.equal(input.getAttribute('aria-keyshortcuts'),'/');
});

test('titles keep their shape, short deks and the group eyebrows of the menu',()=>{
  const titles=new Function(`${app.match(/^const titles = .*$/m)[0]};return titles;`)();
  assert.deepEqual(Object.keys(titles).sort(),['evidence','journal','library','methodology','prices','research']);
  const groups={research:'Daily work',prices:'Daily work',journal:'Daily work',evidence:'Reference',library:'Reference',methodology:'Reference'};
  for(const [view,[eyebrow,title,dek]] of Object.entries(titles)){
    assert.equal(eyebrow,groups[view],`${view} eyebrow names its menu group`);
    assert.match(title,/\.$/,'render() turns the last character into the green period');
    assert.ok(dek.length<=64,`${view} dek fits a phone line budget (${dek.length})`);
    assert.ok(!`${title} ${dek}`.includes(String.fromCharCode(0x2014)),`${view} copy has no em dash`);
    assert.doesNotMatch(`${title} ${dek}`,/next day|five sessions|forecast|recommend|pick|upside|signal/i);
  }
  assert.equal(titles.prices[1],'Prices in context.');assert.equal(titles.research[1],'The stock desk.');
});

test('the stylesheet hides with [hidden], keeps main free of a focus frame and adds no wider token',()=>{
  assert.match(css,/\[hidden\]\{display:none!important\}/);
  const rules=cssRules(css);
  const mainFocus=rules.filter(rule=>rule.selectors.includes('#main:focus'));
  assert.ok(mainFocus.length&&declaration(mainFocus.at(-1),'outline')==='none','#main focus draws no outline');
  const appended=cssRules(css.slice(css.indexOf('/* == area:A shell == */')));
  assert.ok(appended.length>20,'block A is present');
  for(const rule of appended)assert.doesNotMatch(rule.body,/--(?:ink|muted|paper|white)\s*:/,'appended blocks never redeclare the tested tokens');
});

test('on phones the menu is a 3-column grid of groups and never becomes a sideways strip again',()=>{
  const rules=cssRules(css);
  const phone=rule=>rule.at.some(at=>/max-width:\s*680px/.test(at))&&!rule.at.some(at=>/min-width/.test(at));
  const gridRules=rules.map((rule,index)=>({rule,index})).filter(({rule})=>rule.selectors.includes('.nav-group')&&declaration(rule,'grid-template-columns')&&phone(rule));
  assert.ok(gridRules.length,'a phone rule lays out .nav-group');
  const last=gridRules.at(-1);
  assert.equal(declaration(last.rule,'grid-template-columns'),'repeat(3,minmax(0,1fr))');
  const menu=/\.nav-(?:group|groups|section|item)\b|\.navigation\b|\.sidebar\b/;
  for(const rule of rules.slice(last.index+1))if(rule.selectors.some(selector=>menu.test(selector)))assert.doesNotMatch(rule.body,/overflow(?:-x)?\s*:\s*(?:auto|scroll)/,`menu rule after the grid scrolls sideways: ${rule.selectors.join(',')}`);
  const sticky=rules.filter(rule=>rule.selectors.includes('.sidebar')&&phone(rule)&&!rule.at.some(at=>/max-height/.test(at))&&declaration(rule,'position'));
  assert.equal(declaration(sticky.at(-1),'position'),'sticky');
  const short=rules.filter(rule=>rule.selectors.includes('.sidebar')&&rule.at.some(at=>/max-height:\s*600px/.test(at))&&declaration(rule,'position'));
  assert.equal(declaration(short.at(-1),'position'),'static','short phone screens let the menu scroll away');
  const desktop=rules.filter(rule=>rule.selectors.includes('.sidebar')&&rule.at.some(at=>/min-width:\s*681px/.test(at))&&declaration(rule,'overflow-y'));
  assert.equal(declaration(desktop.at(-1),'overflow-y'),'auto','the fixed sidebar scrolls when the screen is short');
});

test('no later rule hides the preview line, the footer limit, the dek or the desk h1',()=>{
  const rules=cssRules(css);
  for(const selector of ['.topbar','.main-footer>span:last-child','.page-heading p']){
    const display=rules.filter(rule=>rule.selectors.includes(selector)&&declaration(rule,'display'));
    assert.notEqual(declaration(display.at(-1),'display'),'none',`${selector} ends visible`);
  }
  const h1='main:has(> #view-content > .stock-desk:not(.approved-research-slate)) > .page-heading h1';
  const desk=rules.filter(rule=>rule.selectors.includes(h1)&&declaration(rule,'position'));
  assert.equal(declaration(desk.at(-1),'position'),'static','the stock desk h1 shows on phones');
  const appended=cssRules(css.slice(css.indexOf('/* == area:A shell == */')));
  const guarded=/topbar|workspace-date|main-footer/;
  for(const rule of appended)if(rule.selectors.some(selector=>guarded.test(selector)))assert.doesNotMatch(rule.body,/display\s*:\s*none|visibility\s*:\s*hidden|clip(?:-path)?\s*:|opacity\s*:\s*0(?:[;.]|$)|width\s*:\s*1px/,`appended rule hides G1: ${rule.selectors.join(',')}`);
  // Blocks merged after area A never style the G1 shell at all.
  assert.ok(css.includes('/* == end area:A == */'),'block A ends with its marker');
  for(const rule of cssRules(css.slice(css.indexOf('/* == end area:A == */'))))assert.ok(!rule.selectors.some(s=>/topbar|workspace-date|main-footer|footer-logo/.test(s)),`a later block styles the G1 shell: ${rule.selectors.join(',')}`);
});

test('the outcome line never sits over a focused control',()=>{
  const rules=cssRules(css);
  const phone=rule=>rule.at.some(at=>/max-width:\s*680px/.test(at))&&!rule.at.some(at=>/min-width/.test(at));
  const onPhones=rules.filter(rule=>rule.selectors.includes('.desk-feedback')&&phone(rule)&&declaration(rule,'position'));
  assert.ok(onPhones.length,'a phone rule positions the outcome line');
  assert.equal(declaration(onPhones.at(-1),'position'),'static','on phones the outcome line scrolls with its page');
  const wide=rule=>rule.at.some(at=>/min-width:\s*681px/.test(at));
  const capped=rules.filter(rule=>rule.selectors.includes('.desk-feedback')&&wide(rule)&&declaration(rule,'max-height'));
  assert.ok(capped.length,'from 681px a sticky outcome line has a height cap');
  assert.equal(declaration(capped.at(-1),'overflow-y'),'auto');
  const sticky=rules.filter(rule=>rule.selectors.includes('.desk-feedback')&&!rule.at.length&&declaration(rule,'top'));
  const reach=parseFloat(declaration(sticky.at(-1),'top'))+parseFloat(declaration(capped.at(-1),'max-height'));
  const padding=rules.filter(rule=>rule.selectors.includes('html:has(.utility-desk>.desk-feedback)')&&wide(rule)&&declaration(rule,'scroll-padding-top'));
  assert.ok(padding.length&&parseFloat(declaration(padding.at(-1),'scroll-padding-top'))>reach,'keyboard scrolling stops below the sticky outcome line');
});

const statusCode=app.slice(app.indexOf('function updateLoadStatus()'),app.indexOf('async function startLoad('));
const toolsCode=app.slice(app.indexOf('function toolsView('),app.indexOf('async function startDeskTools('));
function liveStatus({view,label,content,query='',topic}){
  const document=createDocument(`<body><span id="breadcrumb-current">${label}</span><section id="view-content">${content}</section></body>`);
  let announced;
  new Function('state','$','loadKindsForView','loadStatus','loadConfig','loadRuns','announce',`${statusCode};updateLoadStatus();`)({view,query,topic},selector=>document.querySelector(selector),()=>[],()=>null,{},new Map(),message=>{announced=message;});
  return {announced,busy:document.querySelector('#view-content').getAttribute('aria-busy')};
}
const toolsView=(view,deskToolsState)=>new Function('state','deskTools','deskToolsState',`${toolsCode};return toolsView();`)({view},null,deskToolsState);

test('the desk workspace panels mark their state and offer Retry only after a failure',()=>{
  for(const view of ['prices','journal']){
    const loading=createDocument(`<body>${toolsView(view,'loading')}</body>`),failed=createDocument(`<body>${toolsView(view,'unavailable')}</body>`);
    assert.equal(loading.querySelector('[data-desk-state]').getAttribute('data-desk-state'),'loading');
    assert.equal(loading.querySelector('h2').textContent,view==='journal'?'Loading your journal':'Loading prices');
    assert.equal(loading.querySelectorAll('button').length,0,'nothing to retry while loading');
    assert.equal(failed.querySelector('[data-desk-state]').getAttribute('data-desk-state'),'unavailable');
    assert.equal(failed.querySelector('h2').textContent,'Workspace unavailable');
    assert.match(failed.querySelector('p').textContent,/Your saved records are unchanged\./);
    assert.equal(failed.querySelectorAll('[data-retry-tools]').length,1);
  }
});

test('the live region reads the desk panel state before desk feedback and never says ready on failure',()=>{
  for(const view of ['prices','journal']){
    const label=view==='prices'?'Prices':'Journal';
    const failed=liveStatus({view,label,content:`${toolsView(view,'unavailable')}<p class="desk-feedback">Nothing saved: invalid decimal.</p>`});
    assert.equal(failed.announced,'Workspace unavailable. Prices and the journal did not load. Your saved records are unchanged. Press Retry, or reload the page.');
    assert.doesNotMatch(failed.announced,/ready/i);assert.equal(failed.busy,'false');
    const loading=liveStatus({view,label,content:toolsView(view,'loading')});
    assert.equal(loading.announced,view==='journal'?'Loading your journal.':'Loading prices.');
    assert.doesNotMatch(loading.announced,/ready/i);assert.equal(loading.busy,'true');
  }
  const panel=liveStatus({view:'journal',label:'Journal',content:'<section class="card desk-panel desk-empty" data-desk-state="unavailable"><h2>The journal did not load</h2><p>No records are shown, and nothing was changed.</p><button type="button">Try again</button></section>'});
  assert.equal(panel.announced,'The journal did not load. No records are shown, and nothing was changed.');
  assert.equal(liveStatus({view:'journal',label:'Journal',content:''}).announced,'Journal ready.');
});

test('a ready announcement counts the results while a search is active',()=>{
  const cards=n=>'<article class="card library-card"></article>'.repeat(n);
  assert.equal(liveStatus({view:'library',label:'Library',content:cards(16)}).announced,'Library ready.');
  assert.equal(liveStatus({view:'library',label:'Library',query:'2013',content:cards(1)}).announced,'Library ready for “2013”. 1 result shown.');
  assert.equal(liveStatus({view:'research',label:'Stock desk',query:'zzzz',content:'<div class="search-empty"></div>'}).announced,'Stock desk ready for “zzzz”. 0 results shown.');
  assert.equal(liveStatus({view:'evidence',label:'Sources',query:'sec',content:'<article class="card evidence-card source-note"></article><article class="card registry-card"></article><article class="card registry-card"></article>'}).announced,'Sources ready for “sec”. 2 results shown.');
  assert.equal(liveStatus({view:'library',label:'Library',topic:'Policy',content:cards(3)}).announced,'Library ready. 3 results shown.');
});

for(const scenario of ['menu-links-route-plain-clicks-only','each-view-keeps-its-own-search','controls-follow-the-view','retry-recovery-focuses-the-view-fallback'])test(`shell scenario: ${scenario}`,()=>{
  const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/ui-A-scenarios.mjs',import.meta.url)),scenario],{encoding:'utf8',env:process.env,timeout:15000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.equal(JSON.parse(result.stdout.trim()).passed,true);
});
