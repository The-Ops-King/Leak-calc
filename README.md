# Lead Leak Calculator

A one page calculator for `leak.jtylerray.com`. A business owner sets their
funnel, sees what their lead response time costs them per month, sees the math
that produced it, and can hand over an email to get the breakdown. The email
creates a tagged contact in HighLevel with their whole funnel attached.

The funnel is leads, then booking rate, then show rate, then close rate on
shows. Revenue is `leads x booking x show x close x deal value`.

Sliders are linear with coarse steps (100 leads, $500, 1%) and drive the value
directly through the native `min`/`max`/`step`. Deal value stops its track at
$25,000 via `sliderMax` so the range most people live in gets real travel, while
the typed box still accepts up to $100,000.

## Why the number is believable

The published research measures contact and qualification rates, not revenue.
Multiplying revenue by 21 produces a figure a skeptical operator dismisses on
sight, so this tool does none of that:

- The lift is applied to the **booking rate** and nothing else. Show rate and
  close rate stay exactly where the operator put them, because no cited study
  claims a rep closes better for having called sooner. They measure whether you
  reach the lead at all.
- The lift is an **odds ratio**, not a rate multiplier. "21x more likely to
  qualify" is a statement about odds, and odds are what you can legitimately
  multiply. Multiplying the rate itself sends a 50% booker past 100%; closing
  the gap to the ceiling instead promotes a 1% booker to 64%. The odds transform
  behaves at both ends.
- The improved booking rate stops at `booking_rate_ceiling` (80%). Nobody books
  more of their raw inbound leads than that.
- Anyone already booking above the ceiling gets no number at all and a note
  explaining why.
- "Under 1 minute" returns zero. There is no fabricated leak for someone whose
  response time is already right.
- Every figure rounds down. The annual number is the rounded monthly times
  twelve, so anyone can check it on a calculator and get the same answer.
- The slider is a **confidence dial**, not a multiplier dial. The visitor says
  how much of the published research they believe, and the lift follows. It
  opens between 25% and 45% depending on the band, so the default is always well
  under half of what the study found. Drag it to zero and the leak goes to zero.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # math and integration guardrails, no dependencies
npm run build
```

The calculator is pure client-side arithmetic. It works with no network call,
so it never looks broken while the form is loading.

## Tuning the model

`config/multipliers.json` holds everything. The seven band values are the
multipliers the confidence dial opens on; `research_max` is what the dial reaches
at 100%; `booking_rate_ceiling` is the hard stop; `basis` is the sentence shown
under the dial; `limits` drives both the slider ranges and the validation.
Changing a number here needs a redeploy but no code edit.

The dial position is derived, not stored: a band's default confidence is
`(default - 1) / (research_max - 1)`. Lower a band's multiplier and the dial
opens lower on its own.

## HighLevel setup

1. Create a Private Integration token on the sub-account with scopes for
   `contacts.write` and `locations/customFields` (read and write).
2. Export the credentials locally and create the custom fields:

   ```bash
   export GHL_PRIVATE_TOKEN=pit-...
   export GHL_LOCATION_ID=...
   npm run ghl:setup             # creates any missing fields, prints the IDs
   npm run ghl:setup -- --verify # also round trips a test contact
   ```

   `--verify` upserts a throwaway contact, reads it back, and reports whether
   each custom field actually stored its value. Delete that contact afterwards.

3. Set `GHL_PRIVATE_TOKEN` and `GHL_LOCATION_ID` in the Vercel project.

The function looks custom fields up by name at runtime and caches the IDs for
ten minutes, so nothing is hardcoded and renaming a field in HighLevel does not
silently break the integration. If a field is missing the contact is still
created and the gap is logged, because losing the lead is worse than losing one
field.

### Version header

HighLevel's docs currently show both `2021-07-28` and `v3` for the `Version`
header. `api/submit.js` sends `2021-07-28` and retries once with `v3` if the API
rejects the version. Override with `GHL_API_VERSION` if that ever settles.

### Custom field value key

The docs example uses `fieldValue` while a lot of live v2 traffic uses
`field_value`. Both keys are sent so the value cannot land empty either way.
`npm run ghl:setup -- --verify` confirms which one stuck.

### Custom fields

Eight fields are created on the sub-account: `leads_per_month`, `deal_value`,
`booking_rate`, `show_rate`, `close_rate`, `response_time_band`,
`study_confidence` and `calculated_leak_monthly`. `close_rate` here means
show-to-sale, not lead-to-sale.

## The breakdown email

`/api/submit` sends the breakdown through [Resend](https://resend.com) after the
contact is upserted, never before, so a failed send costs an email rather than a
lead. Set `RESEND_API_KEY` and `MAIL_FROM` (and optionally `MAIL_REPLY_TO`) in
the Vercel project, with the sending domain verified in Resend.

Leave those unset and nothing breaks: the contact is still created, and the
confirmation screen says you will be in touch instead of claiming an email went
out. The function returns `emailed: true|false` and the UI reads it, so the page
never promises something that did not happen.

The email carries their funnel both ways, the monthly and annual figures, and
the three causes in `lib/email.js`. Numbers in it are recomputed server side
from the submitted inputs rather than trusted from the browser, because the
arithmetic in a message going out under your name should not be settable by the
client. Nothing is sent to someone whose answer was "under 1 minute" or whose
booking rate is already above the ceiling, since neither gets a number on the
page either.

It is deliberately a light email rather than matching the site's dark theme.
Dark backgrounds get mangled by Outlook and by clients running their own dark
mode, and a broken first email is worse than an off-brand one.

## The Google Sheet

Every submission also appends a row, so you have the raw data outside GHL. The
function signs a service-account JWT with `node:crypto` and calls the Sheets API
directly: no dependency, no third party between the form and the row, nothing to
go down or run out of tasks.

The sheet already exists with its header row:
<https://docs.google.com/spreadsheets/d/1SdRyBHGme5OMFkWJNwh_U5kvzFbvB_A0gmI6qKnYZgc/edit>

Remaining setup:

1. In Google Cloud, create a project and enable the **Google Sheets API**.
2. Create either credential (see **Google credentials** above). For a service
   account, skip the "grant this service account access to project" step:
   project IAM roles do not govern Drive files, sharing does.
3. Share the sheet with the service account address as an **Editor**, or
   consent as an account that can already edit it.
4. Set `GOOGLE_SHEET_ID` and the credential variables in the Vercel project.
5. Prove the whole path works:

   ```bash
   export GOOGLE_SERVICE_ACCOUNT_EMAIL=... GOOGLE_SHEET_ID=...
   export GOOGLE_PRIVATE_KEY="$(jq -r .private_key key.json)"
   npm run sheet:setup -- --verify
   ```

The row is written last so it can record whether the email actually went out.
Seventeen columns, listed in `COLUMNS` in `lib/sheets.js`. Access tokens are
cached for the hour they are valid, so most submissions skip the token exchange.

The default range is `A:Q` with no tab name, so appends go to the first sheet.
Naming a tab in code would break the moment it is renamed, and a sheet created
from a CSV names its tab after the file rather than anything predictable. Set
`GOOGLE_SHEET_RANGE` if you add more tabs and want a specific one.

Every submission is logged, including the ones that get no number on the page
("under 1 minute", or a booking rate already above the ceiling). Those are still
leads.

Leave the three variables unset and nothing breaks; the append is skipped.

## The offer modal

`src/components/OfferModal.jsx` opens once, immediately after the form
succeeds, and dismissing it reveals the result underneath. It is a pause rather
than a toll: ignoring it costs the visitor nothing they were promised.

It expects a square headshot at `public/tyler.jpg`. Without one it renders a
monogram, so a missing file is a plainer modal rather than a broken image. Drop
the file in and it is picked up on the next deploy; change `PHOTO` in that
component for a different name or extension. 400x400 or larger, under ~150KB.

Escape, the backdrop and the button all close it, Tab is trapped inside while
it is open, and body scroll is locked and restored. Those are not decoration: a
modal a keyboard user can tab out of but not see is worse than no modal.

## Provisioning without a terminal

`POST /api/setup` creates whatever the submit path needs and nothing else: the
HighLevel custom fields listed in `lib/ghl.js`, and the sheet header row. It
exists because the alternative was a shell, and the person who owns this does
not always have one.

Scope is deliberately narrow. It creates only fields named on that list, never
edits or deletes an existing field, and the only cell it writes is row one. It
cannot be used as a general HighLevel or Sheets proxy even by someone holding
the secret. It is idempotent, it creates fields serially because a burst
against one location invites duplicates, and it reads back afterwards rather
than trusting its own writes.

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://leak.jtylerray.com/api/setup
```

Same guard as the health check: `lib/authorize.js`, constant time, fails closed
when `CRON_SECRET` is unset.

Adding a field is now one entry in `CUSTOM_FIELDS` and a POST to that route.
The submit path writes it, the health check notices it missing, and setup
creates it, because all three read the same list.

## Knowing when it breaks

Every dependency here fails quietly. A dead OAuth token stops sheet rows, a
revoked Resend key stops emails, a renamed GHL field silently drops the numbers,
and in each case the visitor still sees their result and the function still
returns 200. That is correct for the lead and terrible for the operator, so the
pipeline reports on itself two ways.

**On a degraded submission.** When a row, an email or a custom field fails, the
contact is still saved and the response is still 200, but an alert email goes
out naming what broke. Alerts are keyed by the failure rather than the lead and
throttled to one an hour, because a dead credential otherwise fires on every
submission and an inbox that gets muted is the same as no alerting.

**On a schedule.** `GET /api/health` exercises all three credentials for real:
it lists the GHL custom fields and checks all eight still exist, mints a Google
access token and reads the sheet header to confirm it still matches the row the
function writes, and asks Resend for a verified sending domain. It returns 200
when everything passes and 503 when anything does not, so a failure is visible
to Vercel's own cron notifications even when the broken thing is the mail
provider the alert would have used.

`vercel.json` runs it daily at 13:00 UTC. No secret is ever returned, only
names, booleans and error text. Set `CRON_SECRET` and Vercel sends it
automatically on cron invocations; without it the endpoint is an unauthenticated
way to burn three API quotas per request. `MAIL_ALERT_TO` overrides where
alerts go, defaulting to the address inside `MAIL_FROM`.

Run it by hand any time:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://leak.jtylerray.com/api/health
```

## Rate limiting

`/api/submit` allows 5 submissions per IP per hour, counted in process. Vercel
runs several instances and recycles them, so a determined attacker can get past
this by waiting out a cold start. It stops ordinary form hammering, which is
what it is for. If it ever needs to be real, replace the counter block at the
top of `api/submit.js` with Upstash Redis; nothing else in the file changes.

Bots also face a honeypot field and a minimum time on page. Both return a 200 so
there is nothing to tune against.

## Deployment

Vercel, static build plus one Node function.

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Env vars | `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `RESEND_API_KEY`, `MAIL_FROM`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID` |

Tokens only ever exist in the function. Nothing about HighLevel, Resend or
Google reaches the client bundle.

### DNS

Resend's records for `jtylerray.com` are already published: a DKIM key at
`resend._domainkey`, and the SES SPF include plus feedback MX on
`send.jtylerray.com`.

There is no `_dmarc` record. Gmail and Yahoo have required DMARC from bulk
senders since February 2024, so without one these emails land in spam or get
rejected. Minimum viable record:

```
_dmarc.jtylerray.com  TXT  "v=DMARC1; p=none; rua=mailto:jt@jtylerray.com"
```

## What is deliberately absent

No PDF generator, no accounts, no dashboard, no wizard. No localStorage and no
analytics. The page stores nothing about the visitor on their device.

## Layout

```
config/multipliers.json   every tunable number
src/lib/calc.js           the model and validation
src/lib/format.js         currency, percent and lift formatting
src/components/           sliders, result, the gate form and the offer modal
src/theme.css             brand tokens taken from jtylerray.com
api/submit.js             the only thing that sees the tokens
api/health.js             daily credential check, alerts on failure
api/setup.js              creates the GHL fields and the sheet header
lib/authorize.js          the shared guard for both privileged routes
lib/ghl.js                the HighLevel client and the one field list
lib/alert.js              operational alerts and their throttling
lib/email.js              the breakdown email, the three causes, the hire-me block
lib/google-auth.js        access tokens from either credential type
lib/sheets.js             the Sheets append and its column order
scripts/ghl-setup.mjs     one-off custom field creation and round trip check
scripts/google-auth.mjs   local OAuth consent, prints a refresh token
scripts/sheet-setup.mjs   header check and a round trip against the real sheet
scripts/test-calc.mjs     math guardrails
scripts/test-integrations.mjs  JWT, row/header parity and email rendering
```
