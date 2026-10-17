# Offline Alpaca capture review preparation

This is an offline, server-only consistency boundary. It performs no request, secret lookup, persistence, scheduling, journal write or source approval. All tests use synthetic bodies, credentials, grants and ledger records. It is not connected to an endpoint or an observer reader. The existing setup-status route remains a status-only inspection and must not invoke capture or this function as a side effect.

## What is established

`prepareAlpacaCaptureReview` rehashes exact retained response bytes, matches an accepted owner-bound host receipt and a canonical transport-envelope fingerprint, and independently re-adapts those bytes with the original explicit request. It preserves response-observation time as bar availability; New York midnight is only the provider's session label. It requires the same prior-New-York-date holdout, delayed SIP/raw/USD/single-symbol daily scope and dated mapping as the collector. It produces an immutable, private review draft with `review:null`.

The checks establish consistency between supplied bytes, metadata and host records. They cannot establish that Alpaca sent those bytes, that the host reviewer is authenticated, that an account is entitled, or that source rights were lawfully granted. Hashes are not signatures. The host must supply authenticated, immutable, correctly scoped records from its own storage. A browser-supplied receipt and matching hash are never authority. The function deliberately records `sourceAuthenticity:'trusted_host_records_not_independently_authenticated'` and `rawBytesReverifiedHere:true` together.

The function grants no display, ranking, mark, retained-derivative or trading permission. `paperMarksEligible`, `eligibleForRanking`, `displayAllowed`, `reviewedPricesReady` and `automaticTrading` remain false. A successful `review_required` result is not a reviewed source. `resolvePriceMark` rejects both its null review and its proposed review bindings.

## API and trusted inputs

```js
import {
  fingerprintAlpacaEnvelope,
  prepareAlpacaCaptureReview,
} from './alpaca-capture-review.mjs';

const result = await prepareAlpacaCaptureReview({
  envelope,         // one fetchAlpacaDailyBars result, never client JSON
  retainedBytes,    // exact Uint8Array bytes from authorized host retention
  ingestionRecord, // accepted host record below
  authorization,   // original authenticated fetch/normalize review
  retentionReview, // trusted source store grant, below
  processingReview,// trusted source transform grant, below
  ownerScope,      // authenticated host owner scope
  at,              // actual UTC preparation clock
  cutoffAt,        // explicit evidence cutoff, no later than at
});
```

`fingerprintAlpacaEnvelope(envelope)` computes a deterministic SHA-256 of bounded JSON structure. Object-key order is ignored, array order and explicit null are retained. It rejects accessors, serialization hooks, undefined values, nonfinite numbers, negative zero, sparse arrays, non-JSON objects and inputs exceeding its depth/node/size bounds. It returns null on failure. It does not sign or accept an envelope into a ledger. The host computes and retains the digest when it accepts the observation, not from a later client-provided envelope.

`envelope` must be the complete first page returned by `fetchAlpacaDailyBars`. For a one-page `fetchAlpacaDailyHistory` result, use its original `pages[0]`, not the collection wrapper. Capture sets, continuation pages and missing token metadata fail closed. A separate reviewed capture-set ledger is still required before combining pages; no composite hash is placed in the existing single-response hash field.

The retained bytes must be 1–2,000,000 bytes. The function copies them, including Node Buffer views, and snapshots all records synchronously before its first asynchronous operation. Changing caller memory during hashing cannot replace what is being verified. Strict UTF-8 decoding and the current duplicate-key/decimal/volume parser are applied again. BOM and whitespace remain part of the original response hash.

The accepted ingestion record has these bindings:

| Fields | Meaning |
| --- | --- |
| `state:'accepted'`, `id` | An existing accepted host ingestion record |
| `captureId`, `captureIdSource:'host_ingestion_ledger'` | Host-assigned retained capture identity; replaces the transport-local series ID in the draft |
| `ownerScope`, `reviewerId`, `sourceRefs` | Authenticated owner and host review audit references; authentication must happen outside this function |
| `provider:'alpaca'`, `dataset:'historical-stock-bars'`, `securityId` | Provider/dataset and the series permanent-identity binding, still requiring independent identity review |
| `transportSeriesId` | Original transport-local series ID |
| `responseSha256`, `responseByteLength` | Exact retained raw-byte digest and count, equal to transport capture |
| `transportEnvelopeSha256` | Envelope fingerprint accepted by the host |
| `authorizationReviewId` | Original capture review identity |
| `requestURL`, `requestStartedAt`, `responseCompletedAt` | Exact transport request and actual capture clocks |
| `storedAt`, `reviewedAt`, `ingestedAt` | Actual ordered host events: response completion ≤ storage ≤ ingestion review ≤ ingestion acceptance ≤ cutoff |

Unknown source publication time remains null. Host `storedAt`, `ingestedAt` and review times must not be invented from the provider timestamp or from the time this helper is called. Each digest, URL, identity and clock must match the accepted original records. No ingestion ID or capture ID is generated here.

`authorization` uses the fetch/normalize schema in [ALPACA.md](ALPACA.md). Both operations are checked at original request start and completion. An original grant that has since expired can support historical consistency verification only when retention and transformation are independently authorized now. This does not re-enable a fetch under an expired grant.

`retentionReview` and `processingReview` use a narrow subset of the existing market-ingestion source-use vocabulary:

| Field | Required shape |
| --- | --- |
| `id`, `version` | Retained evidence identity and positive integer version |
| `providerId`, `datasetId` | `alpaca`, `historical-stock-bars` |
| `ownerScope`, `audience`, `purpose` | Exact owner, `owner_private`, `market_data_research` |
| `securityIds` | Exactly the one permanent security identity in this capture |
| `urls` | Exactly `https://data.alpaca.markets/v2/stocks/bars` |
| `reviewedAt`, `validFrom`, `expiresAt` | UTC interval, reviewed no later than validFrom; operation occurs within the interval |
| `operations.store` | `allowed` in retentionReview, covering original storage and current retention |
| `operations.transform` | `allowed` in processingReview, covering current preparation |
| `termsEvidence` | Nonempty bounded list of `{url, sha256, observedAt}` for actual reviewed evidence; observed no later than the review |

These shapes are not real grants and must not be completed with made-up IDs, hashes or conclusions. The host must resolve current versions, revocations, conflicts, renewals, account classification, source-specific terms and retention obligations before supplying a grant. This minimal boundary accepts one retention review covering both original storage and current retention. It does not resolve an append-only review history or support a renewal chain; such cases remain withheld until the host implements the complete policy resolver. The helper is not a substitute for `market-ingestion.mjs`'s broader rights/history checks.

## Output and minimal host integration

Failure is `status:'withheld'`, with a bounded reason and no draft or price series. Success is `status:'review_required'`, with public-safe pending requirements and false eligibility flags. Its `privateDraft` property is non-enumerable to avoid accidental inclusion in a status response. That property remains accessible to server code: non-enumerability is an accidental-serialization guard, not access control. Do not copy it into browser output without a separately authorized display path.

The draft contains the canonical series under the host capture ID, `review:null`, exact lineage, and `requiredPaperReviewBindings`. Those bindings omit `status:'verified'`, `allowedUse:'paper_marks'`, approval identity and actions hash on purpose. They identify what a later independently approved review must bind; they do not constitute that review.

The minimal future integration is:

1. Authenticate the existing owner and load that owner's immutable capture/receipt/rights records through server-only storage APIs. Resolve rights at capture, original storage and current processing times, including any later revocation.
2. Supply actual retained bytes and accepted records to this helper. A missing receipt, changed bytes, mismatched series, unsupported capture set or missing source-use authority stays withheld.
3. Present the private draft only to an authorized review workflow. Separately establish permanent security identity, exchange calendar, complete corporate-action evidence, permissible price basis and source use. Persisting the draft or displaying prices requires the corresponding explicit source/derived-use policy; this helper writes nothing.
4. After all independent approvals, create the existing price-domain source review, including its exact series/source/action bindings and allowed use. The host's `readReviewedPrices` may then supply the approved series/reviews per immutable publication, with symmetric stock and benchmark evidence. This module does not perform that transition.

There is no production retained-byte loader or authorized retention sink in this patch. The collector currently returns a digest and normalized series, not a durable raw-byte store. A future authorized capture path must check store permission before retaining bytes and atomically bind the same immutable bounded bytes to the host receipt. Copying a JSON reserialization is not exact-byte retention. Tests supply separately retained synthetic bytes; they do not demonstrate a live capture-to-storage operation.

The Tiingo observed bridge cannot be reused by declaring Alpaca captures to be Tiingo. It relies on provider-specific corporate-action and price/volume basis evidence. Alpaca's price capture contains no complete action record, and its daily volume includes extended hours. This helper therefore does not produce the market-ingestion snapshot or score/return evidence expected by that bridge.

Entry remains October 19, 2026 at 13:30 UTC; day exit October 19 at 20:00 UTC; week exit October 23 at 20:00 UTC. A completed daily bar only supplies a delayed hypothetical opening/closing reference after observation and review. The prior-New-York-date collector holdout still defers final-day collection. No earlier close substitutes for the entry open; immutable publication/intent, frozen windows and equivalent benchmark evidence remain required. These bars are not official auction executions or current executable quotes.

## Incremental transport corrections

Collector `alpaca_daily_capture_v1.1` adds two independently reproduced integrity fixes:

- Volume tokens are checked before JavaScript numeric conversion. Fractional `9007199254740991.1` previously rounded to an accepted safe integer; `-1e-400` underflowed to negative zero. Numeric `v` now requires an exact nonnegative decimal integer within the safe integer range. Exponent, fractional, negative and negative-zero spellings fail closed. Null/missing volume remains unknown.
- Each received stream chunk is copied before the next await. A producer reusing a Buffer or Uint8Array can no longer change previously received bytes before concatenation, hashing and normalization.

Valid original v1 envelopes may be reverified using the current strict parser. A legacy payload containing one of the newly rejected volume spellings cannot pass merely because an old collector accepted it. Original checkpoint files and evidence remain available separately; this increment does not rewrite their results.

## Primary-source limits

The primary-source findings below were recorded in the October 17, 2026 source assessment. The [Alpaca API overview](https://docs.alpaca.markets/us/docs/about-market-data-api) and [FAQ](https://docs.alpaca.markets/us/docs/market-data-faq) establish authenticated delayed-history behavior, not this owner's current entitlement or a hosting/display/retention license. The [provider terms](https://files.alpaca.markets/disclosures/library/TermsAndConditions.pdf) require a use-specific review; the linked underlying Nasdaq/NYSE agreements were not readable during that assessment. No underlying-source exemption or blanket permission was certified. [Historical bars documentation](https://docs.alpaca.markets/us/reference/stockbars) describes the data interface; reaching that interface is not permission.

No permissible credential-free source was established among the assessed candidates. This is a bounded result, not a claim about every possible source. No market data, key, subscription, agreement, external write or live journal entry was acquired or created for this offline increment.
