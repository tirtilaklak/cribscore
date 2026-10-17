# Historical price-action draft

`price-action.mjs` is a pure, private calculator. It consumes separately reviewed target and benchmark snapshots, current source-bound rights, a covered US-session calendar and successful host check records. It does not fetch, persist, approve a candidate, submit a trade or predict a future return.

The declared convention is `five-session-close-cash-entitlements-v1`: one notional share at the first of six regular-session closing endpoints, then five completed close-to-close intervals. Splits change held shares. Gross ex-date distributions remain cash entitlements without reinvestment; a same-day split/distribution requires an explicitly reviewed post-split share basis. No claim of payment receipt, executable fill, taxes or transaction costs is made.

The numeric calculation remains private. The projection strips prices, numeric historical returns, cash and share amounts, retaining only a coarse historical grade and audit lineage for separate review. Derived-display denial withholds that grade. A projection is not a publication artifact or a rights approval.

The generic calculator accepts an explicitly selected tolerance for isolated descriptive experiments. Cribscore's proposed research-score path uses **exactly `toleranceBps:0`**, grade convention `absolute-and-relative-sign-neutrality-v2` and numerical-neutrality version `return-units-neutral-band-1e-12-v1`. It treats values within ±1e−12 return units as neutral and adds the narrowly scaled comparison-roundoff allowance documented in `../research-score/policy.md`. The old 10-bp example is not the research-score policy.

`../orchestrator/pipeline.mjs` enforces this policy, joins the trusted capture/ingestion records and keeps numeric output in a non-enumerable private property. The independently reviewed scorer component must bind the grade, conventions, both capture identities and both provider lineages; the calculator never creates that approval itself. See `../orchestrator/README.md` for the complete mapping and actual review/cutoff chronology.

The prospective stock targets remain October 19 open to October 19 or October 23 close. This historical measurement uses completed closing references and cannot credit the weekend opening gap or substitute an old close as a prospective entry.

All tests use synthetic records. The integrated suite and exact module hashes are recorded in `../../docs/v8-app-verification.json`. No real price source, current company grade, market benchmark choice or empirical predictive validation is established by these checks.
