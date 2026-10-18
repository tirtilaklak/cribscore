import * as journalDomain from './journal.js';
import { buildPriceView, parsePriceImport } from './prices.js';
import { renderJournalView } from './journal-view.js';
import { renderPriceView } from './price-view.js';
import { createPriceSetupClient } from './price-setup.js';
import { createHostedChartFrame, hostedChartURL } from './hosted-chart.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const companies=[['IBM','International Business Machines'],['JNJ','Johnson & Johnson'],['NFLX','Netflix'],['PG','Procter & Gamble'],['TSLA','Tesla'],['TXN','Texas Instruments']];
const asText=value=>typeof value==='string'?value.trim():'';
const errors=result=>(result?.errors||[result?.error||'operation_unavailable']).join(', ').replaceAll('_',' ');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export function actualFillTime(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value))throw new Error('Enter an exact UTC date and time.');
  const normalized=value.length===16?`${value}:00Z`:`${value}Z`,date=new Date(normalized);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19)!==normalized.slice(0,19))throw new Error('The UTC date and time is invalid.');
  return normalized;
}

/** Host adapter. The authoritative publication reader and reviewed price feed
 * remain absent. Imported JSON never enters automatic paper enrollment. */
export function createDeskTools({onChange=()=>{},fetch:request=globalThis.fetch,document:doc=globalThis.document,now=()=>new Date().toISOString(),uuid=()=>globalThis.crypto.randomUUID()}={}) {
  let saved=null,draft=null,unsyncedDraft=null,revision=0,busy=false,loadState='loading',pendingImport=null,feedback=null,uncertainRestore=null,pendingForm=null;
  const localPreview=doc.querySelector?.('meta[name="cribscore-local-preview"]')?.getAttribute('content')==='true';
  const savedState=localPreview?'local_only':'synced';
  const savedMessage=revision=>localPreview?`Saved in temporary local preview memory · revision ${revision}. It resets when the preview server stops.`:`Saved to this private Site · revision ${revision}. Available on your other signed-in devices.`;
  let needsSetup=false,priceImportRun=0,capacityRevision=null;
  const capacityMessage='This update would exceed the 20,000-event journal limit. Updates are paused; saved history remains available to read and export. Exporting does not free space.';
  // A visitor without platform identity (a public view) gets a read-only shell:
  // no journal, no setup status, and no browser-side write or observation.
  const ownerOnlyMessage='The journal is available to the signed-in site owner only. This view records and saves nothing.';
  function pauseForCapacity(){capacityRevision=revision;storage={state:'capacity',message:capacityMessage};automation={publisherState:'unavailable',checkedAt:null,pendingReasons:['journal_capacity_exceeded']};feedback=capacityMessage;}
  let storage={state:'unavailable',message:'Connecting to the journal…'};
  let automation={publisherState:'unavailable',checkedAt:null,pendingReasons:['observation_not_checked']};
  let symbol='IBM',rangeSessions=20,series=[],priceFeedback=null,requestedChart=null,chartFrame=null,lastPriceStatus=null;
  const id=prefix=>`${prefix}-${uuid()}`;
  const boundedRequest=async(url,options)=>{
    const controller=new AbortController();let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Journal request timed out.'));},15000);});
    try{return await Promise.race([(async()=>{const response=await request(url,{...options,signal:controller.signal});const body=await response.json();return {ok:response.ok,status:response.status,json:async()=>body};})(),deadline]);}
    finally{clearTimeout(timer);}
  };
  const store=journalDomain.createHttpJournalStore({fetch:boundedRequest});
  const changed=()=>onChange();
  const priceSetup=createPriceSetupClient({fetch:request,onChange:changed});
  function viewModel(){return draft?journalDomain.projectJournal(draft,{storage}):null;}
  function safeAction(reviewAction=false){
    if(pendingImport&&!reviewAction){feedback='Apply or cancel the reviewed backup before making another journal change.';changed();return false;}
    if(busy){feedback='A journal operation is still in progress.';changed();return false;}
    if(storage.state==='capacity'){feedback=capacityMessage;changed();return false;}
    if(!draft||storage.state!==savedState){feedback='Reconnect or sync the saved journal before changing its records. You can export any unsynced draft.';changed();return false;}
    return true;
  }
  function retireConfirmedForm(journal){
    if(!pendingForm||journal.journalId!==pendingForm.journalId||journal.createdAt!==pendingForm.createdAt)return;
    if(!pendingForm.events.every(event=>journal.events.some(savedEvent=>canonical(savedEvent)===canonical(event))))return;
    pendingForm.accepted();pendingForm=null;
  }
  async function commit(next,{mode='append',imported=false}={}) {
    const previous=draft,base=saved;
    uncertainRestore=null;
    if(!imported){draft=next;unsyncedDraft=next;}
    const result=await store.commit(next,{expectedRevision:revision,mode});
    if(result.ok){saved=result.journal;draft=result.journal;unsyncedDraft=null;revision=result.revision;storage={state:savedState,message:savedMessage(revision)};retireConfirmedForm(saved);if(revision===journalDomain.JOURNAL_LIMITS.events)pauseForCapacity();}
    else{
      if(imported)draft=previous;
      // A conflict containing this restore can follow its commit and another append.
      // Its body is only a recovery hint; a fresh GET must confirm the exact prefix.
      // This never projects an unconfirmed backup or permits an arbitrary identity.
      const conflictJournal=imported&&mode==='restore'&&result.error==='revision_conflict'?await journalDomain.validateJournal(result.journal):null;
      const conflictContainsRestore=conflictJournal?.ok&&journalDomain.checkAppendOnly(next,conflictJournal.journal).ok;
      if(imported&&mode==='restore'&&(['server_commit_uncertain','server_commit_unconfirmed','invalid_server_response','invalid_server_journal','journal_commit_uncertain'].includes(result.error)||conflictContainsRestore))uncertainRestore={base,candidate:next};
      storage={state:result.state==='conflict'?'conflict':'unsaved',message:result.state==='conflict'?'Another session changed the journal. Your draft is still in this tab; export it before reconciling.':'The save was not confirmed. Your draft is still in this tab; export it before closing or reloading.'};
      feedback=`Journal save unavailable: ${errors(result)}. No synced result is assumed.`;
    }
    return result;
  }
  async function assess() {
    if(busy||pendingImport||needsSetup||!draft||storage.state!==savedState)return;
    busy=true;changed();
    try{
      const response=await boundedRequest('/api/journal/observe',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:revision,requestId:id('observe')})});
      const result=await response.json();
      if(response.status===409&&result?.ok===false&&result.error==='journal_capacity_exceeded'){
        if(result.revision!==revision||result.capacity?.limit!==journalDomain.JOURNAL_LIMITS.events||result.capacity.remaining!==journalDomain.JOURNAL_LIMITS.events-revision)throw Error('Invalid capacity response.');
        pauseForCapacity();return;
      }
      if(response.status===409){
        storage={state:'conflict',message:'Another session updated the saved journal. Check journal sync to load its history before continuing.'};
        automation={publisherState:'unavailable',checkedAt:null,pendingReasons:['journal_revision_conflict']};
        feedback='The automatic update encountered a newer saved revision. No local history was replaced.';return;
      }
      if(!response.ok||result?.ok!==true)throw Error(errors(result));
      const checked=await journalDomain.validateJournal(result.journal),status=result.automation;
      if(!checked.ok||result.revision!==checked.journal.revision||!journalDomain.checkAppendOnly(draft,checked.journal).ok
        ||!status||!['unconfigured','unavailable','empty','ready'].includes(status.publisherState)
        ||typeof status.checkedAt!=='string'||!Number.isFinite(Date.parse(status.checkedAt))
        ||!Array.isArray(status.pendingReasons)||status.pendingReasons.length>100||status.pendingReasons.some(reason=>typeof reason!=='string'||reason.length>240))throw Error('Invalid automatic update response.');
      saved=checked.journal;draft=checked.journal;unsyncedDraft=null;revision=result.revision;
      automation={publisherState:status.publisherState,checkedAt:status.checkedAt,pendingReasons:[...status.pendingReasons]};
      storage={state:savedState,message:savedMessage(revision)};
      if(revision===journalDomain.JOURNAL_LIMITS.events)pauseForCapacity();
    }catch{
      automation={publisherState:'unavailable',checkedAt:null,pendingReasons:['observation_not_confirmed']};
      storage={state:'unavailable',message:'The automatic update was not confirmed. The last confirmed history is shown; check journal sync before making changes.'};
      feedback='Automatic journal update unavailable. No publication, fill or price is assumed.';
    }finally{busy=false;changed();}
  }
  async function load({reconcile=false}={}) {
    if(busy)return;if(pendingImport){feedback='Apply or cancel the reviewed backup before checking sync again.';changed();return;}busy=true;loadState='loading';changed();
    try{
      const result=await store.load();
      if(!result.ok){
        if(result.error==='authentication_required'){loadState='owner_only';storage={state:'unavailable',message:ownerOnlyMessage};return;}
        loadState='unavailable';storage={state:'unavailable',message:`Private journal unavailable: ${errors(result)}.`};return;
      }
      const remote=result.journal;
      const restoreBaseMatches=uncertainRestore&&(uncertainRestore.base===null?saved===null:saved&&canonical(saved)===canonical(uncertainRestore.base));
      const recoveredRestore=reconcile&&restoreBaseMatches&&remote&&journalDomain.checkAppendOnly(uncertainRestore.candidate,remote).ok;
      const restoreConflict=restoreBaseMatches&&!recoveredRestore&&canonical(remote)!==canonical(uncertainRestore.base);
      if(restoreConflict||(saved&&(!remote||!journalDomain.checkAppendOnly(saved,remote).ok)&&!recoveredRestore)){
        loadState='ready';
        storage={state:'conflict',message:'The server history does not extend the last confirmed journal. Your local history is still available to export; check sync again before making changes.'};
        automation={publisherState:'unavailable',checkedAt:null,pendingReasons:['journal_history_conflict']};
        feedback='Saved history changed unexpectedly. No local history was replaced.';return;
      }
      if(recoveredRestore){uncertainRestore=null;unsyncedDraft=null;}
      if(!unsyncedDraft)needsSetup=remote===null;
      if(reconcile&&unsyncedDraft){
        // Preserve an uncertain local append and require a preview before merging.
        const exported=await journalDomain.exportJournal(unsyncedDraft);
        const base=remote||journalDomain.createJournal({journalId:unsyncedDraft.journalId,at:unsyncedDraft.createdAt});
        const reviewed=exported.ok?await journalDomain.previewImport(base,exported.text):exported;
        saved=remote;revision=result.revision;
        if(reviewed.ok&&reviewed.preview.canApply){
          draft=base;pendingImport={kind:'reconcile',preview:reviewed.preview,message:`Reconcile ${reviewed.preview.additions.length} unsynced event(s) with revision ${revision}. Existing history stays intact.`};feedback='Review the reconciliation before applying it.';
        }else{loadState='ready';storage={state:'conflict',message:'The remote history conflicts with this draft. Export the draft; existing records will not be overwritten.'};feedback=errors(reviewed);return;}
      }else{saved=remote;draft=remote||journalDomain.createJournal({journalId:id('journal'),at:now()});revision=result.revision;}
      if(!pendingImport)feedback=null;
      storage={state:savedState,message:remote?savedMessage(revision):'Connected. Choose automatic journaling or restore a backup before the first record is created.'};loadState='ready';
      if(!pendingImport&&!unsyncedDraft&&(revision===journalDomain.JOURNAL_LIMITS.events||capacityRevision===revision))pauseForCapacity();
    }catch{loadState='unavailable';storage={state:'unavailable',message:'The saved journal could not be read. No records are assumed.'};}
    finally{busy=false;changed();}
    if(!pendingImport)await assess();
  }
  function journalHTML(){
    const controls=`<div class="desk-actions"><button type="button" class="desk-button desk-button-secondary" data-journal-action="sync"${busy?' disabled':''}>${busy?'Working…':'Check journal sync'}</button></div>`;
    if(!draft)return `<section class="card desk-panel desk-empty"><h2>${loadState==='loading'?'Loading the journal':loadState==='owner_only'?'Owner-only journal':'Journal unavailable'}</h2><p>${escape(storage.message)}</p>${controls}</section>`;
    const setup=needsSetup?'<section class="card desk-panel"><h2>Start your private journal</h2><p>Record assessments automatically while this app is open. Paper trading will remain unavailable until reviewed publication and price inputs are connected. If you have a backup, review it in Backup &amp; restore first. This choice is needed only for an empty cloud journal.</p><button type="button" class="desk-button" data-journal-action="start">Start automatic journal</button></section>':'';
    return `${setup}${controls}${renderJournalView(viewModel(),{feedback,automation,importPreview:pendingImport&&!busy?{message:pendingImport.message}:null})}`;
  }
  // Stock-card navigation uses the same company roster as the Prices selector.
  // It selects local view state only; loading the vendor chart remains explicit.
  function selectPriceSymbol(next){
    if(typeof next!=='string'||!companies.some(([ticker])=>ticker===next))return false;
    priceImportRun++;symbol=next;chartFrame=null;requestedChart=null;priceFeedback=null;
    return true;
  }
  function priceModel(){const selected=series.find(item=>item.symbol===symbol)||null;return selected?buildPriceView(selected,{at:now(),rangeSessions,benchmark:symbol==='SPY'?undefined:series.find(item=>item.symbol==='SPY')}):null;}
  const priceStatus=model=>JSON.stringify([model?.status,model?.freshness?.captureStatus,model?.freshness?.sessionStatus,model?.freshness?.expectedLatestSession]);
  async function observe(){const current=priceStatus(priceModel());if(lastPriceStatus!==null&&current!==lastPriceStatus){lastPriceStatus=current;changed();}await assess();}
  function pricesHTML(){
    const model=priceModel();lastPriceStatus=priceStatus(model);
    const options=companies.map(([symbol,label])=>({symbol,label:`${symbol} · ${label}`}));
    for(const item of series)if(!options.some(option=>option.symbol===item.symbol))options.push({symbol:item.symbol,label:`${item.symbol} · imported`});
    return renderPriceView(model,{symbol,rangeSessions,symbolOptions:options,hosted:{status:requestedChart===symbol?'requested':'idle',url:hostedChartURL(symbol),symbol},feedback:priceFeedback,priceSetup:priceSetup.state()})+'<p class="desk-muted">Imported price data stays in this tab. The hosted chart is display-only; it does not supply prices to paper accounting.</p>';
  }
  function mount(view){
    if(view!=='prices'||requestedChart!==symbol)return;
    const container=doc.querySelector('#hosted-price-chart');if(!container)return;
    // A removed iframe loses its browsing context. A newly rendered container
    // gets a fresh frame; unchanged views keep the connected frame untouched.
    try{if(!chartFrame||chartFrame.parentElement!==container){chartFrame=createHostedChartFrame(symbol,{document:doc});container.replaceChildren(chartFrame);}}
    catch{requestedChart=null;chartFrame=null;priceFeedback='The hosted chart could not open here. Use the TradingView link.';changed();}
  }
  async function exportBackup(){
    if(!draft){feedback='No journal is available to export.';changed();return;}
    const result=await journalDomain.exportJournal(unsyncedDraft||draft);if(!result.ok){feedback=errors(result);changed();return;}
    const url=URL.createObjectURL(new Blob([result.text],{type:'application/json'})),anchor=doc.createElement('a');anchor.href=url;anchor.download=result.filename;doc.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback='Journal backup exported with its original events and revision history.';changed();
  }
  async function action(name,target){
    if(name==='sync'){await load({reconcile:true});return;}
    if(name==='export'){await exportBackup();return;}
    if(name==='cancel-import'){if(busy){feedback='A journal operation is still in progress.';changed();return;}if(!pendingImport)return;if(pendingImport.kind==='reconcile'&&unsyncedDraft){draft=unsyncedDraft;storage={state:'conflict',message:'Your unsynced draft remains in this tab. Export it or retry reconciliation before closing.'};}pendingImport=null;feedback='Backup review cancelled.';changed();return;}
    if(name==='show-all'){changed();return;}
    if(!safeAction(name==='confirm-import'))return;busy=true;
    try{
      if(name==='start'){
        if(!needsSetup){feedback='Automatic journaling is already enabled.';return;}
        if((await commit(draft)).ok){needsSetup=false;feedback='Automatic journaling is enabled. Assessments update while the app is open.';}
      }else if(name==='confirm-import'){
        if(!pendingImport){feedback='Review a backup before applying it.';return;}
        changed();
        const result=await journalDomain.applyImport(draft,pendingImport.preview);pendingImport=null;
        if(!result.ok){feedback=errors(result);return;}
        const savedResult=await commit(result.journal,{mode:result.mode,imported:true});if(savedResult.ok){needsSetup=false;feedback='Reviewed backup saved. Existing records and original decision context remain intact.';}
      }else if(name==='confirm-actual'){
        const result=await journalDomain.recordActualConfirmation(draft,{id:id('actual-confirmation'),at:now(),intentId:target.dataset.journalId,confirmed:true});
        if(!result.ok){feedback=errors(result);return;}
        if((await commit(result.journal)).ok)feedback='Your actual-trade confirmation was saved. Fill quantities and prices remain unknown until you supply them.';
      }
    }catch{feedback='The action could not be completed. Existing records remain intact.';}finally{busy=false;changed();}
    if(!needsSetup&&!pendingImport)await assess();
  }
  function formSettings(form){
    const data=new FormData(form),slippage=asText(data.get('slippageBps'));
    // Field edits only need the latest assumptions, not a full history/P&L projection.
    let current=journalDomain.DEFAULT_PAPER_SETTINGS;
    for(let index=draft.events.length-1;index>=0;index--)if(draft.events[index].kind==='settings'){current=draft.events[index].data.settings;break;}
    const settings={...current,paperNotional:asText(data.get('paperNotional')),commissionPerFill:asText(data.get('commissionPerFill')),slippageBps:slippage===''?NaN:Number(slippage),benchmarkSymbol:asText(data.get('benchmarkSymbol')).toUpperCase(),currency:'USD'};
    if(settings.benchmarkSymbol!==current.benchmarkSymbol)settings.benchmarkEntityId=null;
    return settings;
  }
  function showFieldErrors(form,names,fieldErrors,{focus=false}={}){
    let first=null;
    for(const name of names){
      const field=form.querySelector?.(`[name="${name}"]`);if(!field)continue;
      const errorId=`${field.id}-error`,message=form.querySelector(`[id="${errorId}"]`);if(!message)continue;
      const problem=fieldErrors[name],descriptions=(field.getAttribute('aria-describedby')||'').split(/\s+/).filter(value=>value&&value!==errorId);
      message.textContent=problem||'';
      if(problem){field.setAttribute('aria-invalid','true');descriptions.push(errorId);message.removeAttribute('hidden');first=first||field;}
      else{field.removeAttribute('aria-invalid');message.setAttribute('hidden','');}
      if(descriptions.length)field.setAttribute('aria-describedby',descriptions.join(' '));else field.removeAttribute('aria-describedby');
    }
    if(focus&&first){const disclosure=form.closest('details');if(disclosure)disclosure.open=true;first.focus();}
  }
  const showSettingsErrors=(form,errors,options)=>showFieldErrors(form,['paperNotional','commissionPerFill','slippageBps','benchmarkSymbol'],errors,options);
  const showFillErrors=(form,errors,options)=>showFieldErrors(form,['side','occurredAt','quantity','price','fee','reason'],errors,options);
  function formFill(form){
    const data=new FormData(form);let occurredAt=null;
    try{occurredAt=actualFillTime(asText(data.get('occurredAt')));}catch{}
    const fill={side:asText(data.get('side')),occurredAt,quantity:asText(data.get('quantity')),price:asText(data.get('price')),fee:asText(data.get('fee')),currency:asText(data.get('currency'))};
    const reason=asText(data.get('reason'));
    return {fill,reason,validation:journalDomain.validateActualFillFields(fill,{requiresReason:form.dataset.journalForm==='revise-fill',reason})};
  }
  const settingsInput=event=>{
    const form=event.target.closest?.('[data-journal-form="settings"]');
    if(form?.dataset.settingsValidated==='true')showSettingsErrors(form,journalDomain.validatePaperSettings(formSettings(form)).fieldErrors);
    const fillForm=event.target.closest?.('[data-journal-form="save-fill"],[data-journal-form="revise-fill"]');
    if(fillForm?.dataset.fillValidated==='true')showFillErrors(fillForm,formFill(fillForm).validation.fieldErrors);
  };
  async function submit(form){
    const data=new FormData(form),kind=form.dataset.journalForm||form.dataset.priceForm,editVersion=form.dataset.deskEditVersion;
    // Keep rejected or pending input, and never discard newer edits on success.
    form.dataset.deskDirty='true';
    const accepted=()=>{if(form.dataset.deskEditVersion===editVersion)form.dataset.deskDirty='false';};
    if(form.dataset.priceForm){
      const run=++priceImportRun;
      try{
        if(kind==='selection'){
          const next=asText(data.get('symbol'));if(!companies.some(([ticker])=>ticker===next)&&!series.some(item=>item.symbol===next))throw Error('Choose an available company.');
          const range=data.get('rangeSessions');if(!['20','60','120','all'].includes(range))throw Error('Choose an available history range.');
          if(next!==symbol){chartFrame=null;requestedChart=null;}symbol=next;rangeSessions=range==='all'?'all':Number(range);priceFeedback=null;accepted();
        }else if(kind==='import'){
          const file=data.get('file');if(!file||file.size>2_097_152||typeof file.text!=='function')throw Error('Choose a JSON price file under 2 MiB.');
          const raw=await file.text();if(run!==priceImportRun)return;
          const result=parsePriceImport(raw,{at:now(),format:'json'});
          if(!['ready','partial'].includes(result.status)||!result.series?.length)throw Error((result.issues||['Invalid price import.']).join(', ').replaceAll('_',' '));
          series=result.series;symbol=series[0].symbol;chartFrame=null;requestedChart=null;priceFeedback=`Imported ${series.length} daily series for chart context. These values are unreviewed and cannot supply paper marks.`;accepted();
        }
      }catch(error){if(run!==priceImportRun)return;priceFeedback=error.message||'Price input could not be read. Previous data is retained.';}changed();return;
    }
    if(!safeAction())return;
    if(needsSetup&&kind!=='import'){feedback='Start automatic journaling or restore a backup before changing assumptions.';changed();return;}
    busy=true;
    try{
      if(kind==='import'){
        const file=data.get('file');if(!file||file.size>8_000_000||typeof file.text!=='function')throw Error('Choose a JSON journal backup under 8 MB.');
        const raw=await file.text();let result=await journalDomain.previewImport(draft,raw);
        if(!result.ok&&draft.revision===0)result=await journalDomain.previewImport(draft,raw,{mode:'restore'});
        if(!result.ok||!result.preview.canApply){feedback=`Backup cannot be applied: ${errors(result.ok?{errors:result.preview.conflicts}:result)}.`;return;}
        pendingImport={kind:'backup',preview:result.preview,message:`${result.preview.additions.length} new event(s), ${result.preview.duplicates.length} unchanged duplicate(s), ${result.preview.conflicts.length} conflicts.${result.preview.adoptsJournalIdentity?' This restores the backup’s journal identity into the empty journal.':''} Original publication records need server authority before they can be accepted.`};feedback=null;accepted();return;
      }
      let result;
      if(kind==='settings'){
        const settings=formSettings(form),validation=journalDomain.validatePaperSettings(settings);
        form.dataset.settingsValidated='true';showSettingsErrors(form,validation.fieldErrors,{focus:!validation.ok});
        if(!validation.ok){feedback=`Nothing saved: ${errors(validation)}. Check the highlighted paper assumptions.`;return;}
        result=await journalDomain.appendSettings(draft,{id:id('settings'),at:now(),settings});
      }else if(kind==='save-fill'||kind==='revise-fill'){
        const {fill,reason,validation}=formFill(form);
        form.dataset.fillValidated='true';showFillErrors(form,validation.fieldErrors,{focus:!validation.ok});
        if(!validation.ok){feedback=`Nothing saved: ${errors(validation)}. Check the highlighted fill details.`;return;}
        result=kind==='save-fill'?await journalDomain.recordActualFill(draft,{id:id('actual-fill'),at:now(),intentId:form.dataset.journalId,...fill}):await journalDomain.reviseActualFill(draft,{id:id('fill-revision'),at:now(),fillId:form.dataset.journalFillId,replacement:fill,reason});
        if(!result.ok){
          const contextualErrors={};
          if(result.errors?.includes('future_or_prepublication_actual_fill'))contextualErrors.occurredAt='Use a fill time at or after publication and no later than this record.';
          if(result.errors?.includes('oversell'))contextualErrors.quantity='The sell quantity exceeds the recorded shares available at that time.';
          showFillErrors(form,contextualErrors,{focus:true});
        }
      }else throw Error('This form is unavailable.');
      if(!result.ok){feedback=`Nothing saved: ${errors(result)}.`;return;}
      pendingForm={journalId:result.journal.journalId,createdAt:result.journal.createdAt,events:result.journal.events.slice(draft.events.length),accepted};
      if((await commit(result.journal)).ok){pendingImport=null;feedback=kind==='settings'?'Paper assumptions saved for future intents. Existing decisions retain their original settings.':'Reported fill saved as an append-only record. Valuation still requires verified action coverage and prices.';}
    }catch(error){feedback=error.message||'The form could not be saved.';}finally{busy=false;changed();}
  }
  const click=event=>{
    const setupTarget=event.target.closest?.('[data-price-action="check-setup"]');
    if(setupTarget?.dataset.priceAction==='check-setup'){priceFeedback='';void priceSetup.refresh();return;}
    const target=event.target.closest?.('[data-journal-action]');if(target){void action(target.dataset.journalAction,target);return;}
    if(event.target.closest?.('[data-price-action="load-hosted"]')){if(!hostedChartURL(symbol)){priceFeedback='A hosted chart is not configured for this imported symbol.';}else{requestedChart=symbol;chartFrame=null;priceFeedback='Chart requested. If it stays blank, open the chart at TradingView using the link below. Displayed prices come from TradingView.';}changed();}
  };
  const submitEvent=event=>{const form=event.target.closest?.('[data-journal-form],[data-price-form]');if(form){event.preventDefault();void submit(form);}};
  doc.addEventListener('click',click);doc.addEventListener('submit',submitEvent);doc.addEventListener('input',settingsInput);doc.addEventListener('change',settingsInput);
  return {html:view=>view==='journal'?journalHTML():pricesHTML(),priceSymbols:()=>companies.map(([ticker])=>ticker),selectPriceSymbol,mount,observe,start:load,status:()=>({loadState,busy,storage:{...storage},automation:{...automation,pendingReasons:[...automation.pendingReasons]}}),destroy(){priceSetup.dispose();doc.removeEventListener?.('click',click);doc.removeEventListener?.('submit',submitEvent);doc.removeEventListener?.('input',settingsInput);doc.removeEventListener?.('change',settingsInput);chartFrame=null;}};
}
