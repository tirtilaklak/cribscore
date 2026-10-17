import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {hostedSymbol,hostedChartURL,hostedChartEmbedURL,createHostedChartFrame} from '../dist/lib/hosted-chart.js';

test('hosted chart permits only fixed public symbols on the official cross-origin widget endpoint',()=>{
  const expected={IBM:'NYSE:IBM',JNJ:'NYSE:JNJ',NFLX:'NASDAQ:NFLX',PG:'NYSE:PG',TSLA:'NASDAQ:TSLA',TXN:'NASDAQ:TXN',SPY:'AMEX:SPY'};
  for(const [symbol,mapped]of Object.entries(expected)){
    assert.equal(hostedSymbol(symbol),mapped);
    const external=new URL(hostedChartURL(symbol));assert.equal(external.origin,'https://www.tradingview.com');assert.equal(external.pathname,'/chart/');assert.equal(external.searchParams.get('symbol'),mapped);
    const url=new URL(hostedChartEmbedURL(symbol)),config=JSON.parse(decodeURIComponent(url.hash.slice(1)));
    assert.equal(url.origin,'https://www.tradingview-widget.com');assert.equal(url.pathname,'/embed-widget/advanced-chart/');assert.equal(url.search,'?locale=en');assert.equal(url.username+url.password,'');
    assert.deepEqual(config,{autosize:true,symbol:mapped,interval:'D',timezone:'Etc/UTC',theme:'light',style:'1',locale:'en',allow_symbol_change:false,calendar:false,save_image:false,support_host:'https://www.tradingview.com',width:'100%',height:'100%'});
  }
});
test('unsupported or hostile values cannot create a frame, srcdoc, script URL or arbitrary symbol request',()=>{
  let created=0;const doc={createElement(){created++;throw Error('Must reject before DOM creation');}};
  for(const value of ['IBM<script>','__proto__','constructor','NYSE:IBM','ibm','UNKNOWN','https://example.com','IBM#secret',null,undefined,1,{toString(){throw Error('Do not coerce imported input');}}]){
    assert.equal(hostedSymbol(value),null);assert.equal(hostedChartURL(value),null);assert.equal(hostedChartEmbedURL(value),null);
    assert.throws(()=>createHostedChartFrame(value,{document:doc}),/unsupported_hosted_symbol/);
  }
  assert.equal(created,0);
});
test('vendor origin is enabled only on a direct HTTPS frame while parent capabilities remain constrained',()=>{
  const attributes=new Map(),element={style:{},setAttribute:(key,value)=>attributes.set(key,value)};
  const frame=createHostedChartFrame('IBM',{document:{createElement:tag=>{assert.equal(tag,'iframe');return element;}}});
  assert.equal(new URL(frame.src).origin,'https://www.tradingview-widget.com');assert.equal(Object.hasOwn(frame,'srcdoc'),false);
  assert.deepEqual(attributes.get('sandbox').split(' '),['allow-scripts','allow-same-origin','allow-popups','allow-popups-to-escape-sandbox']);
  for(const forbidden of ['allow-top-navigation','allow-top-navigation-by-user-activation','allow-forms','allow-downloads','allow-storage-access-by-user-activation'])assert.equal(attributes.get('sandbox').split(' ').includes(forbidden),false);
  assert.equal(attributes.get('referrerpolicy'),'no-referrer');assert.equal(attributes.has('credentialless'),true);assert.equal(attributes.get('loading'),'lazy');assert.match(frame.title,/IBM.*TradingView/);
});
test('embedding does not load a vendor script into app origin or send private app context/messages',async()=>{
  const source=await readFile(new URL('../dist/lib/hosted-chart.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\.srcdoc\s*=|createElement\(['"]script|document\.write|\.innerHTML\s*=|addEventListener\(['"]message|postMessage\s*\(|document\.cookie|localStorage|sessionStorage|\/api\/journal|oai-authenticated|window\.location|document\.location/);
  for(const symbol of ['IBM','TSLA','SPY']){
    const url=hostedChartEmbedURL(symbol);assert.doesNotMatch(decodeURIComponent(url),/page-uri|utm_source|owner|journal|token|apiKey|access_token|localhost|chatgpt\.site/);
  }
});
