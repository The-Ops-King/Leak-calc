# Lead Leak Calculator

A one page calculator for `leak.jtylerray.com`. A business owner sets their
funnel, sees what their lead response time costs them per month, sees the math
that produced it, and can hand over an email to get the breakdown. The email
creates a tagged contact in HighLevel with their whole funnel attached.

The funnel is leads, then booking rate, then show rate, then close rate on
shows. Revenue is `leads x booking x show x close x deal value`.

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
npm test         # math guardrails, no dependencies
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
| Env vars | `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID` |

The token only ever exists in the function. Nothing about HighLevel reaches the
client bundle.

## What is deliberately absent

No PDF generator, no accounts, no dashboard, no wizard, no email sending. No
localStorage and no analytics. The page stores nothing about the visitor on
their device.

## Layout

```
config/multipliers.json   every tunable number
src/lib/calc.js           the model and validation
src/lib/format.js         currency, percent and lift formatting
src/components/           sliders, result, lead form
src/theme.css             brand tokens taken from jtylerray.com
api/submit.js             the only thing that sees the GHL token
scripts/ghl-setup.mjs     one-off custom field creation and round trip check
scripts/test-calc.mjs     math guardrails
```
