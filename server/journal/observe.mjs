import { validateJournal, checkAppendOnly, enrollPublication, evaluatePaper, recordAbstention, projectJournal } from '../../dist/lib/journal.js';
import { resolvePaperWindow, resolvePriceMark } from '../../dist/lib/prices.js';

// Server-only orchestration. Function references supplied by the host are the
// trust boundary; hashes and reader payload labels do not authenticate a feed.
export const OBSERVER_VERSION = 'journal-observer-v1';
const HORIZONS = ['next_day', 'next_week'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
const canonical = value => JSON.stringify(value, (_, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const same = (a,b) => canonical(a) === canonical(b);
const freeze = value => { if(value && typeof value === 'object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value; };
const copy = value => JSON.parse(JSON.stringify(value));
const need = (condition, code) => {if(!condition)throw new Error(code);};
const good = result => {need(result?.ok, result?.errors?.[0] || 'journal_operation_failed');return result.journal;};
const plain = (value, depth=0) => depth <= 30 && (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) || (Array.isArray(value) || object(value)) && Object.entries(value).every(([key,item]) => !['__proto__','constructor','prototype'].includes(key) && plain(item,depth+1)));
const payload = publication => JSON.parse(publication.payloadBytes);
const windowKey = window => canonical(window);
const scheduleKey = publication => `${publication.publishedAt}|${publication.horizonId}`;
async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function cleanReader(value, code){need(plain(value) && JSON.stringify(value).length <= 8_000_000,code);return freeze(copy(value));}
function contexts(value, field, publications, code){
  need(exact(value,['status','contexts']) && value.status === 'ready' && Array.isArray(value.contexts) && value.contexts.length <= publications.length,code);
  const map = new Map();
  for(const item of value.contexts){need(exact(item,['publicationId',...field]) && publications.some(p=>p.publicationId===item.publicationId) && !map.has(item.publicationId),code);map.set(item.publicationId,item);}
  return map;
}
function unavailable(value){return exact(value,['status']) && ['unavailable','unconfigured'].includes(value.status);}

/** Reader contracts are documented in docs/journal-observer-contract.md.
 * No persistence, scheduler, request authority or credentials are configured. */
export function createJournalObserver({readPublications=null,readCalendar=null,readReviewedPrices=null,readObservationContext=null,clock=()=>new Date().toISOString()}={}){
  for(const reader of [readPublications,readCalendar,readReviewedPrices,readObservationContext])need(reader===null || typeof reader==='function','invalid_server_reader');
  need(typeof clock==='function','invalid_server_clock');
  return Object.freeze({async observe(input){
    try{
      need(exact(input,['journal','receivedAt','requestId','ownerScope']) && instant(input.receivedAt) && identifier(input.requestId) && input.requestId.length<=96 && text(input.ownerScope),'invalid_observation_request');
      const {journal,receivedAt,requestId,ownerScope}=input;
      const previous=good(await validateJournal(journal)),baseRevision=previous.revision;
      let at=receivedAt;
      const tick=()=>{let value;try{value=clock();}catch{throw new Error('server_clock_unavailable');}need(instant(value),'server_clock_unavailable');if(Date.parse(value)>Date.parse(at))at=value;return at;};
      tick();need([previous.createdAt,...previous.events.map(e=>e.at)].every(value=>Date.parse(value)<=Date.parse(at)),'server_clock_before_history');
      const pending=new Set(),known=previous.events.filter(e=>e.kind==='publication').map(e=>e.data),requestedAt=at;
      const common=()=>freeze({ownerScope,at});
      const read=async(fn,args,name)=>{if(!fn)return {status:'unconfigured'};let result;try{result=await fn(freeze(copy(args)));}catch{tick();pending.add(`${name}_reader_unavailable`);return {status:'unavailable'};}tick();return cleanReader(result,`invalid_${name}_reader_result`);};
      let archive=await read(readPublications,{...common(),fromAt:previous.createdAt,throughAt:requestedAt,horizonIds:HORIZONS,knownPublicationIds:known.map(p=>p.publicationId)},'publication');
      let publisherState=archive.status,publications=[];
      if(!unavailable(archive)){
        need(exact(archive,['status','coverage','publications']) && archive.status==='ready' && Array.isArray(archive.publications) && archive.publications.length<=100,'invalid_publication_reader_result');
        const coverage=archive.coverage;
        need(exact(coverage,['fromAt','throughAt','horizonIds','complete']) && coverage.complete===true && instant(coverage.fromAt) && instant(coverage.throughAt) && Date.parse(coverage.fromAt)<=Date.parse(previous.createdAt) && Date.parse(coverage.throughAt)>=Date.parse(requestedAt) && Date.parse(coverage.throughAt)<=Date.parse(at) && Array.isArray(coverage.horizonIds) && coverage.horizonIds.length===2 && HORIZONS.every(h=>coverage.horizonIds.includes(h)),'publication_coverage_incomplete');
        // Validate exact journal envelopes before trusting fields for dispatch.
        for(const publication of archive.publications){
          const existing=known.find(p=>p.publicationId===publication?.publicationId);
          if(existing){need(same(existing,publication),'publication_id_conflict');continue;}
          const checked=await enrollPublication(previous,{id:'observer-validation',at,publication});need(checked.ok,checked.errors?.[0]||'invalid_publication');
          need(Date.parse(publication.publishedAt)<=Date.parse(coverage.throughAt),'publication_after_archive_coverage');
          need(Date.parse(publication.publishedAt)>=Date.parse(previous.createdAt) || Date.parse(payload(publication).horizon.exit_at)>=Date.parse(previous.createdAt),'publication_before_observation_scope');
          const duplicate=publications.find(p=>p.publicationId===publication.publicationId);need(!duplicate || same(duplicate,publication),'publication_id_conflict');if(!duplicate)publications.push(publication);
        }
        publisherState=archive.publications.length?'ready':'empty';
      }else if(archive.status==='unavailable')pending.add('publisher_unavailable');
      publications.sort((a,b)=>Date.parse(a.publishedAt)-Date.parse(b.publishedAt)||a.publicationId.localeCompare(b.publicationId));
      const all=[...known,...publications];
      for(const publication of known){const event=previous.events.find(e=>e.kind==='publication'&&e.data.publicationId===publication.publicationId);need(payload(publication).rows.every(row=>previous.events.some(e=>['paper_intent','no_fill'].includes(e.kind)&&e.data.publicationEventId===event.id&&e.data.symbol===row.ticker)),'incomplete_publication_enrollment');}
      const currentSettings=projectJournal(previous).settings;
      const frozenIntents=previous.events.filter(e=>e.kind==='paper_intent').map(e=>({id:e.id,...e.data,window:e.data.window||previous.events.find(s=>s.kind==='paper_schedule'&&s.data.intentId===e.id)?.data.window||null}));
      const calendarResult=all.length?await read(readCalendar,{...common(),publications:all,frozenIntents},'calendar'):{status:'unconfigured'};
      const calendars=unavailable(calendarResult)?new Map():contexts(calendarResult,['calendar'],all,'invalid_calendar_reader_result');
      if(all.length && unavailable(calendarResult))pending.add('calendar_unavailable');
      const priceResult=all.length?await read(readReviewedPrices,{...common(),publications:all,currentSettings,frozenIntents},'price'):{status:'unconfigured'};
      const prices=unavailable(priceResult)?new Map():contexts(priceResult,['benchmarkIdentities','seriesBySymbol','reviewsBySymbol'],all,'invalid_price_reader_result');
      for(const value of prices.values()){
        need(Array.isArray(value.benchmarkIdentities) && value.benchmarkIdentities.every(item=>exact(item,['symbol','entityId'])&&/^[A-Z][A-Z0-9.-]{0,14}$/.test(item.symbol)&&text(item.entityId)) && new Set(value.benchmarkIdentities.map(item=>item.symbol)).size===value.benchmarkIdentities.length && object(value.seriesBySymbol) && object(value.reviewsBySymbol),'invalid_price_reader_result');
      }
      if(all.length && unavailable(priceResult))pending.add('reviewed_prices_unavailable');
      let observedContexts=[];
      if(readObservationContext){const result=await read(readObservationContext,common(),'observation_context');need(Array.isArray(result)&&result.length<=2,'invalid_observation_context');observedContexts=result;for(const context of result)need(exact(context,['horizonId','unrankedCount','snapshot'])&&HORIZONS.includes(context.horizonId)&&Number.isSafeInteger(context.unrankedCount)&&context.unrankedCount>=0,'invalid_observation_context');need(new Set(result.map(c=>c.horizonId)).size===result.length,'duplicate_observation_horizon');}
      tick();
      // All external readers have completed before the first new intent is built.
      const observedAt=at;
      let next=previous;
      for(const publication of publications){
        const settings=copy(currentSettings),identity=prices.get(publication.publicationId)?.benchmarkIdentities.find(item=>item.symbol===settings.benchmarkSymbol)?.entityId;
        if(identity){need(!settings.benchmarkEntityId || settings.benchmarkEntityId===identity,'benchmark_identity_conflict');settings.benchmarkEntityId=identity;}
        if(!settings.benchmarkEntityId)pending.add('benchmark_identity_missing');
        const calendar=calendars.get(publication.publicationId)?.calendar;
        const resolution=resolvePaperWindow({publishedAt:publication.publishedAt,horizonSessions:publication.horizonId==='next_week'?5:1,calendar,at:observedAt});
        for(const reason of resolution.reasons||[])pending.add(reason);
        next=good(await enrollPublication(next,{id:`obsp-${(await digest(publication.publicationId)).slice(0,32)}`,at:observedAt,publication,windowResolution:resolution,settings}));
      }
      // Domain resolver calls carry frozen windows, not intent IDs. Dispatch by
      // exact window and reject ambiguous source contexts instead of guessing.
      const descriptors=all.map(publication=>{
        const publicationEvent=next.events.find(e=>e.kind==='publication'&&e.data.publicationId===publication.publicationId);
        const intent=next.events.find(e=>e.kind==='paper_intent'&&e.data.publicationEventId===publicationEvent.id);
        const frozen=intent?.data.window||next.events.find(e=>e.kind==='paper_schedule'&&e.data.intentId===intent?.id)?.data.window;
        const calendar=calendars.get(publication.publicationId)?.calendar;
        const resolution=resolvePaperWindow({publishedAt:publication.publishedAt,horizonSessions:publication.horizonId==='next_week'?5:1,calendar,at:observedAt});
        for(const reason of resolution.reasons||[])pending.add(reason);
        const symbols=payload(publication).rows.map(row=>row.ticker);
        for(const event of next.events.filter(e=>e.kind==='paper_intent'&&e.data.publicationEventId===publicationEvent.id))symbols.push(event.data.settings.benchmarkSymbol);
        return {publication,calendar,prices:prices.get(publication.publicationId),resolution,window:frozen||resolution.window,symbols};
      });
      const choose=(items,code)=>{if(!items.length)return null;need(items.every(item=>same(item,items[0])),code);return items[0];};
      const symbols=new Set(all.flatMap(p=>payload(p).rows.map(row=>row.ticker)));for(const intent of next.events.filter(e=>e.kind==='paper_intent'))symbols.add(intent.data.settings.benchmarkSymbol);
      const resolutions={
        resolvePaperWindow:options=>{
          const candidates=descriptors.filter(item=>scheduleKey(item.publication)===`${options.publishedAt}|${options.horizonSessions===5?'next_week':'next_day'}`).map(item=>item.resolution);
          return choose(candidates,'ambiguous_calendar_context')||{status:'pending',reasons:['calendar_unavailable']};
        },
        resolvePriceMark:(_series,options)=>{
          const candidates=descriptors.filter(item=>item.symbols.includes(options.review)&&item.window&&windowKey(item.window)===windowKey(options.window)).map(item=>({calendar:item.calendar||null,series:item.prices?.seriesBySymbol[options.review]||null,review:item.prices?.reviewsBySymbol[options.review]||null}));
          const selected=choose(candidates,'ambiguous_price_context');
          if(!selected)return {status:'pending',reasons:['reviewed_prices_unavailable']};
          const result=resolvePriceMark(selected.series,{...options,review:selected.review,calendar:selected.calendar});for(const reason of result.reasons||[])pending.add(reason);return result;
        }
      };
      if(next.events.some(e=>e.kind==='paper_intent'))next=good(await evaluatePaper(next,{at:observedAt,eventIdPrefix:`obse-${(await digest(requestId)).slice(0,32)}`,reviewsBySymbol:Object.fromEntries([...symbols].map(s=>[s,s])),resolvers:resolutions}));
      if(publisherState!=='unavailable'){
        for(const context of observedContexts){
          // Existing published decisions on this observation date are not relabeled absent.
          if(next.events.some(e=>e.kind==='publication'&&e.at.slice(0,10)===observedAt.slice(0,10)&&e.data.horizonId===context.horizonId))continue;
          if((archive.publications||[]).some(p=>p.horizonId===context.horizonId&&Date.parse(payload(p).horizon.entry_at)>Date.parse(observedAt)))continue;
          const reason=publisherState==='unconfigured'?'No eligible publication is connected; the authoritative publisher is not configured.':'No eligible published suggestions were present in the complete checked archive.';
          next=good(await recordAbstention(next,{id:`obsa-${observedAt.slice(0,10)}-${context.horizonId}`,at:observedAt,date:observedAt.slice(0,10),horizonId:context.horizonId,unrankedCount:context.unrankedCount,snapshot:context.snapshot,reason}));
        }
      }
      next=good(await validateJournal(next));need(checkAppendOnly(previous,next).ok,'observation_prefix_conflict');
      const pendingReasons=[...pending].sort();need(pendingReasons.length<=64 && pendingReasons.every(reason=>/^[a-z][a-z0-9_:-]{0,119}$/.test(reason)),'invalid_pending_reasons');
      return freeze({ok:true,baseRevision,journal:next,changed:next.revision!==baseRevision,observedAt,automation:{publisherState,checkedAt:observedAt,pendingReasons}});
    }catch(error){return {ok:false,errors:[error.message||'observation_failed']};}
  }});
}
