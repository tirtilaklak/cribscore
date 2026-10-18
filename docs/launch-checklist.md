# Launch checklist

Sunday 2026-10-18. The Site at cribscore.co becomes readable by anyone today. Server authentication does not change. The journal, price-setup and `/mcp` routes keep requiring the platform identity header, and the browser shows an owner-only state without it (commit 4c1af0c).

Do the steps in this order. Times are UTC.

## 1. Export the journal

Open the Site signed in. Journal → Backup & restore → Export journal. Keep the file. It holds the journal identity, events and revision history. If the audience change has to be reverted, this file is the fallback.

## 2. Flip the audience

In ChatGPT Sites: Share → Who has access → Anyone on the internet. On a Business or Enterprise workspace a workspace admin must enable public publishing before this option appears.

Then open https://cribscore.co in a private browser window. The desk loads without sign-in. The Journal tab reads "Owner-only journal". Price setup reads owner-only.

Also open the Site from inside ChatGPT, on the web and in the app. The page may only be framed by chatgpt.com and openai.com origins (`frame-ancestors` in `worker/index.js`). If it renders blank inside ChatGPT, the platform frames it from another origin: add that origin to the directive and redeploy.

## 3. Verify that a forged identity header is rejected

```sh
curl -sS -o /dev/null -w '%{http_code}\n' -H 'oai-authenticated-user-id: forged' https://cribscore.co/api/journal
```

Expected: `401`. The Worker must never receive a caller-supplied value for this header. Any other code means an outside caller can choose an owner id. Go to step 5.

## 4. Verify that the owner still has the journal

In the signed-in ChatGPT session, reload the Site and open Journal. The saved journal and its revision appear with the normal controls. Run Check journal sync. It must read the saved revision without a conflict. Price setup shows its status and reasons.

A curl cannot do this check. Only the platform can send a real identity header.

## 5. If step 3 or step 4 fails

Set Who has access back to the previous setting. Keep the export from step 1 unchanged. Do not import, restore or delete anything. If step 3 returned a code other than 401, compare the revision the owner sees with the revision in the export before trusting the hosted history. Fix the cause before trying again.

## 6. Monday 2026-10-19

The retained snapshot is `manual-2026-10-17`. Its windows are fixed in `dist/data/stock-evidence.json` under `event_evidence.horizons`: entry 13:30Z, next-day exit 20:00Z, week exit Friday 2026-10-23 20:00Z. Both horizons share the entry time.

| Time | What happens |
| --- | --- |
| Before 13:30Z | Both horizon cards read Upcoming. An abstention for the day is recorded only while the owner has the app open with a journal set up. Nothing runs unattended. |
| 13:30Z | Entry. The cards switch to Window in progress and state that the original entry has passed. No position is created: the publisher, calendar and reviewed-price readers are null in `worker/index.js`. |
| 20:00Z | Close. The next-day card becomes Archived snapshot. The week card stays in progress until Friday 20:00Z. |
| 20:00Z to Tuesday 13:30Z | Build and deploy the successor snapshot if Tuesday should show an upcoming window. The snapshot is hand-reviewed JSON; nothing generates it. Edit `dist/data/stock-evidence.json`, run `npm run build`, `npm test` and `npm run validate:worker`, then deploy with the Sites workflow in `worker-journal-operations.md`. Moving the entry time also redefines the week window. |
| Tuesday 2026-10-20 | Earliest New York date on which an Alpaca daily bar for Monday can be captured. The collector refuses a bar whose session date equals the request date (`server/market-data/ALPACA.md`). Price readers are unconfigured, so no paper mark settles either way. |
