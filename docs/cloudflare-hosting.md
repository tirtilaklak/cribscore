# Host Cribscore on Cloudflare

This runbook moves cribscore.co from the old host to a Cloudflare Worker in your own Cloudflare account. Follow the steps in order. Each step says what to check before you go on.

## How the site stays private

Two locks guard every request.

1. **Cloudflare Access** sits in front of cribscore.co and www.cribscore.co. A visitor must sign in with an allowed email address before any request reaches the Worker.
2. **The Worker checks again.** The Cloudflare entry, `worker/cloudflare.js`, reads the signed token that Access adds to each request (the `Cf-Access-Jwt-Assertion` header). It checks the signature against your team's public keys, the issuer, the audience tag and the time limits. It checks that the email address is on the `OWNER_EMAILS` list. It deletes any `oai-` header a client sent. Only then does it set the journal owner from the token.

If any check fails, the Worker answers 403 and does nothing else. That includes pages, scripts and styles. It also answers 403 when its Access settings are empty and when `OWNER_EMAILS` is missing or blank.

The Worker has no `workers.dev` address and no `workers.dev` preview addresses. `wrangler.jsonc` turns both off. Its `preview_urls` setting covers only `workers.dev`. Each custom domain has its own **Preview** setting, and `wrangler.jsonc` does not control it. Step 7 Part C keeps it off. With all of these off, the two custom domains are the only way in.

No other site may show these pages inside a frame. Every response says so with `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`.

The old host keeps using `worker/index.js`. That file is unchanged.

## What you need

- A login to the Cloudflare account that holds the cribscore.co zone.
- Node.js and this repository on your computer. Run commands from the repository root.
- Wrangler, the Cloudflare command-line tool. The commands below run it with `npx wrangler@4`, so there is nothing to install. Sign in once with `npx wrangler@4 login`.

Your email address goes into the Access policy and into a Worker secret. It never goes into a file in this repository.

## Step 0. Plan the journal move

The journal does not move by itself. The new host keys the journal to your Cloudflare Access identity. The old host keyed it to your OpenAI identity. So the new journal starts empty.

You export the journal in step 7, right before cribscore.co leaves the old host. You restore it in step 8. Until step 7 you can keep using the old site as usual. Steps 1 to 6 can take hours. A backup made before them would miss what you record in that time, and those records would stay behind on the old host.

## Step 1. Check the Zero Trust team

Zero Trust is already on for this account. Do not create it again. If it is ever gone, the appendix at the end shows how to set it up.

1. In the Cloudflare dashboard, open **Zero Trust**, then **Settings**.
2. Find the team domain. For the live team it is `gentle-wildflower-930d.cloudflareaccess.com`. Step 3 compares it with `wrangler.jsonc`.

Check: the dashboard shows this team domain.

## Step 2. Check the Access application

The Access application already exists. At least one live setting differs from the list below (item 6). Check every item on the live application. Change what differs, or write down why you keep it. Finish this step before step 7. From step 7 on, this application is the first lock on cribscore.co.

Open **Zero Trust**, then **Access**, then **Applications**, and open **Cribscore**. Its application id is `c6fd3cd1-d6c1-49b4-a96c-98a33acd1dbf`. Step 3 checks its audience tag. If the application is gone, rebuild it with the appendix and then come back here.

1. **Destinations.** There are exactly two public hostnames: `cribscore.co` and `www.cribscore.co`. The path is empty on both, so they cover every path. Remove any other hostname, wildcard or path.
2. **Policy.** There is one policy. On the live application it is called "Owner only".
   - Action: **Allow**.
   - Include: **Emails**, with your email address. Add another address only if it is also in `OWNER_EMAILS` (step 5).
   - There is no **Everyone** rule.
   - There is no **Bypass** or **Service Auth** policy.
   - There is no Include rule that lets a request in without a person signing in, for example an IP range or a service token.
3. **Other applications.** In the **Applications** list, no other application covers `cribscore.co`, `www.cribscore.co` or a path under them. A second application with a **Bypass** policy on such a path would let requests past the first lock.
4. **Login methods.** The live application accepts two: your Cloudflare account and **One-time PIN** (a code sent to your email). Each method you keep must prove that you own the email address in the policy. Turn off any method you do not use. If you keep both, step 8 check 5 confirms that both open the same journal.
5. **Session duration.** The live application keeps you signed in for 24 hours. Keep it at 24 hours. You chose this on 25 Oct 2026, so you sign in once a day. The Worker's own token check stays the second lock. A shorter session limits how long a stolen sign-in cookie works. Then open the "Owner only" policy. Its session duration must be **Same as application session timeout**. Any other value replaces the 24 hours.
6. **Cookie settings.** Open **Advanced settings**, then **Cookie settings**. On 25 Oct 2026 the live application had SameSite Lax and HttpOnly on. Binding cookie was off.
   - Set **SameSite** to **Lax**. The default sends the sign-in cookie even when another site loads cribscore.co in a frame. Lax stops that. Do not pick Strict. It can trap the sign-in in a loop of redirects.
   - Keep **HttpOnly** on. Scripts on the page then cannot read the cookie.
   - Turn on **Binding cookie**. A copied sign-in cookie then fails without its partner cookie from your browser. If sign-in loops after this change, turn it off again and write that down.
7. Save the application if you changed anything.

Check: you looked at every item above on the live application. Each one matches, or you wrote down why it differs. The session duration is 24 hours. The session duration of the "Owner only" policy is **Same as application session timeout**. The cookie settings show SameSite Lax, HttpOnly on and Binding cookie on.

The menu names in the dashboard change from time to time. Look for the same ideas under nearby names.

## Step 3. Check the audience tag and team domain

`wrangler.jsonc` already holds both values for the live Cribscore application under `vars`. Check that they match the dashboard.

1. Open the Cribscore application in Access. Find its **Application Audience (AUD) Tag**. It is 64 letters and digits. It must equal `ACCESS_AUD`.
2. Find your team domain from step 1, for example `yourteam.cloudflareaccess.com`. It must equal `ACCESS_TEAM_DOMAIN`, without `https://`.
3. If you ever create a new application or team (see the appendix), put its values into `wrangler.jsonc` and commit the change.

These two values are identifiers. They grant no access, so they can sit in the repository. Each deploy sends the `vars` in this file and replaces the values the dashboard holds. That is why they live in the committed file: a deploy from any clean checkout carries them. If either value is empty or malformed, the Worker answers 403 to everyone. `npm test` checks their shape.

Leave `IDENTITY_MODE` as `cloudflare-access`. The Worker refuses every request when it has any other value.

## Step 4. Set up the database

1. The D1 database (Cloudflare's SQLite database) `cribscore` already exists. Its `database_id` is in `wrangler.jsonc`. Check it against the list:

   ```sh
   npx wrangler@4 d1 list
   ```

2. Only if you ever need a new database, create it with `npx wrangler@4 d1 create cribscore`. Put the `database_id` it prints into `wrangler.jsonc` and commit the change.
3. Apply the schema. The migrations are the SQL files in `drizzle/`:

   ```sh
   npx wrangler@4 d1 migrations apply cribscore --remote
   ```

4. Confirm nothing is left to apply:

   ```sh
   npx wrangler@4 d1 migrations list cribscore --remote
   ```

Check: the list shows no pending migrations.

## Step 5. Set the allowed email addresses

`OWNER_EMAILS` holds the addresses the Worker lets in. Separate several addresses with commas. Case does not matter. It is a secret, so it never sits in `wrangler.jsonc`.

`wrangler.jsonc` marks `OWNER_EMAILS` as required. Wrangler stops a first deploy that lacks it. It also stops a later deploy after the secret was deleted. Wrangler checks only that the secret exists. It does not look at the value. The Worker checks the value itself. When `OWNER_EMAILS` is missing, empty or blank, the Worker answers 403 to everyone, you included. The log shows `config_missing`.

A Worker that does not exist yet cannot take a secret in advance, so the first deploy brings it in a file:

1. Create a file **outside this repository**, for example `~/cribscore-secrets.env`, with one line:

   ```text
   OWNER_EMAILS=<your email>
   ```

2. You will pass this file in step 6, then delete it.

To change the list later, run `npx wrangler@4 secret put OWNER_EMAILS` and type the new list when asked. Keep it in step with the Access policy. Access is the first lock and `OWNER_EMAILS` is the second. An address must be in both to get in.

## Step 6. Build, test and deploy

1. Run the local checks:

   ```sh
   npm ci
   npm run build
   npm test
   npm run validate:worker
   ```

   Every test in `tests/cloudflare-access.test.mjs` must pass. Two kinds of failure are known and have nothing to do with hosting. On 25 Oct 2026 they are:

   - the SEC display-rights test in `tests/adversarial.test.mjs`. Those rights expired on 17 Oct 2026.
   - tests #3, #4 and #5 in `tests/independent-fill-a11y.test.mjs`. They check the journal form and fail at random, on `main` as well.

   Any other failure stops the deploy.

2. Try the bundle without uploading it:

   ```sh
   npx wrangler@4 deploy --dry-run --outdir /tmp/cribscore-dry-run
   ```

3. Deploy:

   ```sh
   npx wrangler@4 deploy --secrets-file ~/cribscore-secrets.env
   ```

   Wrangler runs `npm run build` first, then uploads the Worker.

4. Delete the secrets file:

   ```sh
   rm ~/cribscore-secrets.env
   ```

Check: the deploy output lists the `DB` database, `IDENTITY_MODE`, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` with your values. `npx wrangler@4 secret list` shows `OWNER_EMAILS`. The Worker has no address yet. That is expected.

**Every later deploy.** Run the same checks before you upload. Then apply any new database migration. A clean checkout has no `node_modules`, and the build needs them. `npm test` is the only automated check of the Access gate.

```sh
npm ci
npm run build
npm test
npm run validate:worker
npx wrangler@4 deploy --dry-run --outdir /tmp/cribscore-dry-run
npx wrangler@4 d1 migrations list cribscore --remote
npx wrangler@4 d1 migrations apply cribscore --remote
npx wrangler@4 deploy
```

`npm test` may show only the known failures from item 1 above. Any other failure stops the deploy. The committed `wrangler.jsonc` carries the vars and the database id. Secrets stay in place between deploys.

`npx wrangler@4 deploy` does not apply database migrations. The old host did that by itself. Here the two `d1 migrations` commands do it. `list` shows each SQL file in `drizzle/` that the remote database does not have yet. `apply` shows them again and asks before it changes the database. When there is nothing new, it says "No migrations to apply!" and changes nothing. Run both only after the checks above pass.

A migration runs before the upload, while the old code still serves requests. So each migration must keep working with the code that runs now. Add tables or columns. Do not rename or remove them in the same release. A rollback does not undo a migration. So the code you might roll back to (step 9) must work with it too.

## Step 7. Point cribscore.co at the Worker

Cloudflare cannot attach a custom domain while another DNS record holds the same name. So remove the old records first. The site is offline for the minutes between Part B and Part C. Do the three parts in one sitting.

**Part A. Export your journal from the old site.** Do this right before Part B. After Part B, cribscore.co no longer reaches the old host, and a record made there later stays behind.

1. Open cribscore.co and go to **Journal**.
2. Write down the counts the page shows: **Entries** and **Abstentions** under **Daily record**, and **Real trades you confirmed** next to **History**. If **Daily record** shows no counts, the journal has no entries yet. Write down 0 for those.
3. Open **Backup and restore** and choose **Export journal**. Keep the downloaded file somewhere safe outside this repository.
4. Close every cribscore.co tab. From now on, record nothing on the old site. An open tab can save an assessment by itself.

**Part B. Remove the old records.** In the dashboard, open the cribscore.co zone, then **DNS**, then **Records**. Before you delete anything, write down each record below with its proxy status (orange or grey cloud) and TTL. You need them to roll back.

- Delete the apex `A` record `cribscore.co` → `172.66.3.26`.
- Delete the apex `A` record `cribscore.co` → `162.159.143.30`.
- Delete the `CNAME` record `www` → `cname.vercel-dns.com`.

Leave every other record alone. That includes the `api` CNAME and the TXT records.

**Part C. Attach the custom domains.** Open **Workers & Pages**, then the `cribscore` Worker, then **Settings**, then **Domains & Routes**.

1. Add a **Custom domain**: `cribscore.co`. For **Enable for**, choose **Production** only.
2. Add a **Custom domain**: `www.cribscore.co`. For **Enable for**, choose **Production** only.

Do not choose **Preview** or **Production and Preview**. A preview makes Cloudflare add wildcard records such as `*.cribscore.co` and serve preview hostnames under them. The Access application covers only the two exact names, so those hostnames would skip the first lock.

Cloudflare creates the DNS records and the certificates. This can take a few minutes.

Check: in **Domains & Routes**, both custom domains are on for Production only, with Preview off. The `workers.dev` and **Preview URLs** switches are off too. `wrangler.jsonc` turns those two off. It does not control Preview on a custom domain. In the zone's **DNS** records there is no `*.cribscore.co` and no `*.www.cribscore.co` record. If you find one, turn Preview off on that domain and delete the record.

## Step 8. Check that it works

Run each check. Stop and roll back (step 9) if one fails.

1. **A visitor without sign-in is sent to Access.** Each of these should answer with a redirect (302) to `https://<team>.cloudflareaccess.com/...`. None should return the page or any data.

   ```sh
   curl -sI https://cribscore.co/
   curl -sI https://www.cribscore.co/
   curl -sI https://cribscore.co/app.js
   curl -sI https://cribscore.co/api/journal
   ```

2. **A forged owner header gets nowhere.** On the live site, Access stops this request before the Worker sees it, so the answer is the same redirect:

   ```sh
   curl -sI -H 'oai-authenticated-user-id: someone' https://cribscore.co/api/journal
   ```

   To see the Worker's own refusal, run it on your computer:

   ```sh
   OWNER_EMAILS=nobody npx wrangler@4 dev --port 8787
   ```

   `nobody` matches no address, so no one can sign in to this local copy. The value lives only in this one command. Do not create a `.dev.vars` or `.env` file in the repository for it, even if Wrangler suggests one. Without a value, Wrangler warns that `OWNER_EMAILS` is missing. The Worker then refuses everything with `config_missing`. That hides the check below.

   Then send the same header with no Access token:

   ```sh
   curl -si -H 'oai-authenticated-user-id: someone' http://127.0.0.1:8787/api/journal
   ```

   The answer must be `403` with a short text body. The dev server log shows `request denied (token_missing)`. Stop the dev server afterwards.

3. **The journal works for you and nothing was left behind.**
   1. Open https://cribscore.co in a browser. Sign in through Access with your email.
   2. Open **Journal**. It is empty, because the owner is now your Access identity.
   3. Open **Backup and restore**. Choose the file from step 7 Part A, then **Review backup**. Read the summary. Then choose **Apply reviewed backup**.
   4. Reload the page. Compare the counts with the ones you wrote down in step 7 Part A. **Entries**, **Abstentions** and **Real trades you confirmed** must each be the same. A number may be higher only if the new site has saved an assessment since then. That record shows at the top of **History** with a date after your export.
   5. Open https://www.cribscore.co and check that you see the same journal.

   If the review reports conflicts or records it cannot accept, stop there and keep the file. If any count is lower than the one you wrote down, records are missing. Keep the file and roll back (step 9). The records on the old host stay where they are.

4. **Sign out works.** Open https://cribscore.co/cdn-cgi/access/logout. Then load https://cribscore.co again. Access should ask you to sign in.

5. **Each login method opens the same journal.** Do this if you kept both login methods in step 2. Sign in now with the method you did not use in check 3. Open **Journal**. The counts must match the ones from check 3. Cloudflare gives one `sub` per email address in your account, so they should. If **Journal** is empty, do not start or restore a journal there. Sign out, turn that login method off (step 2, item 4) and write that down.

## Step 9. Roll back

Use this if a check fails or the new site misbehaves.

**First, read the log.** Run `npx wrangler@4 tail` and load the site. If your own requests show `owner_not_allowed` or `config_missing`, the `OWNER_EMAILS` list is most likely wrong or empty. Do not roll back for that. Run `npx wrangler@4 secret put OWNER_EMAILS` and type the right list. That command deploys at once. It makes a new deployment that keeps the code that runs now.

**If only the latest deploy is bad**, put the Worker back to the code that ran before it. The domains and DNS stay as they are. Always name the version you go back to. Without a version id, Wrangler goes back to the previous deployment. A `secret put` makes a deployment too. So after a `secret put`, a rollback without an id brings back the bad code.

1. List the deployments. The newest is at the bottom.

   ```sh
   npx wrangler@4 deployments list
   ```

2. Find the bad deploy by its **Created** time. Pick the newest deployment before it that ran good code. Copy the version id that follows `(100%)` under its **Version(s)**. A deployment whose **Source** is **Secret Change** still runs the code of the deployment before it. So never pick one that came after the bad deploy.
3. Roll back to that version:

   ```sh
   npx wrangler@4 rollback <version-id>
   ```

   Wrangler asks for a message and then for confirmation. A rollback does not change the D1 database.

4. Each version keeps the secrets it was made with. If a secret changed after the version you pick, Wrangler names it and asks first. If it names `OWNER_EMAILS`, answer **no**. Saying yes would bring back that version's older list. Instead, check out the last good commit and deploy it as in step 6, under "Every later deploy". A deploy keeps the secrets you have now.

After a rollback, Wrangler refuses `secret put` until you deploy again, because the newest upload is no longer the one running. To change `OWNER_EMAILS` after a rollback, first deploy the last good commit as in step 6. Then run `npx wrangler@4 secret put OWNER_EMAILS`.

After the first deploy there is no earlier version, so a rollback cannot help. Fix the problem and deploy again (step 6). If the site must come back now, use "To leave Cloudflare" below.

**To leave Cloudflare and go back to the old host:**

This way back works only for a short time. The old addresses `172.66.3.26` and `162.159.143.30` belong to Cloudflare. So the old host most likely serves cribscore.co as a custom hostname in its own Cloudflare setup (Cloudflare for SaaS). Once step 7 Part B removes the records, cribscore.co no longer points at that host. Cloudflare then marks the hostname as moved. After 7 days in that state, Cloudflare deletes it. From then on, adding the records back does not bring the old site back. The old host would have to add the domain again.

- Run the step 8 checks right after step 7. Decide on a rollback within a few days. Treat it as reliable only in that time.
- Keep the export file from step 7 Part A until the new site has worked for more than 7 days.
- Keep the TXT records, as step 7 Part B says.

1. **Export the journal from the new site first.** Do this before you remove either custom domain. Once a domain is gone, the new site no longer answers there. Open https://cribscore.co, go to **Journal**, write down the counts as in step 7 Part A, open **Backup and restore** and choose **Export journal**. Keep the file outside this repository. You can restore it on the old site the same way as in step 8, check 3. If the new site does not load at all, skip this step. Its records stay in the D1 database.
2. In **Workers & Pages**, open the `cribscore` Worker, then **Settings**, then **Domains & Routes**. Remove the custom domains `cribscore.co` and `www.cribscore.co`. This also removes the DNS records Cloudflare made for them.
3. In the cribscore.co zone, open **DNS**, then **Records**, and add back the old records with the proxy status and TTL you wrote down in step 7 Part B:
   - `A` `cribscore.co` → `172.66.3.26`
   - `A` `cribscore.co` → `162.159.143.30`
   - `CNAME` `www` → `cname.vercel-dns.com`
4. If the Access application gets in the way of the old host, turn it off or delete it in Zero Trust.

Records saved on the new host stay in the D1 database even after you leave. Removing the domains does not delete them.

## Notes

- **The Worker refuses by default.** Empty Access settings, a missing or blank `OWNER_EMAILS`, an unknown key, a failed key download or any bad token all lead to 403. The Worker downloads your team's public keys from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. It keeps them for 5 minutes. Requests that need the keys at the same time share one download. When a token names a key it does not know, the Worker downloads the keys again. It does this at most once per request, and only when the last download began more than 30 seconds ago. So while a key set is cached, tokens with unknown keys cause at most one download every 30 seconds, however many arrive at once. That covers Cloudflare's regular key rotation. When no key set is cached, for example right after a restart, a request starts a download. If that download fails or runs out of time, the Worker starts no other download until 5 seconds after the failed one began. Until then every request gets 403 and the log shows `jwks_unavailable`. That includes your own requests, so reload after a few seconds. While the downloads keep failing, there is at most one download every 5 seconds. The Worker does not read the `Retry-After` header. Cloudflare may run several copies of the Worker. Each copy keeps its own keys and its own limits.
- **Owner identity.** The journal owner is `cf-access:` followed by the token's `sub` value. That value is your Access user ID. Cloudflare keeps one per email address in your account, so it stays the same when you sign in again. Access user IDs are UUIDs (a standard ID of 36 characters). The Worker accepts a `sub` only if it is 1 to 128 characters long, starts with a letter or digit and uses only letters, digits, `.`, `_`, `:`, `@` and `-`. Any other `sub` gets 403 and the log shows `sub_invalid`. Cloudflare's documentation names two cases that change it:
  - your user is removed from the Zero Trust organization and later signs in again;
  - you sign in through a different Zero Trust organization, for example after the appendix rebuild.

  Then the journal opens empty. The old records stay in the D1 database under the old ID, and the page cannot show or export them. To keep the ID and a way back:
  - Do not remove your own user under **Zero Trust**, **Team & Resources**, **Users**.
  - Leave **Remove inactive users from seats** off. It is under **Zero Trust**, **Settings**, **Admin controls**. Off is the default. When it is on, a long time without signing in removes your user.
  - Export the journal regularly, for example once a week: **Backup and restore**, then **Export journal**. Keep the file outside this repository. It can restore the journal under a new ID.

  If the ID changes anyway, restore your latest export as in step 8, check 3. Do not delete the old records in D1. They are not lost, and a one-off database change can move them to the new ID.
- **Scheduled observations.** The old host could call `/mcp` on a schedule. Here `/mcp` sits behind Access like every other path, so that scheduler cannot reach it.
- **Logs.** A refused request writes one log line with a short reason code, for example `token_missing`. It never logs the token or the email address. Watch them with `npx wrangler@4 tail`.

## Appendix. Rebuild the Access setup

Use this only if the Zero Trust team or the Cribscore application is gone. Both exist today, and steps 1 and 2 check them.

**First, save the journal.** A new Zero Trust team gives you a new `sub`, so the journal would open empty (see Notes, owner identity). If the old setup still lets you in, export the journal now, as in step 7 Part A: write down the counts, then choose **Export journal**. If it no longer lets you in, use your latest export file. Records made after that export stay in D1 under the old ID (see Notes).

**Turn on Zero Trust.**

1. In the Cloudflare dashboard, open **Zero Trust**.
2. Pick a team name when asked. Your team domain becomes `<team>.cloudflareaccess.com`.
3. Choose a plan. The free plan is enough for one person.
4. Turn on **One-time PIN** as a login method. It sends a code to your email and works without other setup.

**Create the Access application.**

1. In Zero Trust, open **Access**, then **Applications**, and add an application.
2. Choose **Self-hosted**.
3. Name it `Cribscore`.
4. Add two public hostnames. Leave the path empty on both, so they cover all paths.
   - Domain `cribscore.co`, no subdomain.
   - Domain `cribscore.co`, subdomain `www`.
5. Set the session duration to 24 hours (step 2, item 5).
6. Add one policy. Action **Allow**, Include **Emails** with your email address. Leave its session duration at **Same as application session timeout**. Add no other rule.
7. Set the cookie settings from step 2, item 6.
8. Save the application.

**Then:**

1. Put the new team domain and audience tag into `wrangler.jsonc` (step 3). Commit the change and deploy again (step 6).
2. Write the new team domain into step 1 and the new application id into step 2 of this runbook.
3. Go through step 2 on the new application.
4. Open **Journal** on the new setup. If it shows your records, compare the counts with any you wrote down at the start of this appendix. If it is empty, restore the file from the start of this appendix as in step 8, check 3, and compare the counts the same way.
