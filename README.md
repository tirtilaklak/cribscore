# Cribscore source snapshot

Stock-first research desk with prospective next-session and five-session windows, source-qualified company cards, separate chart context, and an owner-scoped append-only journal.

This is a source-only collaboration snapshot. Live hosting remains private and is managed separately. It includes public research summaries and synthetic test fixtures, but no private PDFs, raw source archives, owner journal data, credentials, deployment receipts or persistent access grants. The local hosting manifest has no production project ID.

The retained October 17, 2026 research snapshot has six unranked candidates and zero eligible selections. Current prices, expected returns, gain probabilities and validated rankings are unavailable. Publication, calendar and reviewed-price readers are unconfigured. The app records dated abstention context after explicit journal setup; it has no unattended schedule and cannot provide trading recommendations from chart data.

## Run locally

Use Node 25.8 or a compatible release with `node:sqlite`, and Python 3 for offline HTML checks.

```sh
npm ci
npm run build
npm test
npm run validate:worker
npm run preview:worker
```

The preview is at http://127.0.0.1:4180 with temporary SQLite and a clearly labeled local identity. Restarting it resets the local journal. It does not prove hosted identity or persistence. Build before tests: production Worker tests import the generated bundle.

## Integration boundaries

UI source is under `dist/`, Worker entry is `worker/index.js`, and the journal API/coordinator are under `server/`. The build embeds the explicit public assets; no private source directory is served. Schema and migration files are under `db/` and `drizzle/`.

Use an isolated branch for proposed fixes. Include a failing regression and exact before/after results. Do not configure providers, add credentials, change authentication, publish, or modify production data from this snapshot. The production integration owner reviews changes before publishing the exact tested source to the existing private Site.
