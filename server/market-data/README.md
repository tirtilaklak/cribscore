# Market-data integration readiness

The adapters in this directory are server-only candidates and are disabled in the published app. Neither Tiingo nor Alpaca has been called for production prices. Tests use synthetic responses only; they do not establish real coverage, licensing, ranking quality or a live connection.

The new [Alpaca daily-history adapter](ALPACA.md) supplies a status-only setup check, a bounded capture transport and per-page provenance. Missing credentials or reviewed rights produce `setup_required` with zero network requests. Complete configuration remains `configured_unverified`. There is no automatic price display, retention, ranking, paper-mark or scheduler grant.

## Conditional provider path

Tiingo EOD is a candidate transport for an approved paid plan. No subscription or key is authorized yet. The documented service is end-of-day, with evening corrections; its date field labels a price session, not a quote timestamp. The adapter retains both raw and adjusted fields separately in memory and does not infer complete calendar, security identity or corporate-action coverage.

Tiingo Starter/trial cannot persist source data or derived rankings. Paid persistence is conditional on an active qualifying subscription and the exact current terms. A private website is not automatic permission to reproduce prices. A non-reconstructible research score requires a separate reviewed output assessment; this prototype grants no display or derive permission.

Sources: https://www.tiingo.com/documentation/end-of-day and https://app.tiingo.com/tos/ (reviewed October 17, terms updated October 6, 2026).

## Secure activation boundary

The user must choose/approve the applicable plan and handle agreement acceptance and account creation. A scoped API key must then be supplied through a supported server-secret configuration flow. Do not paste it into a URL, source file, static bundle, task message, screenshot or command argument. Do not save it locally as part of this prototype. The adapter accepts an ephemeral token argument from its server caller; it never discovers existing secrets.

Before a real request, the integration owner must bind an explicit rights review to the provider/dataset, allowed operations, review time and expiry. Actual operation time is checked before transmitting the header and after retrieval. HTTP errors, rate limits, redirects and transport failures stop without a retry. No scheduler is configured.

Before ranking, reconcile permanent security identities, all expected completed exchange sessions, source coverage, corporate actions, consolidated liquidity and company/event evidence. Run the independent feed-ingestion validator and candidate hard gates. A recent retrieval cannot make an old observation fresh. Publish only permitted derivatives after review; never publish these raw inputs or a private transcript.


The adapter now bounds the streamed response, verifies strict UTF-8 JSON, hashes the exact response bytes, and emits actual request/response clocks with unknown provider publication and null ingestion time. The separate host ledger assigns capture identity and reviewed ingestion completion. These private envelopes are never source-display payloads. Independent fragmented-UTF-8 and failed-read controls found no additional transport defect. A prior private verification record covers the canonical pipeline; the source test suites provide reproducible checks without exposing that release record.
