# SEC rights review

The Evidence room shows one fact: Apple's fiscal 2023 net income from its original Form 10-K. The fact is shown only while a rights review for the `display` operation is current. The shipped review expired at 2026-10-17T23:34:24Z. Since then the room shows no numeric fact.

## How the review works

The review is a JSON object with `reviewId`, `version`, `reviewedAt`, `validFrom`, `expiresAt`, `termsUrl`, `purpose`, `sourceBinding` and `operations`. It is checked at each operation against the clock at that moment.

Capture, in `scripts/sec-adapter.mjs`:

- `rightsGate(review, operation, at)` starts at line 25. Line 32 fails unless `reviewedAt <= at`, `validFrom >= reviewedAt`, `validFrom <= at` and `expiresAt > at`. The gate also requires `version >= 1`, `termsUrl` equal to `https://www.sec.gov/privacy`, `purpose` equal to `historical_financial_facts`, the exact CIK, accession and two URLs of `SEC_TARGET`, and `operations[operation] === 'allowed'`.
- `runCapture` reads `evidence/sec-rights-review.json` at line 100. It gates `fetch` before each document, then `transform` and `store`, then `display` at line 133 with the ingestion time. The whole review object is written into the record as `rights` and the record into `dist/data/sec-evidence.json`.

Display, in `dist/lib/evidence.js`:

- `inspectRights` (lines 48-78) picks the most recent review whose `reviewedAt` and `validFrom` are at or before the operation time. An `expiresAt` at or before that time adds `display_rights_expired` (line 71). Fetch, store and transform are rechecked at their recorded times; display is checked at view time (lines 157-162).
- `refreshFactEligibility` in `dist/app.js` (line 174) runs the inspection at display time and sets a timer for the next `reviewedAt`, `validFrom` or `expiresAt` boundary, then re-renders. The fact disappears at the expiry instant and the room shows "Evidence is not yet ready to display" with the reasons.

The code does not fix the review length. It requires `expiresAt` to be after `validFrom` and after each operation time. The 24 hours in the shipped review (`sec-facts-review-20261016-v1`, `validFrom` 2026-10-16T23:34:24Z, `expiresAt` 2026-10-17T23:34:24Z) is a policy choice recorded in its `rationale`.

`tests/adversarial.test.mjs` ("served SEC payload cannot label incomplete capture as numeric verified evidence") inspects the shipped record with the real clock. It fails while the review is expired. Author a new review; do not change the test.

## Author a new review

1. Read the SEC pages listed under `sources` in the shipped review: developer resources, accessing EDGAR data, privacy. Decide the operations and the validity period.
2. Write `evidence/sec-rights-review.json`. The file is tracked; `.gitignore` excludes only `evidence/sec-original/` and the capture manifest. Required fields:

   ```json
   {
     "reviewId": "sec-facts-review-YYYYMMDD-v1",
     "version": 1,
     "reviewedAt": "<UTC time of this review>",
     "validFrom": "<reviewedAt or later, never in the future>",
     "expiresAt": "<after validFrom>",
     "termsUrl": "https://www.sec.gov/privacy",
     "purpose": "historical_financial_facts",
     "sourceBinding": {
       "cik": "0000320193",
       "accession": "0000320193-23-000106",
       "urls": [
         "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
         "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/0000320193-23-000106-index.html"
       ]
     },
     "operations": { "fetch": "allowed", "store": "allowed", "transform": "allowed", "display": "allowed" }
   }
   ```

   Copy `scope`, `rationale`, `limits` and `sources` from the shipped review in `dist/data/sec-evidence.json` and update them to match the decision. The gates do not read them; they are kept for the record.

3. Set the declared user agent and run the capture:

   ```sh
   CRIBSCORE_SEC_USER_AGENT='Cribscore/1.0 (your-contact@example.com)' npm run capture:sec
   ```

   The value must start with `Cribscore/`, be at most 250 characters and contain no line break (`sec-adapter.mjs:88`). SEC's EDGAR access guidance asks for a name and contact address in the user agent. The script fetches the filing index, waits 1.1 seconds, fetches the document, checks each gate, writes the audit bytes to `evidence/sec-original/` and the manifest to `evidence/sec-capture-manifest.json` (both ignored), and writes `dist/data/sec-evidence.json`. Success prints `{"status":"verified","records":1,...}`. Failure prints `{"status":"blocked","reason":...}` and exits 1. Stop on `sec_http_403_stop_no_retry` or `sec_http_429_stop_no_retry`. Do not retry, rotate identities or change endpoints.

4. Run `npm run build`, `npm test` and `npm run validate:worker`. The adversarial test passes again while the review is current.
5. Commit `evidence/sec-rights-review.json` and `dist/data/sec-evidence.json`. Deploy with the Sites workflow in `worker-journal-operations.md`.

## The daily dark period

With a 24-hour review the public Evidence room loses its fact once a day, at `expiresAt`, until someone reruns the capture with a new review. The capture is `manual-run-only` (`automation` in the payload). Options, undecided:

- Keep 24 hours and rerun the capture every day before expiry. Each rerun is a new SEC fetch and a new review.
- Choose a longer period in the review. The code accepts any `expiresAt` after `validFrom`. The period is how often the terms are reread.
- Change the display policy so a fact stays visible after its display review lapses, labelled as such. This is a code change in `evidence.js` and removes a deliberate guard.
- Drop the numeric fact and keep the Evidence room as a source-link room.
