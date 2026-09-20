#!/usr/bin/env node
/** Guardrails for the two side destinations. No network, no dependencies. */
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { buildRow, COLUMNS, sheetsConfigured } from '../lib/sheets.js'
import { signAssertion, googleAuthMode, googleConfigured } from '../lib/google-auth.js'
import { buildBreakdownEmail, CAUSES } from '../lib/email.js'
import { computeLeak, confidenceToMultiplier, BANDS } from '../src/lib/calc.js'

let failed = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const truthy = (name, got) => eq(name, !!got, true)

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

// Vercel stores multi-line secrets on one line, so the newlines arrive escaped.
// A key that only works in one of those two shapes breaks in production.
for (const [shape, key] of [['raw PEM', privateKey], ['escaped newlines', privateKey.replace(/\n/g, '\\n')]]) {
  const [h, c, s] = signAssertion('leak-calc@proj.iam.gserviceaccount.com', key).split('.')
  const v = createVerify('RSA-SHA256')
  v.update(`${h}.${c}`)
  truthy(`${shape}: signature verifies`, v.verify(publicKey, Buffer.from(s, 'base64url')))
  eq(`${shape}: header`, JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' })
  const claim = JSON.parse(Buffer.from(c, 'base64url').toString())
  eq(`${shape}: audience`, claim.aud, 'https://oauth2.googleapis.com/token')
  eq(`${shape}: scope`, claim.scope, 'https://www.googleapis.com/auth/spreadsheets')
  truthy(`${shape}: expiry is in the future and within an hour`, claim.exp - claim.iat > 0 && claim.exp - claim.iat <= 3600)
}

// Credential selection. A half-set env must resolve to no mode rather than
// throwing on every submission, and a forced mode must not silently fall back
// to the other credential.
const SA = { GOOGLE_SERVICE_ACCOUNT_EMAIL: 'a@b.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: 'k' }
const OA = { GOOGLE_OAUTH_CLIENT_ID: 'c', GOOGLE_OAUTH_CLIENT_SECRET: 's', GOOGLE_OAUTH_REFRESH_TOKEN: 'r' }

eq('no credentials means no mode', googleAuthMode({}), null)
eq('service account alone', googleAuthMode(SA), 'service_account')
eq('oauth alone', googleAuthMode(OA), 'oauth')
eq('both present prefers the one that cannot expire', googleAuthMode({ ...SA, ...OA }), 'service_account')
eq('GOOGLE_AUTH_MODE forces oauth', googleAuthMode({ ...SA, ...OA, GOOGLE_AUTH_MODE: 'oauth' }), 'oauth')
eq('GOOGLE_AUTH_MODE forces service account', googleAuthMode({ ...SA, ...OA, GOOGLE_AUTH_MODE: 'service_account' }), 'service_account')
eq('a forced mode never falls back', googleAuthMode({ ...OA, GOOGLE_AUTH_MODE: 'service_account' }), null)
eq('half-set service account', googleAuthMode({ GOOGLE_SERVICE_ACCOUNT_EMAIL: 'a@b.c' }), null)
eq('half-set oauth', googleAuthMode({ GOOGLE_OAUTH_CLIENT_ID: 'c', GOOGLE_OAUTH_CLIENT_SECRET: 's' }), null)
eq('googleConfigured tracks the mode', [googleConfigured({}), googleConfigured(SA), googleConfigured(OA)], [false, true, true])

// The sheet also needs an id, whichever credential is in play.
eq('sheets off without an id', sheetsConfigured(SA), false)
eq('sheets on with a service account and an id', sheetsConfigured({ ...SA, GOOGLE_SHEET_ID: 's' }), true)
eq('sheets on with oauth and an id', sheetsConfigured({ ...OA, GOOGLE_SHEET_ID: 's' }), true)
eq('sheets off with an id but no credentials', sheetsConfigured({ GOOGLE_SHEET_ID: 's' }), false)

// A row that drifts from the header silently puts values in the wrong columns.
const values = {
  leads_per_month: 1000, deal_value: 5000, booking_rate: 25, show_rate: 60,
  close_rate: 25, response_time_band: 'same_day', study_confidence: 38,
}
const funnel = computeLeak({
  leads: 1000, dealValue: 5000, bookingRate: 25, showRate: 60, closeRate: 25,
  multiplier: confidenceToMultiplier('same_day', 38),
})
const row = buildRow({ firstName: 'Dana', email: 'd@e.com', phone: '555', values, label: 'Same day', funnel, emailed: true })
eq('row width matches the header', row.length, COLUMNS.length)
eq('timestamp is ISO 8601', /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(row[0]), true)
eq('email lands in the email column', row[COLUMNS.indexOf('email')], 'd@e.com')
eq('leak lands in the leak column', row[COLUMNS.indexOf('calculated_leak_monthly')], funnel.leakMonthly)
eq('annual lands in the annual column', row[COLUMNS.indexOf('calculated_leak_annual')], funnel.leakAnnual)
eq('emailed flag is recorded', row[COLUMNS.indexOf('emailed')], 'yes')
eq('a missing phone becomes an empty cell',
  buildRow({ firstName: 'D', email: 'd@e.com', phone: '', values, label: 'x', funnel, emailed: false })[COLUMNS.indexOf('phone')], '')
truthy('no cell is undefined', row.every((c) => c !== undefined && c !== null))

// Every band has to produce a sendable email.
for (const { id, label } of BANDS.filter((b) => b.id !== 'under_1_min')) {
  const f = computeLeak({ leads: 500, dealValue: 4000, bookingRate: 20, showRate: 55, closeRate: 30, multiplier: confidenceToMultiplier(id, 50) })
  const mail = buildBreakdownEmail({ firstName: 'Dana', deal: 4000, band: label, target: 'inside 5 minutes', funnel: f })
  truthy(`${id}: subject carries the number`, mail.subject.includes('$'))
  truthy(`${id}: html is a complete document`, mail.html.startsWith('<!doctype html>') && mail.html.includes('</html>'))
  truthy(`${id}: html has no unresolved template holes`, !mail.html.includes('${') && !mail.html.includes('undefined'))
  truthy(`${id}: text has no unresolved template holes`, !mail.text.includes('${') && !mail.text.includes('undefined'))
  truthy(`${id}: both parts name the hire-me offer`, /hire/i.test(mail.html) && /hire/i.test(mail.text))
  truthy(`${id}: both parts link the card`, mail.html.includes('jtylerray.com/card') && mail.text.includes('jtylerray.com/card'))
  truthy(`${id}: all three causes are present`, CAUSES.every((c) => mail.html.includes(c.title) && mail.text.includes(c.title)))
  truthy(`${id}: says show and close are held flat`, /show rate and close rate stay/i.test(mail.text))
}

// A name with markup in it must not break out of the HTML.
const nasty = buildBreakdownEmail({ firstName: '<script>alert(1)</script>', deal: 4000, band: 'Same day', target: 'inside 5 minutes', funnel })
truthy('a name is escaped, not injected', !nasty.html.includes('<script>alert(1)</script>'))
truthy('the escaped name still appears', nasty.html.includes('&lt;script&gt;'))

console.log(failed ? `\n${failed} failing` : '\nall passing')
process.exit(failed ? 1 : 0)
