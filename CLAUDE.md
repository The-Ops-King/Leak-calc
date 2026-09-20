# Working in this repo

A one page lead calculator on `leak.jtylerray.com`, plus the integration layer
it runs on. The integration layer is the reusable part: if you are adding a new
tool for this account, add it here rather than starting a new repo, because
everything in `lib/` already works and the credentials are already attached to
this Vercel project.

## Read this before wiring anything up

These were all learned the expensive way. None of them are guessable.

**Credentials live in Vercel, and you cannot read them.** They are project
scoped on `leak-calc`. The harness blocks credential materialization, so
`get_project_env` on a real secret is refused. You verify integrations by
exercising the live endpoint and checking the output, never by reading the key.

**Env vars need a redeploy.** A variable added after the last deployment is not
visible to the running function. Create a new deployment or the change does
nothing, and the failure looks exactly like a wrong value.

**Vercel stores multi-line secrets on one line.** A PEM private key arrives with
`\n` escaped. `lib/google-auth.js` normalizes both shapes; anything new that
takes a key must do the same.

**HighLevel's `Version` header is ambiguous.** Their docs show both
`2021-07-28` and `v3`. `api/submit.js` sends the first and retries once with the
second on a version rejection. Do not hardcode one.

**HighLevel custom field values need both spellings.** The docs show
`fieldValue`; a lot of live v2 traffic uses `field_value`. Send both or the
value silently lands empty. Fields are resolved by name *and* `fieldKey` at
runtime and cached for ten minutes, so a rename does not break the integration
but a delete does.

**Google OAuth refresh tokens die.** Password change, revoked access, six months
idle, and seven days if the consent screen is still in Testing. An
`invalid_grant` means the token is dead, not that the request was malformed.
`lib/google-auth.js` also accepts a service account, which never expires;
prefer it for anything unattended.

**The Sheets range has no tab name.** `A:Q` appends to the first sheet. Naming a
tab breaks when it is renamed, and a sheet created from a CSV names its tab
after the file.

**Auth guards fail closed.** `api/health.js` refuses when `CRON_SECRET` is
absent rather than skipping the check, because a missing variable that silently
disables authentication looks identical to a working guard.

## Layout

```
config/multipliers.json   every tunable number for the calculator
src/lib/calc.js           the funnel model and validation
src/components/           sliders, result, lead form
api/submit.js             the only thing that sees the tokens
api/health.js             daily credential check, alerts on failure
lib/google-auth.js        access tokens from a service account OR OAuth
lib/sheets.js             Sheets append and column order
lib/email.js              the breakdown email
lib/alert.js              operational alerts and their throttling
scripts/*-setup.mjs       one-off provisioning, each with a --verify round trip
scripts/test-*.mjs        guardrails, no dependencies
```

## Reusing the integration layer

`lib/google-auth.js`, `lib/sheets.js` and `lib/alert.js` know nothing about the
calculator. A new tool in this repo gets a new route under `api/` and imports
them directly. It inherits every credential already on this project, so there is
nothing to configure.

Adding a new destination means a new file in `lib/`, imported by the route, and
called after the primary write so a failure costs a record rather than a lead.

## Conventions

Writes are ordered by what you cannot afford to lose. The primary write is fatal
and returns a non-2xx. Everything after it is best effort, logged, reported
through `lib/alert.js`, and never allowed to fail the request.

Numbers shown to a person are recomputed server side. The browser's arithmetic
is never trusted for anything that goes out under this account's name.

Every integration ships a `--verify` script that round trips against the real
API. Do not mark an integration done because the variables are set.

## Verifying

```bash
npm test          # 472 assertions, no network, no dependencies
npm run build

curl -H "Authorization: Bearer $CRON_SECRET" https://leak.jtylerray.com/api/health
```

The health check exercises all three credentials for real: it lists the GHL
custom fields and confirms all eight exist, mints a Google token and reads the
sheet header to confirm it matches the row being written, and asks Resend for a
verified sending domain. 200 means the pipeline is whole, 503 means it is not.
