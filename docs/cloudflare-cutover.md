# Cloudflare cutover: exact requests

This is the short, ordered list of Cloudflare API calls that moves cribscore.co and www.cribscore.co to the
Worker behind Cloudflare Access. The full reasoning, checks and dashboard steps live in
`docs/cloudflare-hosting.md`. This file holds no secret values.

Run the steps in this order and stop at the first failure. The order keeps the site locked at every moment:
the Worker exists before it has a way in, and no hostname points at it until the Access gate covers that
hostname and the owner secret is set.

## Fixed values

| Name | Value |
|---|---|
| Account id | `87b72170ec7db792c10e7ad1b8a72066` |
| Zone id (cribscore.co) | `6f169eb11d4cd3c602810991e91f7909` |
| Worker name | `cribscore` |
| Entry module | `cloudflare.js` (built from `worker/cloudflare.js`) |
| Compatibility date | `2026-10-19` (no compatibility flags) |
| D1 binding | `DB` → database `cribscore`, id `cc757d6f-ead3-4e90-9f11-159d523d1617` |
| Vars | `IDENTITY_MODE=cloudflare-access`, `ACCESS_TEAM_DOMAIN=gentle-wildflower-930d.cloudflareaccess.com`, `ACCESS_AUD=2b19b6c5404880177119e064f4dfbaca7c2d37c187b8dda044ebb805bce6158e` |
| Secret | `OWNER_EMAILS`: the owner's sign-in email, the same address as the Access policy "Owner only". Never commit it. |
| Access application | "Cribscore", id `c6fd3cd1-d6c1-49b4-a96c-98a33acd1dbf`, hosts `cribscore.co` and `www.cribscore.co` |

All paths below start with `https://api.cloudflare.com/client/v4`.

## Build the bundle

The Worker is one JavaScript module. The site's files are built into it, so there is no separate asset
upload and no asset manifest.

```sh
npm ci
npm run build
npm test                      # only the known failures are allowed
npm run validate:worker
npx wrangler@4 deploy --dry-run --outdir /tmp/cribscore-bundle
```

The module to upload is `/tmp/cribscore-bundle/cloudflare.js`. Build it from the merged `main` commit.

## Step 1. Create the journal tables

Request A, the schema. The body's `sql` is the full text of `drizzle/0000_rainy_multiple_man.sql`, sent
unchanged. The `--> statement-breakpoint` lines are SQL comments.

```
POST /accounts/87b72170ec7db792c10e7ad1b8a72066/d1/database/cc757d6f-ead3-4e90-9f11-159d523d1617/query
{"sql": "<contents of drizzle/0000_rainy_multiple_man.sql>"}
```

Request B, the record Wrangler keeps of applied migrations, so a later `wrangler d1 migrations apply`
does not run the same file twice:

```
POST /accounts/87b72170ec7db792c10e7ad1b8a72066/d1/database/cc757d6f-ead3-4e90-9f11-159d523d1617/query
{"sql": "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL); INSERT INTO d1_migrations (name) VALUES ('0000_rainy_multiple_man.sql');"}
```

Check: `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name` lists `d1_migrations`,
`journal_events` and `journal_heads`.

Wrangler does the same with `npx wrangler@4 d1 migrations apply cribscore --remote`.

## Step 2. Upload the Worker with no way in

```
PUT /accounts/87b72170ec7db792c10e7ad1b8a72066/workers/scripts/cribscore
Content-Type: multipart/form-data

part "metadata" (application/json):
{
  "main_module": "cloudflare.js",
  "compatibility_date": "2026-10-19",
  "bindings": [
    {"type": "d1", "name": "DB", "id": "cc757d6f-ead3-4e90-9f11-159d523d1617"},
    {"type": "plain_text", "name": "IDENTITY_MODE", "text": "cloudflare-access"},
    {"type": "plain_text", "name": "ACCESS_TEAM_DOMAIN", "text": "gentle-wildflower-930d.cloudflareaccess.com"},
    {"type": "plain_text", "name": "ACCESS_AUD", "text": "2b19b6c5404880177119e064f4dfbaca7c2d37c187b8dda044ebb805bce6158e"}
  ],
  "keep_bindings": ["secret_text"]
}

part "cloudflare.js" (application/javascript+module): the file /tmp/cribscore-bundle/cloudflare.js
```

Then turn off the public workers.dev address and its previews:

```
POST /accounts/87b72170ec7db792c10e7ad1b8a72066/workers/scripts/cribscore/subdomain
{"enabled": false, "previews_enabled": false}
```

Check: `GET /accounts/87b72170ec7db792c10e7ad1b8a72066/workers/scripts/cribscore/subdomain` answers
`{"enabled": false, "previews_enabled": false}`. The Worker now has no route, no custom domain and no
workers.dev address, so nobody can reach it.

## Step 3. Set the owner secret

```
PUT /accounts/87b72170ec7db792c10e7ad1b8a72066/workers/scripts/cribscore/secrets
{"name": "OWNER_EMAILS", "text": "<owner's sign-in email>", "type": "secret_text"}
```

Check: `GET .../workers/scripts/cribscore/secrets` lists `OWNER_EMAILS` (the value is never shown).

## Step 4. Check the gate before any hostname points at it

The Worker cannot be reached yet, so the gate is checked two ways:

- `npm test` above runs `tests/cloudflare-access.test.mjs` against the same entry: a missing, forged,
  expired or wrong-audience token gets 403 on every path, and a forged `oai-authenticated-user-id`
  header never reaches the app.
- Confirm the Access application still covers both hosts:
  `GET /accounts/87b72170ec7db792c10e7ad1b8a72066/access/apps/c6fd3cd1-d6c1-49b4-a96c-98a33acd1dbf`
  shows destinations `cribscore.co` and `www.cribscore.co` and the "Owner only" allow policy.

## Step 5. Move the two hostnames

The old journal lives on the old host. Before this step the owner should sign in on the old site and use
the journal's backup export. Cloudflare removes the old host's claim on the domain about 7 days after the
records below are deleted, so the export (and the rollback below) only works within that window.

Delete the current records. Leave `api.cribscore.co` and every TXT record alone.

```
DELETE /zones/6f169eb11d4cd3c602810991e91f7909/dns_records/274fe11f1f066f235cd9694dae1890d2   (A cribscore.co 172.66.3.26)
DELETE /zones/6f169eb11d4cd3c602810991e91f7909/dns_records/5fda613815077ccc100c21ef8fea284c   (A cribscore.co 162.159.143.30)
DELETE /zones/6f169eb11d4cd3c602810991e91f7909/dns_records/46f96a4d64aae34f3cd41c60849683be   (CNAME www.cribscore.co cname.vercel-dns.com)
```

Attach the Worker as each hostname's custom domain, production only:

```
PUT /accounts/87b72170ec7db792c10e7ad1b8a72066/workers/domains
{"hostname": "cribscore.co", "service": "cribscore", "zone_id": "6f169eb11d4cd3c602810991e91f7909", "environment": "production", "previews_enabled": false}

PUT /accounts/87b72170ec7db792c10e7ad1b8a72066/workers/domains
{"hostname": "www.cribscore.co", "service": "cribscore", "zone_id": "6f169eb11d4cd3c602810991e91f7909", "environment": "production", "previews_enabled": false}
```

`previews_enabled: false` matters: a custom domain with previews on gets wildcard preview hostnames that the
Access application does not cover. Check that no `*.cribscore.co` or `*.www.cribscore.co` record appears.

## Step 6. Verify

Wait until both certificates are active (a few minutes), then:

1. `curl -sI https://cribscore.co/` and `curl -sI https://www.cribscore.co/` answer with a redirect to
   `https://gentle-wildflower-930d.cloudflareaccess.com/...`. They never answer 200 without a sign-in.
2. The same requests with `-H 'oai-authenticated-user-id: someone'` also redirect to the sign-in page.
3. `curl -s https://cribscore.co/api/journal` without a sign-in does not return journal data.
4. `GET /zones/6f169eb11d4cd3c602810991e91f7909/dns_records?name=api.cribscore.co` still shows the CNAME
   to `cribscore-api-virginia.onrender.com`, unchanged.
5. The owner signs in, opens the Journal, starts it or restores the export, and sees the expected counts.

## Rollback

Within about 7 days of step 5:

```
GET    /accounts/87b72170ec7db792c10e7ad1b8a72066/workers/domains?hostname=cribscore.co        (note the id)
DELETE /accounts/87b72170ec7db792c10e7ad1b8a72066/workers/domains/<id>                        (both hostnames)
POST   /zones/6f169eb11d4cd3c602810991e91f7909/dns_records {"type":"A","name":"cribscore.co","content":"172.66.3.26","proxied":false,"ttl":1}
POST   /zones/6f169eb11d4cd3c602810991e91f7909/dns_records {"type":"A","name":"cribscore.co","content":"162.159.143.30","proxied":false,"ttl":1}
POST   /zones/6f169eb11d4cd3c602810991e91f7909/dns_records {"type":"CNAME","name":"www","content":"cname.vercel-dns.com","proxied":false,"ttl":1}
```

The Worker, the D1 database and the Access application can stay. They cost nothing while no hostname
points at them.
