import { handleJournalRequest } from '../server/journal-api.js';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { createScheduledJournalMcp } from '../server/journal/scheduled-mcp.mjs';
import { handleMarketDataSetupRequest } from '../server/market-data/setup-status.mjs';
import { handleMarketDataProbeRequest } from '../server/market-data/alpaca-probe.mjs';
import { buildStockSnapshot } from '../dist/lib/candidates.js';
import { publicAssets } from './generated-assets.js';

// Readers are fixed server dependencies. Browser imports and request payloads
// cannot become publication, calendar or reviewed-price authority.
const observer=createJournalObserver({
  readPublications:null,
  readCalendar:null,
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

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==='/mcp')return scheduledMcp.fetch(request,env);
    if(url.pathname==='/api/market-data/setup')return handleMarketDataSetupRequest(request,env);
    if(url.pathname==='/api/market-data/probe')return handleMarketDataProbeRequest(request,env);
    if(url.pathname.startsWith('/api/'))return handleJournalRequest(request,env,{observer});
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    const asset=publicAssets[url.pathname==='/'?'/index.html':url.pathname];
    if(!asset)return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{
      'Content-Type':asset.type,'Cache-Control':'private, no-cache',
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    }});
  },
};
