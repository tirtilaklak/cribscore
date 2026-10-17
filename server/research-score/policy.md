# Proposed research evidence score v0.1

**An unvalidated product rule for prioritizing research, not expected return, gain probability or an empirically superior strategy.** Neither supplied PDF chooses these weights or validates the one/five-session target. No current cards receive a score from this proposal.

## Admission and publication come first

Reuse the current `classifyCandidate` to require the full identity, price/actions, complete company evidence, event calendar, mechanism, funding and provenance/rights gates, a qualifying A/B route, an upcoming window, and a valid cutoff. A high score never overrides a blocker. The typed route-A metric/share/operating-driver attestations and complete calendar coverage remain required where applicable.

Also require all four component review records and separate, currently valid authorization for `display_derived_research_score`, covering every input source/provider. This does not infer Tiingo Power rights from a product name, API key, fetched response, previously allowed operation or successful trial. If derived owner-private display rights are not approved, withhold the score even if private computation might be allowed. Raw-price output is excluded from the module's allowlisted return objects. The proposal does not fetch, store, transform or publish any real market data.

## Transparent rubric

Each component is 0, 1 or 2, with equal 25% weight. `research_score = 12.5 × (fundamentals + catalyst + price_action + macro)`, giving 0–100 in 12.5-point increments. No fitted coefficients, category-specific hidden weights or prize-year bonuses. The coarse scale deliberately exposes ties. It does not quantify confidence, the probability of a gain, economic materiality or source completeness.

| Component | 0 | 1 | 2 |
|---|---|---|---|
| Fundamentals | Reviewed adverse operating/per-share evidence | Mixed operating/per-share evidence | Sourced favorable forward operating change or credible conditional improvement with reconciled accounting, per-share and financing effects |
| Catalyst | No confirmed new in-window information opportunity, or already-known news | Confirmed two-sided in-window company event | Confirmed in-window event plus reviewed incremental company-information mechanism, favorable/adverse tests and a reference expectation; company guidance is labeled as such |
| Price action | Five-completed-session target return and matched-benchmark spread are both below the declared negative numerical-neutrality boundary | The comparisons disagree or either is within the declared numerical-neutrality band | Five-completed-session target return and matched-benchmark spread both exceed the declared positive numerical-neutrality boundary |
| Macro | Disclosed company transmission identifies a relevant headwind | Mixed context or an explicit review finds no material macro dependence | Disclosed company transmission identifies relevant support |

The price-action rubric is a proposed five-session descriptive input for either requested horizon. It is not a one/five-session forecast coefficient. Use actions/distributions on a consistent share basis and the same start/end timestamps for the benchmark; confirm source rights. Price-action ratings are typed reviewed attestations here, not numbers inferred by an LLM from a chart. Before production, the ingestion/review layer must compute and retain the two comparisons using permitted input data. The pure scorer does not validate the truth of supplied attestations.

Fundamental ratings require human-reviewed interpretation of the sourced operating bridge. The macro zero does not exclude an otherwise valid company case: the concentric method does not require every outer circle to be positive. A bare earnings date cannot get incremental-information credit. A fresh route-A case with no future event may validly have catalyst=0; it gets no invented future-catalyst points.

## Ordering and horizon

Score admitted cases separately for the declared next-day and five-session windows. The scorer derives that window from the same reviewed calendar at the source cutoff: the first supplied session whose open is strictly after cutoff, ending at that session close for next-day or the fifth supplied session close for next-week. Requested endpoints must match those calendar instants, including holidays, early closes and UTC changes, and inclusive calendar validThrough must reach the selected exit date. Assessment must still precede entry. A missed entry requires a new cutoff, selected window and bound component reviews; a later assessment does not roll the existing review forward. Sort descending score; ties have the same research rank. Permanent security IDs only stabilize tied display order. This is a new `research_evidence_v0_1_unvalidated` ordering policy; do not silently describe it as the previous A-before-B `priority_v0_1` rule. Retain A/B as admission provenance.

The requested five-to-ten count is a maximum display limit, chosen as an integer in that range. Fewer eligible names means fewer rows; zero means no scored slate. Do not expand the universe, waive gates, fill missing reviews or invent scores to reach five. Record the full reviewed same-universe slate for eventual evaluation, not only top rows.

## Review record contract

`candidate.research_score_review` contains `policy_version`, exactly one record for each of `fundamentals`, `catalyst`, `price_action`, `macro`, and `publication_rights_review`.

Every component binds to candidate security ID, horizon ID, exact entry/exit and source cutoff. It has `state: reviewed`, a valid rubric `rating`, nonblank reviewer/rationale, source references and source/provider IDs, immutable evidence snapshot ID, observation/public-availability/ingestion/review timestamps in that order through cutoff, and future expiry. Missing, duplicate, future, stale or mismatched records produce `score: null` and reasons. Real UTC instants with up to millisecond precision are accepted; do not round actual capture clocks.

The price review additionally declares the exact latest completed `price_session`, `measurement_window: five_completed_sessions_total_return`, `benchmark_id`, `benchmark_window_matched: true`, and `corporate_actions_reconciled: true`. Macro headwind/tailwind requires `company_transmission`. Incremental catalyst credit requires `new_information_mechanism_reviewed: true` and a confirmed candidate event interval inside the selected window.

The separate publication review has operation `display_derived_research_score`, matching policy version, reviewer, source/provider IDs covering all component sources, source references, rights-record identity, review time through cutoff and current effective/expiry bounds. All real provider permissions remain unestablished until separately reviewed.

## Source-derived limits

The concentric transcript motivates a dated company mechanism, event timing, contrary evidence and per-share/funding discipline. The Nobel catalog motivates distinguishing mechanisms from causal identification and predictions, applying horizon discipline, and questioning selective updates. These are design applications; no Nobel source supplies additive score points or validated return weights. The existing task-7 calibration, endpoint, attrition, materiality and repeated-look problems remain unresolved.

Required case prose (favorable case, counter-case, invalidation and route-specific explanation) and component rationales must be strings containing visible content after whitespace, control and Unicode default-ignorable code points are removed for validation. The scorer preserves the original strings, including meaningful joiners in multilingual text. Directional macro transmission and catalyst explanations use the same check. This only rejects absent or invisible explanations; the separately trusted reviewer still determines whether the source supports the claimed mechanism.

No performance claim follows from a passing scoring test. Prospective score snapshots and same-window net outcomes require separate registered evaluation, locked baselines, dependency/multiplicity handling and honest missing-outcome treatment.

## Price-calculation join, reviewed prototype revision

For this score policy, use `toleranceBps:0`, calculation convention `five-session-close-cash-entitlements-v1`, grade rule `absolute-and-relative-sign-neutrality-v2`, and neutrality version `return-units-neutral-band-1e-12-v1`. The inclusive numerical-neutrality band is ±1e−12 in return units. Boundary comparisons additionally allow a narrow floating-point roundoff bound: four machine epsilons times the absolute target-return magnitude/boundary for the absolute comparison, and four machine epsilons times the sum of both return magnitudes and the boundary for the spread comparison. This handles comparison roundoff; it is not a proof of arbitrary corporate-action arithmetic accuracy or a fitted economic threshold. A 10-bp setting is an alternate calculation and cannot supply this score policy.

The typed price review must bind these declared conventions, its independently recomputed grade, a calculation-record identifier, distinct target/benchmark capture identifiers, the benchmark security and both source/provider lists. The reviewed categorical rating must match that calculated grade. Both source lists must be included in component provenance and covered by the separate current publication-rights review. The scorer still does not authenticate a client assertion or recompute private price bars; only the trusted ingestion/review controller may supply these records. A draft calculation cannot approve its own component, candidate or publication rights.


## Actual calculation clocks

The price review requires explicit `target_available_at`, `target_ingested_at`, `benchmark_available_at`, `benchmark_ingested_at` and `calculated_at`. Each availability must follow the measurement close and each ingestion its own availability. Aggregate availability and ingestion independently equal the maxima of both legs. Calculation follows both ingestions, then component review, then source cutoff. A fresh aggregate or later review never rescues a stale leg or backdates a calculation. These are schema/binding checks on separately trusted records, not authentication.
