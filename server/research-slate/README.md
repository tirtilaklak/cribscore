# Reviewed research-slate contract v2

`research-slate.mjs` is a pure server-only projection using `cribscore_research_slate_v2` and the separate `research_evidence_v0_1_unvalidated` score policy. It cannot fetch, grant source rights, authenticate an owner, validate source assertions, activate a price feed or publish a ranked slate.

The browser rejects v1 payloads. The serializer returns a private `review_required` wrapper and exact proposed bytes; those bytes require separate current output approval and an authenticated delivery service. The live byte-reader is unconfigured.

## New supplied and reviewed metadata

The serializer now requires two additional arguments:

```js
slateMetadata: {
  universe_version: 'declared-universe-version',
  counts: { roster, screened, blocked, eligible },
  price_session: { date: 'YYYY-MM-DD', closed_at: '<exact UTC close>' },
  source_health: {
    state: 'reviewed_at_cutoff' | 'partial_at_cutoff' | 'unavailable_at_cutoff',
    label: '<reviewed public explanation, up to 240 characters>'
  },
  review: {
    state: 'reviewed', audience: 'owner_private', review_id,
    horizon_id, entry_at, exit_at, source_cutoff_at,
    reviewed_at, expires_at, content_sha256
  }
},
assessmentContext: {
  universe_version: '<same frozen universe used by the assessment>',
  assessed_at: '<actual recorded scorer invocation time, strict UTC>',
  price_session: { date, closed_at }
}
```

`prepareSlateMetadata(value)` produces the selected public metadata, its exact serialized projection and a digest for a **separate** review. The review binds every supplied public field, the exact horizon/cutoff and a lifetime reaching the requested display expiry. Its chronology is `source cutoff <= assessed_at <= metadata reviewed_at <= serializer at`. Counts can therefore be computed by a real scorer invocation and then reviewed without backdating either operation. Changing the universe version, a count, session or health label invalidates the binding. Review records, hashes and assessment context do not enter the served payload.

The trusted controller must supply `assessmentContext` from the same actual scorer invocation: its frozen universe version, actual recorded `assessed_at`, and reviewed calendar/price-action measurement endpoint. It must not derive these from the requested metadata, the cutoff, or the later review clock. The current scorer envelope does not contain this context, so it cannot be recovered from the top rows. Missing, pre-cutoff or future assessment time fails; a metadata review before assessment also fails. The controller supplies the actual serializer operation time as `at` and retains the full scorer result, including `eligible_count` and `withheld`, for the consistency checks below. Arbitrary JSON assertions are not proof that a universe, calendar or source assessment is genuine.

This timing rule concerns **presentation review only**. Final public-case copy review may also occur after source cutoff, but must be no later than serializer `at`. Underlying scorer/component/gate data reviews retain their existing cutoff rules. Public-case and metadata reviews remain bound to the original source cutoff; reviewing text later neither moves that cutoff nor approves additional facts, source rights or a new score. Source-health states describe the underlying coverage as of cutoff, not the timestamp when final display wording was reviewed.

Count semantics and checks:

- `roster` is the declared universe size; `screened` is the number assessed by this scorer invocation; unscreened members are not counted as blocked.
- `blocked` is the number of assessed records withheld by the scorer; `eligible` is eligible **for research scoring**, not a return forecast or tradability claim.
- All four are supplied nonnegative safe integers, with `screened <= roster` and `screened = blocked + eligible`.
- Supplied eligible must equal the full scorer's `eligible_count`; blocked must equal its `withheld.length`, whose records must be withheld. The pre-projection shortlist length must be `min(limit, eligible_count)`.
- Public-case/display withholding is separate. It changes `rows` and the existing `withheld_count`, never the supplied universe totals. A seven-eligible assessment may have only five shortlisted rows, and a missing public-case review may reduce those to four. No case is added to fill the gap.

The price-session date must be strictly valid and match the UTC date of the supplied exact close, consistent with the existing US-session scorer/bridge contract. Close must be at/before source cutoff. The entire date/close pair and universe version must exactly match the independent assessment context. No close is invented from a date. This layer labels the value **Completed price session**, not “latest live price”; the scorer's separately reviewed calendar remains responsible for latest-completed-session validation. This projection does not infer holidays or a missing calendar.

The supplied source-health state and explanation are reviewed facts, not calculated from the number of rows. Partial coverage may coexist with individually eligible cases. `unavailable_at_cutoff` requires zero eligible cases. Unsupported/missing status or label fails; there is no default “healthy” status. The reviewer must verify that the explanation faithfully describes coverage and freshness; the serializer cannot prove prose true.

The renderer presents universe version, roster/screened/blocked/research-eligible counts, completed price session and reviewed health explanation. These remain stable while search filters rows. It also restores a direct `#methodology` link labeled **Retained method & limits**. It does not borrow counts or health text from the old retained snapshot.

## Catalyst and known-information timing

Reviewed public cases now carry:

```js
catalyst: {
  label,
  kind: 'known_information' | 'scheduled_event',
  timing: /* exactly one shape below */,
  source_url
}

{ precision: 'exact', at: '<exact UTC instant>' }
{ precision: 'date_only', date: 'YYYY-MM-DD', time_zone: '<reviewed IANA zone or UTC>' }
{ precision: 'interval', start_at: '<exact UTC bound>', end_at: '<later exact UTC bound>' }
```

`preparePublicCase` binds kind and the entire timing shape into the existing public-case review. Unknown shapes/fields, invalid dates/zones, missing interval bounds, equal/reversed intervals and excessive fractional timestamp precision fail. No source/capture/review timestamp is substituted for event timing. Exact holding-window entry and exit remain mandatory UTC instants.

For exact timing, entry and exit are inclusive. For an interval, it is in-window only if the entire interval is inside; one crossing a boundary is `boundary_uncertain`. An interval ending just before entry is before-window; one starting just after exit is after-window. No midpoint is created.

For date-only timing, compare the reviewed date against entry/exit **local dates in the supplied zone**. A strictly intermediate date is in-window; a date outside is before/after; either boundary date is conservatively `boundary_uncertain`. No local midnight, inferred release time or offset is emitted. The UI renders a date-only `time[datetime="YYYY-MM-DD"]`, **Time unknown (zone)** and the boundary label. The date-only path deliberately does not claim a calendar day on the boundary is wholly inside the holding window.

Known information additionally must be known by the source cutoff and public-case review time: exact instants and interval upper bounds cannot be later; a date-only date cannot be later than either clock's local date. Same-day date-only knowledge is a reviewed assertion, not a precise publication-time claim. The renderer says **Known information** and **Dated information source**, retaining the date and uncertainty rather than turning an old operating update into a scheduled future event. An October 13 date-only operating update can therefore accompany a Route A case without a fabricated midnight.

Timing classification is descriptive and never changes the supplied score or eligibility. This proposal does not modify the scorer's Route A/Route B logic. Case-review failure still withholds the affected row; metadata failure withholds the entire slate.

## Full-assessment tie labels

Each scored input row must carry its actual scorer `tied_priority` as a strict boolean. The serializer preserves that value in each public row and the renderer uses it directly. A true flag remains true when other tie members fall outside the shortlist limit, lack a public-case review, or are hidden by search. The UI does not infer full-assessment ties from surviving cards. Missing or nonboolean flags withhold the affected row; a false flag contradicting equal-score peers present in the scorer rows is also withheld. The client rejects malformed flags and visible equal-score contradictions. A lone true flag is valid because tied peers may be outside the projection.

This is a required v2 row field. Earlier serialized drafts lacking it fail closed and require regeneration and fresh exact-output review; no draft is approved by this repair. Research rank, score, eligible counts, cutoff and review rules are unchanged.

## Delivery and unchanged fallback

The earlier injected-reader contract remains unchanged: an independently authenticated publisher must check current entitlement/rights, real input reviews, exact output approval, schema/method and display expiry at actual delivery. Only the exact approved UTF-8 bytes may be returned. The publisher must not serve drafts or private review records; no audience/status field in JSON grants permission. Changed metadata or timing requires a fresh whole-output review, including non-reconstruction/substitution review. A v1 output approval does not approve v2 bytes.

The client slot is a programming boundary, not authentication. No publisher reader is configured. The app starts with `approvedSlateSlot: null`, keeping the current unranked evidence view active. The same missing/stale/malformed/wrong-horizon fallback, entry/expiry timer, visibility recheck, stable state key, no-backfill policy and source disclosure behavior remain. No prices, OHLCV/actions, returns, probabilities, private holdings, hashes, reviews or credentials are added to output.

## Reviewed observable invalidation condition

Every public case must explicitly supply `invalidation_trigger`: a nonempty clean string of at most 500 characters, using the same text rules as `thesis` and `downside`. Leading/trailing whitespace, controls, directional embedding/isolate controls and angle brackets are rejected. Only an own data property is accepted; a getter or inherited value cannot supply the field. This field must also contain at least one character after whitespace and Unicode default-ignorable code points are removed for the validation check. The original exact string is preserved for the review hash and output; it is never silently trimmed or normalized.

`preparePublicCase` includes the exact condition in its projected content and review hash. The serializer carries that reviewed value into each output row as `invalidation_trigger`. Editing it after review invalidates the case binding; removing or malforming it withholds that row. No condition is inferred from downside prose or copied from private scorer inputs. The public-case reviewer must independently verify that the supplied wording states an observable condition that would invalidate the thesis; string validation cannot establish that semantic judgment.

This remains a required v2 row field. Earlier drafts without it fail closed and need regeneration, fresh public-case copy review and fresh exact-output approval. No old approval extends to changed bytes. The paired client contract must require and display the condition before this dormant branch can be activated. No live reader, publication permission, score, rank, eligibility, cutoff or deadline rule changes here. The six active retained cards and their existing invalidation conditions remain unchanged.

## Verification

The application root `npm test` command runs the serializer, scorer-context and browser presentation tests alongside the remaining app/helper checks. All fixtures are synthetic, including their independently supplied assessment and review clocks. They establish contract behavior, not source authenticity, economic validation or actual provider permission. No test fixture is imported by production UI.
