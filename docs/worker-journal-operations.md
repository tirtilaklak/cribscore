# Worker and journal operations

## Scope and release status

This source snapshot documents the Worker and D1 contracts. Production deployment, identity and release receipts are managed separately. Local checks do not establish hosted persistence.

The current desk contains six unranked company cases and zero eligible selections. Publication and reviewed-price readers are null; the calendar reader holds an unreviewed record and serves nothing until the owner reviews it. The server can retain current ABSTAIN decisions from its two stock-horizon contexts; it cannot produce authoritative picks, paper positions or reviewed valuations from those contexts. TradingView is a separate display-only chart. Imported daily prices remain unreviewed chart inputs and cannot supply paper marks.

The hosted chart uses a fixed TradingView HTTPS iframe on the vendor's own origin, with only an allowlisted public symbol and fixed display options. It sends no referrer or journal context and has no message or accounting bridge. Supporting browsers request a credentialless frame. The UI reports that the chart was requested; an iframe load does not establish market-data readiness. The external TradingView link remains available when embedding fails. The imported-history range controls only the imported panel; the vendor chart has its own controls.

## Source and state locations

| Location | Purpose |
| --- | --- |
| `dist/`, excluding `server/` and hidden metadata | Deliberately public UI source: HTML, scripts, styles and bounded research JSON. |
| `worker/index.js` | Deployment entry; serves embedded assets and injects the server-owned observation coordinator into the journal API. |
| `worker/generated-assets.js` | Generated public asset map. Rebuild rather than editing it. |
| `server/journal-api.js` | Authenticated journal reads, explicit appends/imports and server observations. |
| `server/journal/observe.mjs` | Server-only publication/calendar/price coordination; returns a validated append-only proposal and status. |
| `dist/lib/journal.js`, `dist/lib/prices.js` | Shared journal, accounting, calendar and reviewed-price validation. |
| `db/schema.ts`, `drizzle/` | Schema declaration and committed migration SQL/metadata. |
| `dist/server/index.js` | Generated, self-contained Worker bundle. |
| `.openai/hosting.json` | Local build metadata only: `d1: "DB"`, `r2: null`; no production project ID or `static` field. |
| Hosted D1 binding `DB` | Durable owner journal heads and append-only events, once provisioned by Sites. |
| Browser tab memory | Unsynced drafts, pending import previews and imported price series. These are not durable backups. |

Other server modules remain offline helpers unless explicitly imported into the runtime. Private PDFs, source-response archives, audit records, credentials and journal exports stay outside `dist/`. Supported visible files in that directory are public build inputs. The Worker has no filesystem fallback; `/server/index.js`, `/.openai/hosting.json` and repository documentation are not public routes. Test publications, prices, calendars and identities remain outside the production dependency graph. There is no production fixture fallback.

## Local operation

Node **v25.8.0** is the verified runtime. Full tests and the Worker preview use `node:sqlite`. Pinned build dependencies are esbuild 0.25.12, drizzle-kit 0.31.10 and drizzle-orm 0.45.2. In a Sites workflow, install missing dependencies with the installed Sites plugin's `scripts/install-dependencies.mjs` helper from the repository. Do not reinstall an unchanged working dependency tree.

Run from the repository root in this order. Build first because the production-observer Worker test imports the generated bundle; there is no automatic pretest build:

```text
npm run build
npm test
npm run validate:worker
npm run preview:worker
```

The Worker preview listens on `127.0.0.1:4180` unless `CRIBSCORE_PORT` overrides it. It uses an explicit local-preview identity and temporary in-memory SQLite. The UI labels the storage as temporary; stopping the preview loses its journal records. The preview script is not imported into the deployed bundle and does not verify hosted identity or D1.

`npm start` provides the static preview on `127.0.0.1:4179` without journal endpoints. Neither preview performs unattended work.

## Build and same-project publication

The build embeds public UTF-8 assets, bundles the Worker and writes `docs/worker-build-manifest.json`. Validation compares current source/input hashes, public inventory, bundle hash and bytes served by the compiled Worker. It also checks private-path exclusions and missing-identity/missing-D1 responses. Rebuild after changing code, public assets, package/lock files, hosting configuration or migrations.

Use the supported Sites workflow with the same project. The audience is set in ChatGPT Sites; `launch-checklist.md` covers the public switch. Synchronize the managed source repository with a fresh short-lived source credential through the source helper's hidden stdin. Never put credentials in commands, files, browser code or receipts. The helper owns the commit, push and archive. Supply the matching `project_id`, `commit_sha` and unchanged archive to the native owner-private save/deploy operation. A read-only review archive is not a release artifact.

The official package must contain:

```text
dist/server/index.js
dist/.openai/hosting.json
dist/.openai/drizzle/0000_rainy_multiple_man.sql
dist/.openai/drizzle/meta/0000_snapshot.json
dist/.openai/drizzle/meta/_journal.json
```

The packager copies root `drizzle/` into that metadata location. Public assets remain in the archive while the Worker serves embedded copies. Sites applies migrations before Worker upload. A missing Worker, binding declaration, SQL or migration metadata makes the package incomplete. Source and built manifests must both omit `static`; preserve the project ID and `DB` binding.

Verify every release archive against its own tested build manifest and migration hashes, including exclusion of private inputs and synthetic fixtures. Retain the source commit, archive hash, version/deployment IDs, terminal deployment status and verification times. A source push or local build is not deployment confirmation.

After deployment succeeds, verify the journal in the existing signed-in Site session. Missing visitor identity must return 401, and a forged `oai-authenticated-user-id` header sent from outside the platform must also return 401. A visitor without identity sees the owner-only state in the browser. A Sites service-access bearer token alone does not identify an owner. Check a legitimate owner operation, readback and reload; check the same owner's retrieval on an authorized second device/session when available. Never create a fake actual trade for a smoke test. Record only the hosted checks actually performed.

## Identity and API consistency

The platform's `oai-authenticated-user-id` is the owner key. It is stable within this Site, not portable across newly created Sites. Email is not used as ownership. Request JSON never selects an owner. The Site audience is public; identity still comes only from the platform header. Preserve that authentication integration.

| Route | Purpose and accepted input |
| --- | --- |
| `GET /api/journal` | Return the owner's validated journal or `journal:null, revision:0`. |
| `POST /api/journal` | Explicit append or reviewed import: complete proposed journal, `expectedRevision` and optional append/restore mode. |
| `POST /api/journal/observe` | Server observation: exactly `expectedRevision` and `requestId`. No client journal, publication, marks, time, owner or authority. |

Both POST routes require same-origin JSON and reject ambiguous duplicate keys. Responses are private and uncached. Full journal validation includes schema, graph, publication-byte hashes and immutable history. New events and the head revision are committed in one D1 batch under a compare-and-swap. A conflict returns 409 with the newly read history for the authenticated owner. Corrupt rows are not silently reset.

An observation requires an existing journal, including a deliberately initialized revision-zero journal. A null journal returns `409 journal_setup_required`. The request ID must be 1–96 characters matching `[A-Za-z0-9][A-Za-z0-9._:-]*`; the complete observation body is limited to 4096 UTF-8 bytes. Missing observer configuration returns `503 observer_unconfigured`. Invalid client fields return `400 invalid_observation_request`.

The observer is a server-injected function, never a client option. The API independently validates its proposal, base revision, unchanged prefix, event types and clock bounds. It allows only abstention and paper-domain events from that path; settings and actual-trade records remain explicit user actions. A no-op observation rereads the journal after trusted work and returns 409 if another tab appended during that interval. A successful response confirms the version read; another session can still append afterward.

D1 uses a primary-started session and transactional batch semantics; see the [Cloudflare D1 binding documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/). Local verification executes production SQL through real SQLite, while hosted D1 behavior requires the release checks above.

## Observation states and reader limits

The configured publication and reviewed-price readers are null. A server-owned context reader supplies retained stock snapshots for `next_day` and `next_week`. Each saved snapshot retains its original source/cutoff information. The server observation clock does not refresh that evidence or certify eligible selections.

The calendar reader in `server/calendar/calendar.mjs` holds one record, `server/calendar/nyse-2026.json`: the 2026 NYSE regular sessions generated from the exchange's published holiday and early-close list, with the SHA-256 and capture time of that page. The record ships as `captured_unreviewed`, so the reader answers `unconfigured` and no paper window resolves. The owner review and the field change that activates it are in `server/calendar/README.md`.

The observation response includes `automation.publisherState`, `checkedAt` and bounded `pendingReasons`:

| Publisher state | Meaning |
| --- | --- |
| `unconfigured` | No authoritative publication reader is connected. Valid retained contexts can produce current ABSTAIN decisions. |
| `unavailable` | Publication history could not be read. No no-pick conclusion is inferred from the failure. |
| `empty` | A complete requested archive contained no publications. Valid observed contexts can produce ABSTAIN decisions. |
| `ready` | The checked archive contained publication records. This does not establish current tradability, ranking validity or an open position. |

The coordinator records at most one abstention per observed UTC date and horizon. It does not backfill days when the app was closed. Repeated publication observations do not add another position, and conflicting bytes for an existing publication ID reject the proposal.

Before connecting any reader, follow [the server observation contract](journal-observer-contract.md). The publication reader must authenticate immutable approved history, return every eligible row, and provide complete coverage from journal creation through the requested observation time for both horizons. At most **100 publication envelopes** are accepted in one response. There is no pagination protocol or durable archive cursor. Larger or incomplete results fail explicitly; never silently truncate the archive, omit prior records or reset a journal to hide this limit. A larger-history integration needs a separately designed completeness and pagination contract before activation.

Future calendar and price readers must return the retained evidence bound to frozen identities and windows. Missing calendar, benchmark identity, reviewed bars or action coverage remains pending. Manual chart imports and client-supplied review labels cannot supply paper marks.

## Starting and using the journal

A visitor without platform identity, such as anyone opening a publicly shared Site, sees an owner-only journal and price-setup state. The browser sends no journal write or observation request from that state, and the research views stay readable.

A new owner with no saved journal first chooses **Start automatic journal** or **Backup & restore**. Restore a backup first when its identity should be adopted. Automatic observations begin after setup and only while the app is active. An unconfirmed observation leaves the last confirmed history visible and requires sync before another change. The browser does not fabricate a substitute publication or paper result.

Visible-page clock and visibility recovery can trigger observations. There is no background scheduler, webhook observer or server cron. A hidden or suspended tab is not a reliable unattended collector. Cross-device persistence means the same signed-in owner can retrieve saved history; it is not push synchronization. Use **Check journal sync** to retrieve and reconcile another session's changes.

Paper defaults are USD100 notional, USD0 commission and 5 basis points of adverse estimated slippage per fill. These assumptions are frozen per intent. The SPY benchmark requires a verified permanent identity and same-window price/action coverage. Missing inputs remain null, not zero profit. Daily-bar marks are paper references, not asserted auction executions, and opening marks settle only after the necessary bar evidence is available.

Actual trades require explicit confirmation plus separately reported quantity, price, fee and UTC fill time. Confirmation alone creates no fill. Corrections append a revision with a reason. No action places a brokerage order.

## Backup, import and interrupted requests

Use **Backup & restore → Export journal** to download the journal identity, domain events and revision history. If an unsynced draft exists, export includes it. Keep the file private and preserve its bytes. It is not a database snapshot and contains neither owner credentials nor the database's server-receipt rows. A self-contained JSON hash does not authenticate a publication.

Use **Review backup** before **Apply reviewed backup**. The preview lists additions, unchanged duplicates, conflicts and empty-journal identity adoption. Unknown schemas, malformed graphs, conflicting originals, invalid publication hashes and ambiguous duplicate JSON keys fail. An explicitly restored revision-zero journal may adopt a backup identity; nonempty history cannot be replaced. A stale preview must be reviewed again.

Generic POST/import authority hooks remain unset. A newly imported publication therefore fails with `publisher_unconfigured`, even when its hash is valid. The server observation route does not grant authority to imported journal records. Authoritative restoration of historical paper records needs a separate design; an import cannot manufacture a timely server enrollment receipt. Preserve the backup when restoration is blocked rather than weakening validation.

For an unconfirmed explicit save or conflict, leave the tab open and export any unsynced draft before reloading. **Check journal sync** reads the remote history and prepares compatible reconciliation for review. Observation errors retain the last confirmed history; no speculative observation proposal is promoted locally. A timeout or `journal_commit_uncertain` does not prove failure: the server may have committed. Read the saved revision before retrying. Request IDs and domain deduplication do not constitute a separate exactly-once command receipt ledger.

Generic journal POST is limited to 8,000,000 UTF-8 bytes, individual stored events to 600,000 bytes, and a journal to 20,000 events. SQL chunks are separately bounded. Oversized backups fail explicitly; do not truncate or split history manually to bypass the limits.

No automated export schedule, hosted database snapshot, retention guarantee or supported point-in-time restore has been verified. Browser JSON export is the available user-facing backup. Operator database recovery requires a separately verified platform-supported path.

## Authority and enrollment timing

Generic POST publication, calendar and market-data hooks remain off. Future hooks must verify trusted server records and cannot be replaced by client flags, URLs, self-hashes or unconditional approval. The observation route instead trusts only its server-owned reader functions and independently validates their resulting journal proposal. Source integrity and publisher authentication remain distinct requirements.

The API's receipt clock covers request start and complete immutable-body arrival using a high-water mark. The coordinator samples again after each asynchronous reader and before enrollment. Original publication and source clocks remain unchanged. A reader finishing at or after entry produces no-fill. New timestamps cannot be backdated to make a missed entry timely.

After proposal validation and write preparation, the API samples the high-water clock again. A newly crossed entry returns `422 observation_crossed_entry_retry` without writing. Use **Check journal sync** after a conflict and observe again using the current journal and a fresh receipt; the coordinator can then record no-fill. Later reviewed bars may settle a previously enrolled intent, but they do not convert a missed historical entry into a position.

The database stores the conservative pre-batch receipt during its atomic commit. This is not a separate attestation that the database commit completed before entry. A stronger durable-commit deadline guarantee would require an additional storage-level design.

## Migrations, failures and rollback

Generate schema changes from `db/schema.ts` with `npm run db:generate`; inspect SQL and metadata together. Keep migrations schema-only and bounded. Request handlers must never create or alter tables. Once a migration may have been applied, preserve its SQL, snapshot and journal entry unchanged, then append a new migration for subsequent changes. The observation route requires no additional migration.

A failed deployment can still have applied its migration. Resolve the native deployment/migration state before changing history or resubmitting a modified migration under the same identifier. Missing DB bindings/tables, corrupt rows or unreadable history produce unavailable states; do not clear data to make the UI load.

Prefer a compatible repair release preserving `DB` and migration history. Code rollback does not undo a migration or restore records. A static artifact lacks the journal API. Retention after removing/changing the binding or switching back to static hosting has not been verified, so that switch is not an established recovery procedure. Any rollback Worker must support the applied schema and preserve existing data.

Keep source, artifact, schema history, tests and deployment receipts together. Export recoverable user data before a planned change with data implications. These notes do not authorize destructive migrations or database restoration.
