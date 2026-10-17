// Entirely synthetic: neither the security, trading calendar, quotes nor rights
// below are production data or permission. No fixture is imported by the app.
export function fixture() {
  const sessions = [];
  for (let d = Date.parse('2026-07-01T00:00:00Z'); d <= Date.parse('2026-10-21T00:00:00Z'); d += 86400000) {
    const date = new Date(d), session = date.toISOString().slice(0,10);
    if (![0,6].includes(date.getUTCDay())) sessions.push({date:session,openAt:`${session}T13:30:00Z`,closeAt:`${session}T20:00:00Z`});
  }
  const expected = sessions.filter(s => s.date <= '2026-10-16').slice(-60);
  const policy = {id:'SYNTHETIC-policy',providerId:'SYNTHETIC-provider',datasetId:'SYNTHETIC-daily',securityId:'SYNTHETIC-permanent-1',calendarId:'SYNTHETIC-calendar',exchange:'SYNTHETIC',cik:'0000000001',shareClass:'common',currency:'USD',audience:'owner_private',sourceUrl:'https://quotes.example.invalid/daily',actionsUrl:'https://quotes.example.invalid/actions',requiredSessions:60,maxCheckAgeMs:86400000,maxTermsAgeMs:86400000};
  const review = {id:'SYNTHETIC-rights',version:1,reviewedAt:'2026-10-01T08:00:00Z',validFrom:'2026-10-01T08:00:00Z',expiresAt:'2026-10-21T23:00:00Z',providerId:policy.providerId,datasetId:policy.datasetId,audience:'owner_private',purpose:'market_data_research',securityIds:[policy.securityId],urls:[policy.sourceUrl,policy.actionsUrl],operations:Object.fromEntries(['fetch','store','transform','display','derive','derived_display'].map(op=>[op,'allowed'])),termsEvidence:[{url:'https://quotes.example.invalid/terms',sha256:'f'.repeat(64),observedAt:'2026-10-01T07:55:00Z'}]};
  const snapshot = {id:'SYNTHETIC-snapshot-1',providerId:policy.providerId,datasetId:policy.datasetId,priceSession:'2026-10-16',
    security:{id:policy.securityId,cik:'0000000001',ticker:'SYNTHETIC',exchange:'SYNTHETIC',shareClass:'common',instrumentType:'common_equity',currency:'USD',validFrom:'2020-01-01',validThrough:'2026-12-31'},
    source:{url:policy.sourceUrl,sha256:'a'.repeat(64),version:'SYNTHETIC-v1',parserVersion:'SYNTHETIC-parser-1',publishedAt:'2026-10-16T20:01:00Z',fetchedAt:'2026-10-17T10:00:00Z',ingestedAt:'2026-10-17T10:00:01Z'},
    basis:{currency:'USD',price:'unadjusted',volume:'reported_shares',coverage:'consolidated',session:'regular'},
    bars:expected.map((s,i)=>({securityId:policy.securityId,session:s.date,open:99+i,high:102+i,low:98+i,close:100+i,volume:100000,providerPublishedAt:`${s.date}T20:01:00Z`,status:'final'})),
    actions:{sourceUrl:policy.actionsUrl,sha256:'b'.repeat(64),version:'SYNTHETIC-v1',securityId:policy.securityId,complete:true,coverageStart:expected[0].date,coverageEnd:'2026-10-16',reviewedAt:'2026-10-17T10:00:00Z',items:[]}
  };
  const options = {at:'2026-10-17T12:00:00Z',cutoffAt:'2026-10-17T11:00:00Z',policy,calendar:{id:policy.calendarId,version:'SYNTHETIC-v1',sha256:'c'.repeat(64),observedAt:'2026-10-01T08:00:00Z',validThrough:'2026-10-21',sessions},rightsReviews:[review]};
  const archive = {revision:0,snapshots:[],runs:[]};
  const event = {runId:'SYNTHETIC-run-1',expectedRevision:0,outcome:'snapshot',startedAt:'2026-10-17T09:59:00Z',checkedAt:'2026-10-17T10:01:00Z',snapshot};
  return {snapshot,options,review,archive,event};
}
