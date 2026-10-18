import { handleJournalRequest } from '../server/journal-api.js';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { createScheduledJournalMcp } from '../server/journal/scheduled-mcp.mjs';
import { readCalendar } from '../server/calendar/calendar.mjs';
import { handleMarketDataSetupRequest } from '../server/market-data/setup-status.mjs';
import { handleMarketDataProbeRequest } from '../server/market-data/alpaca-probe.mjs';
import { buildStockSnapshot } from '../dist/lib/candidates.js';
import { publicAssets } from './generated-assets.js';

// Readers are fixed server dependencies. Browser imports and request payloads
// cannot become publication, calendar or reviewed-price authority.
const observer=createJournalObserver({
  readPublications:null,
  readCalendar,
  readReviewedPrices:null,
  readObservationContext:({at})=>{
    const evidence=JSON.parse(publicAssets['/data/stock-evidence.json'].body);
    return ['next_day','next_week'].map(horizonId=>{
      const snapshot=buildStockSnapshot(evidence,horizonId,at);
      if(!snapshot)throw Error('Retained research context unavailable.');
      return {horizonId,unrankedCount:snapshot.hypotheses.length,snapshot:{
        id:snapshot.id,methodVersion:snapshot.method_version,
        reviewedAt:snapshot.reviewed_at,sourceCutoffAt:snapshot.source_cutoff_at,
        window:snapshot.window,
      }};
    });
  },
});

// Publishing a Site MCP capability and verifying its cloud connection are
// separate activation steps. Request/env flags cannot enable this writer.
const scheduledMcp=createScheduledJournalMcp({observer,writesEnabled:true,
  sourceConfiguration:{publisher:'unconfigured',calendar:'unconfigured',reviewedPrices:'unconfigured'},
});

// One policy for every response. The app is one same-origin module script with
// same-origin fetches; the help pages each ship one inline <style>, admitted by
// the hashes the build recorded. The hosted chart is the only framed origin.
const styleHashes=[...new Set(Object.values(publicAssets).flatMap(asset=>asset.styleHashes||[]))];
const securityHeaders={
  'Content-Security-Policy':[
    "default-src 'none'","script-src 'self'",["style-src 'self'",...styleHashes.map(hash=>`'${hash}'`)].join(' '),
    "img-src 'self'","connect-src 'self'","frame-src https://www.tradingview-widget.com",
    "base-uri 'none'","form-action 'self'","frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.openai.com",
  ].join('; '),
  'Strict-Transport-Security':'max-age=31536000',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
};
const secured=response=>{const copy=new Response(response.body,response);for(const [name,value] of Object.entries(securityHeaders))copy.headers.set(name,value);return copy;};
// If-None-Match uses weak comparison (RFC 9110), so a W/ prefix does not matter.
const matchesETag=(header,etag)=>header!==null&&header.split(',').some(tag=>{const value=tag.trim();return value==='*'||value.replace(/^W\//,'')===etag;});
function serveAsset(request,asset){
  const etag=`"${asset.sha256}"`,headers={ETag:etag,'Cache-Control':'public, max-age=300, must-revalidate'};
  if(matchesETag(request.headers.get('If-None-Match'),etag))return new Response(null,{status:304,headers});
  return new Response(request.method==='HEAD'?null:asset.body,{headers:{...headers,'Content-Type':asset.type}});
}
function route(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/mcp')return scheduledMcp.fetch(request,env);
  if(url.pathname==='/api/market-data/setup')return handleMarketDataSetupRequest(request,env);
  if(url.pathname==='/api/market-data/probe')return handleMarketDataProbeRequest(request,env);
  if(url.pathname.startsWith('/api/'))return handleJournalRequest(request,env,{observer});
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const asset=publicAssets[url.pathname==='/'?'/index.html':url.pathname];
  if(!asset)return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  return serveAsset(request,asset);
}

export default {
  async fetch(request,env) {
    return secured(await route(request,env));
  },
};
