# Import daily prices for chart context

Open **Prices → Import daily price data**, choose a JSON file, then select **Import price data**. This immediately loads valid chart data and replaces the previous imported batch. Imports stay in the current tab; reloading clears them. A rejected file leaves the previous batch intact. Keep your original file.

The import disclosure links to the same-site **JSON format guide and example** in a new tab. Its example is inert, explicitly synthetic text; reading the guide does not import a dataset or contact a provider. The original app tab stays open with its current imported data.

Imports remain unreviewed. They cannot create paper trades, supply journal marks, change rankings or activate a market-data connection. The separate TradingView chart does not contribute imported bars or journal prices.

## Start with a clearly synthetic example

[synthetic-price-import.json](examples/synthetic-price-import.json) is a complete, importable example. **Every value, symbol and clock in it is invented for format practice. It is not historical or current market data.** `DEMO` has no configured hosted chart. Its old synthetic capture, missing source evidence, unknown actions and unknown calendar intentionally produce warnings.

For a real file, replace the example with records you are permitted to use and their actual source metadata. Leave unknown nullable metadata `null` and use `unknown` where the schema provides that option; do not create a capture time, source digest or review merely to remove a warning.

## Required shape and exact values

| Field | What to supply |
| --- | --- |
| `schemaVersion` | `cribscore-price-series-v1` |
| `id`, `symbol`, `currency` | A distinct series ID, uppercase symbol and three-letter currency |
| `sessionTimezone`, `interval` | An IANA zone such as `America/New_York` or `Etc/UTC`; interval must be `1d` |
| `priceBasis` | `unadjusted`, `split_adjusted`, `total_return_adjusted` or `unknown`, according to your source |
| `volumeBasis` | `shares`, `split_adjusted_shares` or `unknown` |
| `source` | Nonempty `provider` and `dataset`; actual source URL/clocks/digest where known; `channel: "manual_import"` |
| `bars` | Daily `session`, `open`, `high`, `low`, `close`, and `volume` |

Use ordinary **quoted decimal strings** for OHLC, such as `"0.0000001"` or `"999999999999.123456"`. Supported prices are positive, at most `1000000000000`, with up to 12 fractional places. Avoid commas, currency signs and exponent strings. High/low must contain the open/close. Supply volume as a number or `null`; ordinary share volume must be a whole number. Unknown volume is not zero.

You do not need to author `bars[].decimals`. Normalization generates canonical exact strings; the display uses `points[].decimals` and `latest.closeDecimal`. Re-imported normalized files must keep their numeric and decimal fields consistent. Insignificant trailing zeros may disappear. Plot coordinates and indexed comparisons remain approximate.

## Dates, adjustments and missing coverage

`session` is the exchange-local date, `YYYY-MM-DD`. Source `capturedAt` is the actual retrieval time; `publishedAt` is a separately known publication time. Use UTC timestamps with seconds and `Z`, optionally 1–3 millisecond digits. Publication cannot follow capture. Optional bar `availableAt` must lie between known publication and capture; otherwise the parser uses capture, or known publication if capture is missing. Preserve original clocks when importing later.

The UI does not import a verified exchange calendar. A continuous line does not establish complete sessions, holiday coverage or early closes. Capture age, session coverage and source-declared delay describe different things; an unknown delay is not zero and daily history is not a live quote.

Use `actions.status: "unknown"` when split/dividend coverage is not established. An empty action list alone does not establish that nothing happened. Do not label split-adjusted data as total return. Missing actions may withhold the descriptive benchmark comparison.

## File limits and provider exports

Files may contain at most 2 MiB, 16 series, 5,000 bars per series and 40,000 bars in total. Session dates must be unique within each series; series IDs and symbols must be unique within a batch. Duplicate JSON keys are rejected. To load several companies together, wrap their series objects in:

```json
{"schemaVersion":"cribscore-price-import-v1","series":[]}
```

Replace the empty array with 1–16 complete series objects. This UI accepts JSON only. CSV requires a separate developer conversion with metadata. A raw Alpaca response is also not this format: the staged adapter requires retained request, capture and security context before normalization. It makes no requests, verifies no account entitlement and supplies no corporate-action coverage. Uploading its output still produces an unreviewed manual import. Never include account keys or credentials in a file or source URL.

See [the technical contract](price-domain-contract.md) for the full schema and the separate calendar, action and source-review requirements for any future journal use.
