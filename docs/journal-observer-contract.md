# Server journal observation contract

`server/journal/observe.mjs` coordinates the pure journal and price domains. It proposes an append-only journal update. It does not write storage, expose HTTP, authenticate a publisher, schedule a job, execute trades, fetch a network feed, or select readers from request JSON.

The current production publisher is unconfigured. The host can supply its own retained stock snapshots as observation context and record an explicit abstention for each observed horizon. Test publications and prices live only in `tests/fixtures/journal-observer.mjs`; production must never import that module or enable a fixture fallback.

## Host interface

```js
const observer = createJournalObserver({
  readPublications: null,
  readCalendar: null,
  readReviewedPrices: null,
  readObservationContext: null,
  clock: () => new Date().toISOString()
});
const result = await observer.observe({
  journal, requestId, receivedAt, ownerScope
});
```

All readers are server-owned function references, or `null`. The host derives `ownerScope` from authenticated platform identity and `receivedAt` from full request-body receipt. Neither value nor a callback is selected by a client. The request ID is 1–96 characters matching `[A-Za-z0-9][A-Za-z0-9._:-]*`. Timestamps are validated UTC strings with seconds and optional one to three fractional digits.

Success returns `{ok:true, baseRevision, journal, changed, observedAt, automation}`. Failure returns `{ok:false, errors:[code]}` and no replacement journal. `changed` means events were appended. The original journal and its settings, publication bytes, clocks, windows, and events are never rewritten.

`automation` has exactly:

```js
{
  publisherState: 'unconfigured' | 'unavailable' | 'empty' | 'ready',
  checkedAt: observedAt,
  pendingReasons: [/* bounded machine codes */]
}
```

`ready` means publication history was checked and contained records. It is not a claim of current tradability, ranking validity, successful persistence, source freshness, or an open paper position. `empty` means a complete requested archive contained no records. `unavailable` means the source could not be read and must not become a no-pick claim. `unconfigured` means no authoritative reader is configured. `checkedAt` is the server observation clock, never a rewritten source or publication clock.

## Publication reader

The coordinator calls `readPublications` once with:

```js
{ownerScope, at, fromAt: journal.createdAt, throughAt: requestedAt,
 horizonIds: ['next_day', 'next_week'], knownPublicationIds}
```

The reader returns `{status:'unconfigured'}`, `{status:'unavailable'}`, or:

```js
{status:'ready',
 coverage:{fromAt, throughAt, horizonIds:['next_day','next_week'], complete:true},
 publications:[publicationEnvelope]}
```

Coverage must include journal creation through the requested server observation time and both horizons. At most 100 envelopes are accepted per observation. This version has no archive pagination protocol: a larger or incomplete result fails explicitly, so the host must not silently truncate history. New publications are ordered by publication time then ID. Exact duplicates collapse; conflicting bytes for an existing ID reject the whole proposal.

Each publication envelope uses the journal domain contract:

```js
{publicationId, publishedAt, payloadHash, payloadBytes,
 policyVersion, snapshotVersion, horizonId,
 entities:[{symbol, entityId}]}
```

The host must authenticate immutable publication history and validate its full approved slate schema before returning it. A digest, schema label, manual import, current stock card, or `generated_at` does not establish publication authority. `publishedAt` must be the actual publication time. Every published eligible row must be returned, including eventual losers. Previously unseen completed historical suggestions cannot be introduced before the journal's observation scope; a publication active at setup can be retained as no-fill if its entry was already missed.

An existing publication must already have an intent or no-fill for every row. Incomplete preexisting enrollment rejects explicitly. Enrollment identity uses publication ID plus each row's security identity and horizon through the immutable envelope. A repeated complete archive does not create another position.

## Calendar reader

`readCalendar` receives `{ownerScope, at, publications, frozenIntents}`. The publication list includes known and newly observed publications. Each frozen intent includes its ID, saved data and exact original or subsequently resolved window. The reader must retrieve the retained calendar identified by an existing window's `calendarId` and `calendarSha256`; substituting a newer capture is not permitted merely because session dates look equal.

Return an unavailable/unconfigured status, or:

```js
{status:'ready', contexts:[{publicationId, calendar}]}
```

Contexts are unique and refer only to requested publications. Omitted calendar context remains pending. The price domain validates reviewed calendar coverage, exchange timezone, exact UTC opens, holidays, and early closes. It resolves the first regular open strictly after publication, and the first or fifth session close. No weekday arithmetic is used. The resolved window must match the immutable published window before paper evaluation.

## Reviewed-price reader

`readReviewedPrices` receives `{ownerScope, at, publications, currentSettings, frozenIntents}`. Return an unavailable/unconfigured status, or:

```js
{status:'ready', contexts:[{
  publicationId,
  benchmarkIdentities:[{symbol, entityId}],
  seriesBySymbol:{/* symbol: canonical price series */},
  reviewsBySymbol:{/* symbol: trusted paper-source review */}
}]}
```

Only a server-owned reader can supply review and permanent-identity bindings. The actual price-domain resolver verifies them. Manual/chart imports cannot certify fills. The benchmark identity is resolved before each new intent and frozen with its settings. Missing identity stays pending for that intent; a later global setting must not change its comparator. Contradictory explicit identity rejects the proposal.

Marks are final regular daily-bar paper references, not claimed auction executions. Opening references settle only after the daily bar becomes available. Source capture, review, permanent identity, raw price basis, availability, exact calendar window, split coverage, and dividend ex-date entitlement remain enforced by the real price and journal modules. Missing inputs yield null accounting, never zero profit. Delayed evidence may settle an already enrolled intent; it cannot retroactively create an on-time intent. Actual trades and settings are outside this coordinator.

The journal resolver interface currently dispatches marks by exact frozen window and requested symbol. Unrelated symbols are excluded. Multiple applicable contexts must be identical; conflicting source/calendar contexts fail with `ambiguous_price_context` or `ambiguous_calendar_context` instead of guessing. A future reader can return shared retained evidence for equivalent windows.

## Observation context

`readObservationContext({ownerScope, at})` returns at most one context per horizon:

```js
[{horizonId:'next_day' | 'next_week', unrankedCount, snapshot}]
```

The snapshot is immutable JSON saved exactly as supplied by the server. It is observation evidence, not a published eligible suggestion. The coordinator records only the current UTC observation date. It does not invent missed-day or weekend observations. Existing abstentions deduplicate by date and horizon. An unavailable publisher produces no abstention. A publication observed that day or a future-entry publication in the checked archive prevents relabeling that horizon as absent. The other observed horizon can still receive an explicit no-eligible decision.

## Clock, validation, and persistence boundary

The coordinator uses a high-water clock starting at trusted `receivedAt`, sampled after every asynchronous reader and immediately before enrollment. Clock rollback cannot restore a missed entry. If reading crosses the opening boundary, enrollment becomes no-fill. All new event timestamps use the final observation time; original source/publication clocks remain unchanged.

The returned proposal passes the real asynchronous journal validator and append-only prefix check. The persistence host must independently repeat those checks, compare `baseRevision`, and use a compare-and-swap commit. It must sample a final high-water clock after proposal validation and write preparation. If a new intent's entry is at or before that time, reject without writing using `observation_crossed_entry_retry`; a fresh observation then records the missed entry honestly. The observer alone does not prove a durable commit before the deadline.

The host must allow only observer event kinds: `abstain`, `publication`, `paper_intent`, `paper_schedule`, `no_fill`, `duplicate`, `paper_evaluation`, `paper_revision`. No client-selected publication authority or price evidence is accepted. Request IDs identify evaluation attempts; unchanged replay is idempotent through immutable event/state comparison. A reused ID with conflicting changed evidence fails rather than replacing history. Concurrency is resolved by host CAS and a fresh observation, not local last-writer-wins.

`pendingReasons` is sorted, unique, capped at 64 codes matching `[a-z][a-z0-9_:-]{0,119}`. Observer-specific pending codes include `publisher_unavailable`, `publication_reader_unavailable`, `calendar_reader_unavailable`, `price_reader_unavailable`, `calendar_unavailable`, `reviewed_prices_unavailable`, and `benchmark_identity_missing`. Price-domain codes are passed through unchanged; the UI should render unknown codes as a generic incomplete-input state. Reader exception text is not disclosed.

## Offline verification

Run `node --test tests/journal-observer.test.mjs`. Fixtures use synthetic publication bytes, prices, identities and calendars and must remain outside the production dependency graph. The focused cases cover null/empty/unavailable states, every eligible row and horizon, duplicates, asynchronous deadline crossing, clock rollback, holidays, early closes, DST, delayed settlement, missing/unreviewed/action-incomplete bars, equivalent-window source isolation, malformed archive rejection, and frozen benchmark identity. Independent API and domain reviewers verify the same pinned coordinator with the actual journal and price modules.
