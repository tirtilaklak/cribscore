# Scheduled journal observations

This source enables an owner-authenticated Site MCP observation writer.
`.openai/hosting.json` does not yet declare the `mcp` capability; it has only `d1`
and `r2`. The factory remains disabled by default; `worker/index.js`
explicitly seals `writesEnabled: true`. Request headers, JSON and runtime values
cannot change that setting. The production publisher, calendar and reviewed-price
readers remain unconfigured, so observations can record honest abstentions and
pending states, not price-based evaluations. No recurring task is created by this
source change. Native connection, cloud access and readback must be verified
separately before schedule activation. The Site retains its existing audience.

## Supported hosting contracts

The Sites skill and its `recurring-updates.md`, `identity-and-secrets.md`,
`storage.md` and `site-mcp-server.md` references were inspected for this design.
The available native tool declarations confirm:

| Capability | Supported path | Limit relevant here |
| --- | --- | --- |
| Scheduled work | `sites_create_schedule` creates and links a cloud task to a published Site | It is not a Worker `scheduled()` event or a Cron Trigger deployment field. |
| Duplicate checking | `sites_get_site` returns linked `automations` and a `schedule_request_id` | Missing/null automation metadata prevents creation; existing paused schedules remain paused. New create calls copy the returned request ID and retries reuse it. |
| Journal identity | Sites forwards `oai-authenticated-user-id` to authenticated `/mcp` calls | The ID is scoped to the Site. No browser/body field selects an owner. |
| Private service access | `OAI-Sites-Authorization: Bearer …` can cross the Site access boundary | It supplies no visitor identity or connected-app consent. This module never treats it as a journal credential. |
| Durable persistence | The existing `DB` D1 binding and application API | Native Sites database tools only inspect schema and read bounded rows; there is no native arbitrary SQL/write endpoint in the inspected surface. |
| Hosted agent tools | Add `"mcp"` to `.openai/hosting.json` (not yet declared) and publish a stateless `POST /mcp` implementation | Sites provisions the Site plugin. A supported installation/connection must be verified separately. |

No secrets belong in source, the manifest, browser assets, schedule text, or this
document. A separate token-to-owner mapping or shared public writer would weaken
the current model and is not part of this implementation.

## Protocol and caller behavior

`server/journal/scheduled-mcp.mjs` exports
`createScheduledJournalMcp({observer, writesEnabled=false, now, observationTimeoutMs=10000, sourceConfiguration})`.
It returns a stateless `fetch(request, env)` handler. The Worker routes only the
exact `/mcp` path to it.

The supported Sites protocol is `2026-07-28`. It implements JSON-RPC 2.0
`server/discover`, `tools/list`, and `tools/call`. Requests require platform caller
identity and JSON content type. Explicit foreign origins, cross-site/same-site
fetch metadata, duplicate keys, excess fields and oversized bodies are rejected.
There is no CORS grant. Responses are private/no-store and do not contain the
owner ID, complete journal contents, provider payloads, or raw errors.

The [current MCP schema](https://modelcontextprotocol.io/specification/2026-07-28/schema)
requires each request's `params._meta` to carry
`io.modelcontextprotocol/protocolVersion: "2026-07-28"` and
`io.modelcontextprotocol/clientCapabilities: {}` (or the caller's actual
capabilities). Optional client software metadata is accepted but never used as
identity. Every result includes `resultType: "complete"`; discovery and tool-list
results also declare `ttlMs: 0` and `cacheScope: "private"`.

The [HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
requires matching `MCP-Protocol-Version` and `Mcp-Method` headers plus `Mcp-Name`
for a tool call. Encoded `Mcp-Name` values use the standard Base64 sentinel syntax.
Header mismatch is HTTP 400 / code -32020, unsupported version is HTTP 400 / code
-32022 with the supported-version list, and an unknown method is HTTP 404 / code
-32601. Metadata and headers never relax the existing owner authorization. The
empty status tool accepts either absent arguments or `{}`; observation arguments
remain exact. The server does not issue pagination cursors or continuation state.

The always-listed `journal_observation_status` tool accepts `{}` and returns:

```json
{
  "ok": true,
  "writesEnabled": true,
  "setupRequired": false,
  "journalId": "the-authenticated-owner-journal-id",
  "revision": 2,
  "eventCounts": { "abstain": 2 },
  "lastRecordedObservationAt": "2026-10-17T12:00:00.000Z",
  "sources": {
    "configuration": {
      "publisher": "unconfigured",
      "calendar": "unconfigured",
      "reviewedPrices": "unconfigured"
    },
    "checkedAt": null,
    "pendingReasons": [
      "publisher_unconfigured", "calendar_unconfigured", "reviewed_prices_unconfigured"
    ]
  }
}
```

No journal is created by reading or observing. The user must already have created
their journal through the existing UI. When setup is absent the ID is null,
revision is zero and setupRequired is true.

`sourceConfiguration` is a sealed server declaration with exactly `publisher`,
`calendar` and `reviewedPrices`, each `configured` or `unconfigured`; the default
and current production declaration mark all three unconfigured. A configured
reader is not a tested or ready feed. This read-only tool performs no provider
check, so `sources.checkedAt` stays null and its pending reasons describe only
missing configuration. `lastRecordedObservationAt` comes from saved observation
events and is null when none exist; it is not a source check timestamp. The latest
run's actual publisher status, timestamp and pending reasons are returned in that
observation response's `automation` object. No-op observations have no persisted
check timestamp and the next status read must not imply otherwise.

`journal_observe_scheduled` is enabled in the production source profile and is
also listed. Its exact arguments are:

```json
{
  "expectedJournalId": "the-journal-id-returned-by-status",
  "expectedRevision": 2,
  "requestId": "a-fresh-occurrence-id"
}
```

1. Read status using the connected caller identity. Stop if setup is needed or
   writes are disabled. Preserve the returned journal ID and revision.
2. Choose one fresh request ID for this occurrence. Call observe once with that
   exact ID, expected journal ID and expected revision. The server supplies time
   and readers. The task supplies no publication, calendar, marks, owner or trade.
3. A success returns the persisted revision, event counts, appended count and
   bounded observer status. It may append honest abstentions or leave outcomes
   pending when sources are unavailable. It does not mean an eligible suggestion
   or a filled trade exists.
4. After a lost response, preserve the **original arguments**. Read status to
   reconcile; do not advance the expected revision and replay the same occurrence.
   An exact retry can make at most one mutating append because all mutations use
   the original revision CAS. A newer revision means reconcile, not success.
5. `journal_commit_uncertain` never proves failure or success. Read the saved
   history through the authenticated UI/API if needed. Do not automatically rebase
   or make a new request ID to bypass a conflict. A later planned occurrence can
   read current state independently.
6. `journal_capacity_exceeded` returns `retry: "pause_capacity"`; pause repeated
   observations and retain/export the history through the existing owner flow.
   It must not produce a rapid retry loop or truncate history.

This is **revision-based at-most-once mutation for an exact argument tuple**, not
a durable occurrence ledger or an exactly-once scheduler. A successful no-op has
no stored receipt. Repeating it can re-read sources, and may append if sources
become eligible while that same expected revision remains current. A request ID
alone is not a durable idempotency key; changing expectedRevision creates a new
attempt. The interface deliberately does not auto-retry either conflicts or
uncertain commits.

## Persistence and time boundaries

The adapter calls `handleJournalRequest` in-process with a new server-built
request. It forwards only the platform-validated caller identity. The exact
journal ID is checked both during the preliminary read and against the history
actually supplied to the observer, covering an empty-journal restore at revision
zero. The existing D1 CAS binds owner, revision, journal ID and creation time;
its atomic batch protects against a later restore or concurrent append.

All publication, calendar and reviewed-price authority remains in injected
server readers. The production Worker currently configures all three as null.
Provider captures marked `captured_unvalidated` are not accepted as reviewed mark
authority merely because a transport succeeded. The scheduler passes none of
those inputs and performs no network request of its own.

The observer's existing kind allowlist blocks actual confirmations, fills and
fill revisions. Existing event validation, append-only checks, fresh server time,
entry-deadline rechecks and pending/no-fill semantics remain authoritative.
Missing historical observation cannot create a backdated paper entry.

The observer proposal is bounded by a timeout (10 seconds by default, maximum
30 seconds). A timed-out or aborted proposal is discarded; a later resolution
cannot enter the commit path. A cancellation check runs before D1 dispatch. Once
a batch has been dispatched, it is never raced against a timeout: a lost
acknowledgement or failed readback remains uncertain until reconciliation.

## Activation checklist for the coordinating owner

The source capability is prepared; actual connection and schedule activation
require the following verification:

1. Retain the current Site and audience. Read fresh `get_site`, confirm owner
   access and inspect every existing linked automation before adding anything.
2. Publish the tested source with the additive `"mcp"` hosting capability. The first native connection check must be read-only.
3. Obtain the provisioned plugin ID through `get_site(include_mcp_connection:
   true)`. Use the supported Install/Connect flow if the tools are unavailable.
   No separately invented auth token, OAuth server, DNS, or Worker Cron is needed.
4. Verify a fresh cloud task sees the connected tool schema and that a status
   read resolves to the intended owner journal. A service bypass request alone
   must continue to return authentication_required.
5. After the prepared writer is published and the owner status is verified,
   exercise one intended unattended observation with the exact current
   journal/revision and read back the persisted result. Reuse that initial
   observation if already verified; do not add duplicate history merely for QA.
   This verifies the writer independently from provider access. If source readers
   are still absent, report that observations can only abstain/remain pending.
6. Verify source access independently from the writer. The current publisher,
   calendar and reviewed-price readers are unconfigured. Connecting the writer
   alone therefore does not make recurring research or paper evaluation ready.
   First verify the actual approved publication archive and its identity/calendar
   contract through the unattended reader. Price evaluation additionally requires
   reviewed retained prices and matching benchmark evidence. A setup status or a
   successful provider transport does not supply those approvals. Missing future
   price evidence may remain pending after a real publisher is verified; an
   all-null source configuration is not a useful evaluation schedule.
7. Only after source access and cloud writer/readback verification, re-read linked
   schedules. Reuse a matching task without resuming a paused task implicitly.
   If none exists, call Sites create_schedule with the fresh returned request ID,
   requested timing, and the user's known timezone. Do not create when automations
   metadata is missing or null. On an uncertain creation reuse the same request
   ID and task details. Confirm saved timing and enabled/paused state.

A possible short schedule prompt, once source access and the connected tools have
been verified:

> Check my Cribscore journal and record current research observations using its
> connected journal tools. Evaluate pending paper outcomes only from the Site's
> configured reviewed sources. Keep missing data pending, follow the tools'
> revision-safe retry instructions, and report any unconfirmed run. Never record
> actual trades or confirmations.

The cadence belongs in the native schedule, not in this prompt. Creation only
confirms that a task was saved; it does not prove a scheduled run has executed.
Do not substitute a recurring status/no-op check for the requested research and
evaluation. A deliberately limited retained-snapshot log is a separate scope and
requires the owner to want that outcome and its snapshot source to be verified.

## Verification

`tests/scheduled-journal-mcp.test.mjs` executes the real journal API and SQL against
isolated in-memory SQLite. It covers authentication, service-token non-identity,
owner isolation, schema/body rejection, journal restore races, missing/stale
readers, duplicate/concurrent calls, no-op handling, complete rollback, uncertain
commit acknowledgements, late/aborted proposals, deadline crossing, no historical
fill fabrication, rejection of actual confirmation events, and error redaction.
The build graph also includes this module without publishing it as a static
asset. Hosted connection and live unattended writer verification remain separate.
