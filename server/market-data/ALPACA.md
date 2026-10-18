# Alpaca daily-history adapter and activation boundary

`alpaca-daily.mjs` is a server-only candidate collector. It makes no request when merely imported or inspected. Nothing here obtains a key, opens an account, accepts terms, subscribes, trades, persists prices or installs a schedule. Tests use synthetic transport responses and synthetic rights records only. No production stock prices were captured for this implementation.

## Safe status contract

```js
inspectAlpacaSetup({
  credentials: { keyId, secretKey }, // ephemeral server-secret inputs
  authorization,                 // trusted, server-owned review below
  at                             // actual UTC inspection clock
})
// {
//   ok: false,
//   status: 'setup_required', // or 'configured_unverified'
//   provider: 'alpaca', dataset: 'historical-stock-bars', feed: 'sip',
//   reasons: ['credentials_missing_or_invalid', 'rights_review_missing'],
//   connectionVerified: false,
//   eligibleForRanking: false, paperMarksEligible: false, automaticTrading: false
// }
```

This result is suitable for an authenticated status-only UI. It never returns credentials, supplied review IDs, terms evidence, prices or provider error bodies. `configured_unverified` means the configuration passed structural checks; it does not claim a successful connection or actual permission. No price fetch follows the status check automatically.

The host injects the credentials and review from its supported private secret/configuration mechanism. This module does not read environment variables or search for secrets. Never accept either object from browser request JSON, a chart import or a journal payload. Never put keys in URLs, command arguments, logs, public assets, tests or repository files. The host must preserve the existing owner scope and authenticate any future capture action separately.

## Trusted authorization record

No real record is supplied. Fields below describe the required shape; they are not a grant or an approval template to fill with invented evidence.

| Field | Required meaning |
| --- | --- |
| `schemaVersion` | `cribscore-alpaca-rights-v1` |
| `provider`, `dataset`, `feed` | `alpaca`, `historical-stock-bars`, `sip` |
| `approved`, `reviewId` | An affirmative server-owned review and its retained evidence identity |
| `reviewedAt`, `expiresAt` | Exact UTC validity interval, checked at actual request start and completion |
| `operations` | Explicit `fetch` and `normalize` permissions; no implicit additional operations |
| `audience` | `owner_private` |
| `terms` | `{url, sha256, evidenceId, reviewedAt}` identifying the actually reviewed Alpaca Terms PDF; no made-up digest or version |
| `sourceRights` | `{approved:true, providerAndExchangeTermsReviewed:true, scope:'delayed_sip_historical_personal_research', evidenceId, reviewedAt, expiresAt}`; evidence must establish applicable provider and underlying-source terms for this exact use |
| `entitlement` | `{active:true, delayedSipHistorical:true, evidenceId, reviewedAt, expiresAt}`; account-specific evidence, not a pricing-page inference |

`terms.url` is the official PDF linked by the provider: https://files.alpaca.markets/disclosures/library/TermsAndConditions.pdf . Re-review current documents before activation. The code validates the attestation's shape and time bounds; it cannot authenticate the evidence or decide a user's subscriber classification. This scope is deliberately limited to private research. Provider documentation of free historical access does not establish that a particular account or hosted use is entitled.

`inspectAlpacaAuthorization(review,{at,operation})` supports only `fetch` and `normalize`. `persist_source`, `display_source`, derived-output operations and `paper_marks` fail as unsupported. Separate rights reviews and host enforcement are required before retaining a captured response, returning prices to a browser, generating retained derivatives or publishing them. A private audience alone does not satisfy those reviews. Account creation, any required agreement acceptance and secret provisioning belong to the user; none occurred in this lane.

## Request and capture contract

```js
await fetchAlpacaDailyBars({
  request: {
    symbols: ['TEST'], feed: 'sip', timeframe: '1Day', adjustment: 'raw',
    asof: 'YYYY-MM-DD', currency: 'USD', start: 'UTC', end: 'UTC',
    // pageToken: 'provider continuation token' // omit on the first page
  },
  security: {
    symbol: 'TEST', originalSymbol: 'TEST', entityId: 'independently-reconciled-ID',
    currency: 'USD', exchange: 'exchange-name', sessionTimezone: 'America/New_York'
  },
  captureId, credentials, authorization, at,
  // fetchImpl and clock are injectable for isolated tests.
});
```

`TEST` is a schema placeholder, not an observed security or recommendation. This transport supports a single stock symbol, raw USD daily bars, explicit dated symbol mapping and a maximum 3,660-day request interval. It fixes `limit=5000` and `sort=asc`. The only destination is `https://data.alpaca.markets/v2/stocks/bars`. It never falls back to IEX, latest quotes, another vendor or a prior close. The source `asof` mapping is retained but does not independently establish permanent identity.

Every page has a 20-second abort signal, a 2 MB streamed response limit, strict UTF-8 decoding and a duplicate-key/depth-bounded JSON parser. Original numeric OHLC tokens retain their decimal spelling; unsupported exponents or excess precision fail instead of rounding into financial evidence. Exact source-byte SHA-256 includes original whitespace and any UTF-8 BOM. Source publication and ingestion clocks remain unknown; capture clocks are the actual request/response times.

Server-owned request, security, review and credential records are snapshotted before validation and asynchronous work. Validation and URL construction use the same copied values. Uncloneable records or throwing accessors return a bounded `capture_context_invalid` result without a request; raw exception text is not exposed. Supply ordinary data records: structured cloning can invoke an accessor while copying and is not a sandbox for caller code. The history wrapper retains its `collection_context_invalid` result for an invalid initial snapshot.

HTTP 401/403 return setup-required states. HTTP 429, redirects, transport/read failures and other HTTP failures stop without retries. Rejected response status, URL, content type and declared length trigger best-effort cancellation of the unread body; cancellation is never awaited and does not replace the bounded failure reason. The collector does not interpret error text, follow redirects, refresh credentials or sleep on `Retry-After`. A separately authorized job controls future attempts and backoff; it must not spin on these results.

Success returns `status:'captured_unvalidated'`, a canonical series and private capture metadata. `identityReconciled:false`, `calendarCoverage:'unverified'`, `corporateActionCoverage:'unverified'`, `accessVerified:false`, `paperMarksEligible:false` and `eligibleForRanking:false` remain explicit. A response with no bars remains empty; a missing volume remains missing. A recent retrieval is not evidence that the latest required exchange session is present. No stale-session fill, current price, expected return or probability is invented.

## Pagination and completeness

`fetchAlpacaDailyHistory(options)` starts at the first page and follows continuation tokens sequentially. Optional `maxPages` is 1–8 (default 8); `maxResponseBytes` is 1–8,000,000 (default 8,000,000). The collection stops on missing token metadata, token cycles, empty continuing pages, repeated/out-of-order sessions, clock regression, expiry, transport failure or either bound. Failure returns no partial page data. At most eight requests are made; the 20-second deadlines cover each page's fetch and body reads. Their combined transport allowance is at most approximately 160 seconds, plus local parsing, hashing and normalization time; this is not a total wall-clock deadline for the job. The host must use a compatible job budget. There are no automatic retries.

The aggregate byte budget is checked before requesting another page and tightens that page's streamed-body allocation and limit to the remaining budget. An exhausted budget prevents another authenticated request; an oversized declared length or incoming chunk stops that page before parsing or hashing it. Cancellation is best effort and never delays the failure result. The bound covers accepted response-body bytes, not network wire bytes or all JavaScript heap overhead: a stream may deliver one oversized chunk before it can be rejected, and the runtime controls network buffering and decompression. The collector does not retain raw responses; returning page hashes is not durable source retention.

A complete one-page result exposes its canonical series. A complete multi-page result is `capture_set_unvalidated`, with `series:null`, `capture:null`, `pages` retaining each exact response hash and `requiresCaptureSetReview:true`. Collection `pagination.complete` means that all provider continuation pages were visited. It does not prove calendar/session, corporate-action or security coverage. Individual suffix series retain `source.paginationComplete:false`. The current price domain has one exact raw-response hash per series; the collector never places combined bars under a last-page hash or a fabricated aggregate response hash. A future host-ledger capture-set contract and review must bind all pages before multi-page prices can become authoritative series.

## Daily timing and the specified horizons

Alpaca documents stock-history authentication, SIP history ending at least 15 minutes before request time for access without a real-time SIP subscription, and New York daily timestamp aggregation. Daily timestamps label aggregation dates, not observation/publication clocks. The documented trade-condition rules omit extended-hours trades from daily O/C while including their volume; these bars are not official auction executions. [API overview](https://docs.alpaca.markets/us/docs/about-market-data-api), [market-data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq), [historical bars](https://docs.alpaca.markets/us/reference/stockbars).

The collector requires an explicit end at least 15 minutes before actual request start. It also conservatively requires the end's New York date to precede the request's New York date. This prevents a still-forming daily bar captured earlier in a session from later masquerading as a completed close. A future calendar-aware same-day-finalization implementation requires its own review; this version deliberately waits until the next New York date.

The research entry remains October 19, 2026 at 13:30 UTC; day exit is October 19 at 20:00 UTC; week exit is October 23 at 20:00 UTC. This adapter cannot supply an observed entry price before entry, and its daily reference cannot settle at the opening instant. For requests ending at the end of the entire New York date, normal retrieval is after approximately 04:15 UTC the next day in October. Thus the Monday references can be collected Tuesday, October 20; Friday references can be collected Saturday, October 24. These are conservative collection timings, not an announced provider SLA. Unscheduled closures, halts, corrections, identity changes and missing actions remain separate checks. The October 16 close never substitutes for the October 19 open; no pre-entry gap enters paper returns.

A host must independently retain permitted source bytes, establish identity and complete exchange-calendar/action coverage, assign ingestion provenance, and bind reviewed prices to immutable publications and frozen windows. Stock and benchmark require the same evidence. This adapter is not `readReviewedPrices`, and importing it does not install that observer reader.

## Connection probe

`alpaca-probe.mjs` answers `POST /api/market-data/probe` for the signed-in owner. The route requires the platform identity header, a same-origin JSON request and no query string, like the journal writes. The request body is never read. The probe always asks for `SPY` over the most recent completed New York day the transport accepts, computed from the server clock: the previous New York date, or the one before it during the first fifteen minutes after New York midnight. Credentials and the rights review come from the same runtime values the setup check reads.

The response is a bounded envelope: `{ok:true, checkedAt, provider:{id:'alpaca', probe, httpStatus, reasons, barsReturned, responseSha256}}`. `probe` is `setup_required` when configuration is missing and no request was made, `succeeded` when the transport returned a valid page, and `failed` otherwise. `httpStatus` is the observed provider status, or `null` when no response arrived. `reasons` holds the transport's machine codes. Credentials, provider bodies and error text never appear. A weekend or holiday returns `barsReturned: 0` with `probe: 'succeeded'`; that demonstrates authentication and transport, not data coverage.

The probe persists nothing and changes no status. `captureEnabled`, `displayEnabled` and `journalPricesEnabled` stay off and the setup check is unaffected. The transport's 20-second deadline and 2 MB response bound apply. The security mapping passed to the transport uses the labels `probe-unreconciled` and `unverified`; the resulting series is discarded. One probe per owner per sixty seconds is admitted through an in-memory map. That guard is best effort within one Worker instance, not a durable quota.
