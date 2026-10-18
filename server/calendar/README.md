# Trading calendar reader

`nyse-2026.json` is the 2026 NYSE regular-session calendar: every weekday of 2026 that is not a listed exchange holiday, with UTC open and close instants for America/New_York (9:30 to 16:00, 13:00 on early-close days). The holiday and early-close lists were read from the exchange hours page captured on 2026-10-18. The record keeps that page's URL, byte count, SHA-256 and capture time. The page bytes are not stored in the repository.

The record ships as `status: "captured_unreviewed"` with `reviewer: null`. `calendar.mjs` serves it to the journal observer only when the status is `verified_complete`, so production behaves exactly as it did with no calendar reader until the owner reviews it. A reviewed record that fails `validateCalendarRecord` is answered as unavailable and never served.

## Owner review

Open https://www.nyse.com/trade/hours-calendars and compare it with the record.

1. The ten 2026 holidays match the page's 2026 column, date for date.
2. The 2026 early closes at 1:00 p.m. ET match the page footnotes: November 27 and December 24.
3. Core trading hours are 9:30 a.m. to 4:00 p.m. ET.
4. `node --test tests/calendar-record.test.mjs` passes. It checks the sessions against the lists, weekends, DST instants and ordering.

To mark the record reviewed, edit three fields in `nyse-2026.json`:

- `status`: `"verified_complete"`
- `reviewer`: your identifier
- `reviewedAt`: the UTC time of the review, at or after `source.capturedAt`

Then run `npm run build`, `npm test` and `npm run validate:worker`. The scheduled MCP status reads its source labels from `worker/index.js` (`sourceConfiguration.calendar`); set that to `configured` in the same change. From then on an observation with a publication resolves its paper window from this record. `tests/calendar-reader.test.mjs` shows the expected result for a publication on 2026-10-18: entry 2026-10-19 13:30Z, exit 20:00Z for one session and 2026-10-23 20:00Z for five.

Any other change to the record is a new capture. Update `source` from a fresh fetch and set the status back to `captured_unreviewed` until it is reviewed again. Coverage ends 2026-12-31; 2027 needs its own capture and review.
