# Public audience

The Site is public. Server routes still require the platform identity header, so the journal, price setup and `/mcp` stay owner-only. The public pages show the retained research snapshot, source links, the Evidence room, the library and the methodology. They show no score, ranking, price or position.

Several modules fix their audience to `owner_private`. None of them produces output on the live Site today. This page lists each one and what a public audience would require.

## Why public is safe today

`worker/index.js` passes `readPublications: null`, `readCalendar: null` and `readReviewedPrices: null`. The Worker bundle (`sourceFiles` in the generated `docs/worker-build-manifest.json`) contains the journal API, the observer, the MCP handler, the price-setup status check with `alpaca-daily.mjs`, and the shared `candidates.js`, `journal.js` and `prices.js`. The scorer, the slate serializer, the refresh planner, the capture review, the Tiingo modules, the ingestion validator and the orchestrator are not in it.

The browser (`dist/app.js`) imports `candidates.js`, `stock-view.js` and `source-freshness.js`, then loads `evidence.js` and `desk-tools.js`. `stock-view.js` imports `research-slate-view.js`, but `state.approvedSlateSlot` starts null and nothing assigns it, so the decoder never receives a payload. `refresh.js` is not loaded by any page module.

So the hard-codings below are dormant. Each becomes live only through an explicit change: a reader configured in `worker/index.js`, a module imported into the Worker or the page, or a review file supplied to a capture script.

## Inventory

| Location | What it fixes | For a public audience |
| --- | --- | --- |
| `server/research-score/research-score.mjs:81` (`publicationRightPassed`) | A score display rights review passes only when `options.audience` and `review.audience` are both `owner_private`. | A rights review approved for the public audience, and a scorer option that accepts it. |
| `research-score.mjs:109`, `:120` | Every scored or withheld result, and the ranking result, is stamped `audience: 'owner_private'`. | The stamp must carry the reviewed audience, and every consumer must accept it. |
| `server/research-slate/research-slate.mjs:55` (`reviewedMetadata`) | The slate metadata review must be `owner_private`. | A metadata review issued for the public audience. |
| `research-slate.mjs:101` (`reviewedCase`) | Each public case review must be `owner_private`. | A case review per candidate issued for the public audience. The case text is what the public would read. |
| `research-slate.mjs:122`, `:148` | The scorer result and every scored row must be `owner_private`. | Follows from the scorer change above. |
| `research-slate.mjs:166` | The serialized slate payload is stamped `owner_private`. | The payload stamp must match what the browser accepts. |
| `dist/lib/research-slate-view.js:52` (`decode`) | The browser rejects any slate payload whose audience is not `owner_private`. | The decoder must accept the public audience. This is the last gate before a ranked list is shown. |
| `dist/lib/refresh.js:11`, `:101-102` (`planRefresh`) | The SEC refresh plan runs only for `site.id === 'snapshot-only-not-a-live-site'` and `site.audience === 'owner_private'`. | A real site identity and an audience decision. The placeholder id means the planner cannot run against the live Site at all. |
| `server/market-data/alpaca-daily.mjs:58` | The Alpaca authorization review must be `owner_private`, else `audience_not_authorized`. | Provider and exchange terms reviewed for public display. The current scope is `delayed_sip_historical_personal_research` (`ALPACA.md`). The module is bundled for the owner-only status route; no credentials or review are injected and it makes no provider request. |
| `server/market-data/alpaca-capture-review.mjs:61` (`allowedUse`) | The capture use review must be `owner_private`. | A use review for the public audience. |
| `server/market-data/tiingo-eod.mjs:31` | The derived output review for `persist_derived` and `display_derived` must be `owner_private`. | A derived output review for public display. `server/market-data/README.md`: a private website is not automatic permission to reproduce prices. |
| `server/bridge/tiingo-observed-bridge.mjs:47`, `:112` | The bridge policy must be `owner_private`; the bridge output is stamped `owner_private`. | Policy and stamp for the public audience. |
| `server/market-ingestion/market-ingestion.mjs:46` | The ingestion policy must be `owner_private`. | Same. |
| `server/orchestrator/pipeline.mjs:120`, `:131` | Price-action review drafts are stamped `owner_private`. | Same. |

Tests and fixtures also use `owner_private`. They are synthetic and stay out of production.

## The decision before any score or price is shown publicly

Choose the audience for derived research. Either scores, rankings and prices stay owner-private and are delivered only to the signed-in owner, or they are reviewed for a public audience.

Public requires, in order: provider terms that allow public redistribution of the derived output (Alpaca, Tiingo and SEC each need their own review), a rights review for that audience, the audience value carried through every check above, and a regression test for each changed check. Until then the public pages stay evidence-only. Publishing ranked stock lists to the public may carry obligations this repository does not assess.
