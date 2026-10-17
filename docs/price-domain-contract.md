# Price domain contract (proposal)

Pure functions only: no network, persistence, clocks generated from the computer, provider activation, trading or ranking. Root supplies a lawful retained endpoint and real capture separately. Manual imports are local chart context and cannot claim a verified capture by changing JSON fields.

## Canonical daily series

```js
{
  schemaVersion: 'cribscore-price-series-v1', id: 'capture-series-id',
  entityId: 'permanent-security-id-or-null', originalSymbol: 'IBM',
  symbol: 'IBM', currency: 'USD', exchange: 'NYSE',
  sessionTimezone: 'America/New_York', interval: '1d',
  priceBasis: 'unadjusted', // unadjusted | split_adjusted | total_return_adjusted | unknown
  volumeBasis: 'shares', // shares | split_adjusted_shares | unknown
  source: {
    provider: 'provider-name', dataset: 'dataset-name', url: 'https://exact-source',
    capturedAt: 'actual UTC retrieval time or null', publishedAt: null,
    responseSha256: 'exact raw-response digest or null',
    channel: 'manual_import', // retained_capture only from a separate host capture path
    declaredDelayMinutes: null, // unknown is not zero; daily history is never live quotes
    priceSession: 'unknown' // regular_daily_aggregate only with supported source semantics
  },
  bars: [{session:'YYYY-MM-DD', open:'1.00', high:'1.10', low:'0.90', close:'1.05', volume:100}],
  actions: {
    status: 'unknown', // unknown | partial | complete
    fromSession: null, throughSession: null,
    source: {url:null,capturedAt:null,responseSha256:null},
    items: []
  }
}
```

The example numbers are schema placeholders, not market observations. OHLC values accept finite numbers or ordinary decimal strings; normalized chart values are numbers with preserved canonical decimal strings for mark validation. Re-normalization validates each numeric/exact-string pair and keeps the exact string. OHLC ordering is checked in exact decimal units, including values whose numeric chart projections are indistinguishable. `volume:null` is explicit missing data. Session labels are exchange dates and are never promoted to quote timestamps. An optional bar `availableAt` must be an exact UTC clock at or before the source capture. Absent bar availability uses the actual source capture; only when that is absent can an explicitly supplied actual publication clock be used. No publication clock is invented.

`normalizePriceSeries(input,{at})` returns `{status:'ready'|'partial'|'invalid'|'missing',series,issues,warnings,eligibleForRanking:false,paperMarksEligible:false}`. Invalid bars, duplicate dates, malformed clocks and unsupported metadata invalidate the series; absent capture provenance or volume remains explicit partial chart context.

`parsePriceImport(text,{at,format:'json'|'csv',metadata})` returns `{status,series:[],issues,warnings,...limits}`. JSON accepts a single canonical series or `{schemaVersion:'cribscore-price-import-v1',series:[...]}`. CSV requires a metadata object with the canonical series fields above except bars, and exact header `session,open,high,low,close,volume`; blank volume becomes null. A BOM and standard quoted CSV fields are supported. JSON objects with duplicate decoded member names are rejected, including escaped duplicates; nesting is bounded at 64 levels. Import is bounded and atomic: invalid series do not partially replace a previous local import. All imported source channels are forced to `manual_import`; payload flags cannot grant paper/ranking eligibility.

## Display projection

`buildPriceView(rawSeries,{at,rangeSessions:20|60|120|'all',calendar?,benchmark?})` returns:

```js
{
 status:'available'|'partial'|'unavailable', symbol,currency,sessionTimezone,interval:'1d',
 priceBasis,volumeBasis,
 points:[{session,open,high,low,close,decimals:{open,high,low,close},volume,availableAt,breakBefore,missingSessionsBefore:[],actions:[]}],
 latest:null|{session,close,closeDecimal,availableAt,capturedAt,sessionCloseAt}, source,
 freshness:{captureStatus:'within_policy'|'stale'|'unknown'|'invalid',captureAgeHours,
   sessionStatus:'current_completed_session'|'behind_completed_session'|'calendar_unknown',
   expectedLatestSession,declaredDelayMinutes},
 gaps:{status:'complete'|'incomplete'|'unknown',missingSessions:[]},
 comparison:{status:'available'|'unavailable',reason,benchmarkSymbol,
   points:[{session,targetIndex,benchmarkIndex}],basis},
 issues:[],warnings:[],chartTrust:'manual_import'|'unreviewed_source',
 eligibleForRanking:false,paperMarksEligible:false
}
```

Each displayed point carries an independent copy of the canonical OHLC decimal strings in `decimals`; `latest.closeDecimal` carries the exact canonical close string. Use these strings for the daily table and latest-price label without converting them back to numbers. Existing numeric OHLC fields remain approximate plot coordinates; the plot and numeric indexed comparisons must not be labeled exact. These additive display fields do not change accounting, source clocks, eligibility or evaluator version.

It does not authenticate data. A complete calendar enables session-gap detection; there is no weekday guessing. A fresh capture cannot hide a missing completed session. Unadjusted split boundaries and missing sessions break the line. An indexed comparison uses identical sessions, currency and an explicitly compatible basis; it is a descriptive chart, never a prospective journal return. Unknown action coverage prevents raw close-to-close indexed comparisons.

## Verified calendar and paper marks

```js
calendar = {
 id, timeZone, coverageStart:'YYYY-MM-DD', coverageEnd:'YYYY-MM-DD',
 status:'verified_complete', reviewedAt:'UTC',
 source:{url:'https://source',capturedAt:'UTC',responseSha256:'64 lowercase hex'},
 sessions:[{date:'YYYY-MM-DD',openAt:'UTC',closeAt:'UTC'}]
}
```

The host review must establish that the exact sessions cover the interval, including holidays and early closes. Shape validation is not authentication. No session is synthesized. UTC endpoints must map to the stated exchange date in the supplied IANA timezone; sessions must be ordered and non-overlapping.

`resolvePaperWindow({publishedAt,horizonSessions:1|5,calendar,at})` returns `{status:'resolved'|'pending'|'blocked',reasons,window}`. The resolved window is `{calendarId,calendarSha256,timeZone,publishedAt,horizonSessions,entrySession,exitSession,entryAt,exitAt,sessions}`. Entry is the first verified regular open strictly after publication; equality misses that open. The entry session counts as session one. Journal must record an eligible, immutable publication intent **before** entry; unseen suggestions cannot be enrolled retrospectively. The frozen window and calendar identity should be retained by the journal. Later verified bars may settle it.

`resolvePriceMark(series,{session,kind:'open'|'close',calendar,review,window,at})` returns `{status:'available'|'pending'|'blocked',reasons,mark,actions}`. An available mark is `{seriesId,symbol,originalSymbol,entityId,currency,session,kind,eventAt,availableAt,priceTimestamp:null,value,priceBasis:'unadjusted',executionBasis:'daily_bar_paper_reference',source:{provider,dataset,url,capturedAt,responseSha256,priceSession},reviewId}`. Value is a canonical decimal **string** with no more than six fractional places; unsupported precision blocks paper accounting. `eventAt` is the exact calendar open/close reference; `availableAt` is the separate actual observation clock. It does not assert a transaction occurred at that instant. Daily O/C are hypothetical paper references, not guaranteed auction executions; journal must use its declared slippage/fee convention. Journal must compare permanent `entityId` to the frozen publication, not just a reusable ticker. A daily final bar is only usable after its regular close. Delayed arrival produces pending, never a previous-close substitute.

Review fields bind the mark to a separately reviewed retained capture: `{id,status:'verified',allowedUse:'paper_marks',seriesId,symbol,entityId,currency,sessionTimezone,provider,dataset,sourceUrl,capturedAt,responseSha256,priceBasis:'unadjusted',priceSession:'regular_daily_aggregate',actionsSha256,reviewedAt}`. Paper marks require an affirmative `source.paginationComplete === true`; missing, null, false or non-boolean completeness cannot satisfy this path. A manual import, unknown provenance or adjusted series cannot satisfy this path. The browser cannot independently authenticate a caller-supplied review.

Actions are returned as `{coverage:'verified_complete',fromSession,throughSession,items}` only if the reviewed action source covers frozen entry through the requested mark session. An opening mark needs entry-session coverage; a terminal close requires the full frozen window. Terminal share/cash accounting must use the exit mark’s complete action interval. Each item has `id`, `type:'split'|'cash_dividend'`, `effectiveSession` and a calendar-derived `effectiveAt`. Splits use `splitRatio:{numerator:string,denominator:string}` with positive integer components. Cash dividends use a nonnegative decimal-string `cashPerShare`, `currency`, and explicit `perShareBasis:'post_split'|'current_shares'`. For dividends, `effectiveSession` is the ex-date and `entitlementAt` is its regular open. Entry at that ex-date open gets no entitlement. A same-session split/dividend needs post-split basis; ambiguous actions block accounting. Other action types are unsupported and block the paper path. The journal owns share/cash arithmetic, configured fees and like-for-like benchmark treatment.

The price layer never enrolls a suggestion or turns a historical chart into a fill. A null eligible publisher still abstains. Financial eligibility, empirical forecast validity, automatic trading and background refresh remain separate.

## Alpaca offline response adapter

`adaptAlpacaDailyBars(body,{request,capture,security,at})` parses a retained multi-symbol daily response; it never sends a request or reads credentials. Request fields are explicit `symbols`, `feed:'sip'`, `timeframe:'1Day'`, `adjustment`, `asof`, `currency`, and UTC `start`/`end`. Capture fields are `id`, exact `url`, `requestStartedAt`, `capturedAt`, and `responseSha256`. Security fields are `symbol`, `originalSymbol`, `entityId`, `currency`, `exchange` and `sessionTimezone:'America/New_York'`. The exact URL query must match the declared request.

The adapter preserves symbol mapping, raw provider timestamps and pagination incompleteness. A daily timestamp labels the New York aggregation date. It is never assigned as the publication clock. Only raw and split-only adjustments have directly named price bases here; dividend/spin-off/all combinations retain their request description with unknown normalized basis rather than claiming total return. [Historical bars reference](https://docs.alpaca.markets/us/reference/stockbars).

The explicit SIP historical end must be at least fifteen minutes before request start. This check does not prove account permission. The daily trade-condition rules exclude extended-hours trades from O/C while including their volume, and do not make daily O/C an official auction fill. The adapter labels regular daily aggregates separately from daily volume scope. [Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq).

No account, credential, real bar, corporate-action response or entitlement was obtained. A final response page fetched with a page token is still partial history; a missing token field cannot certify completeness. Corporate actions remain unknown until separately captured and reviewed; a bars response cannot establish no-actions coverage. [Corporate actions reference](https://docs.alpaca.markets/us/v1.1/reference/corporateactions-1).

## QA follow-up version

`PRICE_EVALUATOR_VERSION` is now `price-domain-v1.1`. The version records stricter completeness and exact-decimal validation. Function signatures and chart status/field names are unchanged. Earlier source records, capture receipts and proposal seals are preserved.

## Persisted window comparison

`PRICE_EVALUATOR_VERSION` is `price-domain-v1.2`. The frozen window is compared structurally to the verified calendar resolution: JSON object-key order is irrelevant, while array positions, exact field names, value types and values remain significant. A canonical serializer may reorder session object keys without invalidating a window. Missing or extra fields, reordered sessions, altered times or a changed calendar digest are rejected. This fixes persistence roundtrips without changing prices, accounting, source clocks or the calendar-selection policy.
