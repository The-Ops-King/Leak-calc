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
  job_role: 'Closer',
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
eq('job role lands in its column', row[COLUMNS.indexOf('job_role')], 'Closer')
// Appending rather than inserting is what keeps rows written before this
// column existed aligned with their headers.
eq('job_role is the last column', COLUMNS[COLUMNS.length - 1], 'job_role')
eq('a missing role becomes an empty cell',
  buildRow({ firstName: 'D', email: 'd@e.com', phone: '', values: { ...values, job_role: undefined }, label: 'x', funnel, emailed: false })[COLUMNS.indexOf('job_role')], '')
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

// The gate offers a fixed set of roles; a free text answer still has to survive
// the round trip into a cell.
const { JOB_ROLES } = await import('../src/lib/calc.js')
truthy('the role list has a free text escape hatch', JOB_ROLES.includes('Something else'))
truthy('every role is a non-empty string', JOB_ROLES.every((r) => typeof r === 'string' && r.trim()))
eq('roles are unique', new Set(JOB_ROLES).size, JOB_ROLES.length)
for (const r of ['Closer', "VP of Rev Ops & 'Growth'", '<b>owner</b>']) {
  eq(`role "${r.slice(0, 20)}" round trips into its cell`,
    buildRow({ firstName: 'D', email: 'd@e.com', phone: '', values: { ...values, job_role: r }, label: 'x', funnel, emailed: true })[COLUMNS.indexOf('job_role')], r)
}

// A two-phase write must never lose what the first phase stored. The update
// carries a funnel but no name, phone or role, and a blank there means "I do
// not have this", not "clear it".
const { mergeRow, parseRowRange } = await import('../lib/sheets.js')
const captureRow = buildRow({ firstName: 'Dana', email: 'd@e.com', phone: '555', values: { job_role: 'Closer' }, funnel: null, emailed: false })
const updateRowValues = buildRow({ firstName: '', email: 'd@e.com', phone: '', values: { ...values, job_role: undefined }, label: 'Same day', funnel, emailed: true })
const merged = mergeRow(captureRow, updateRowValues)

eq('the name survives the update', merged[COLUMNS.indexOf('first_name')], 'Dana')
eq('the phone survives the update', merged[COLUMNS.indexOf('phone')], '555')
eq('the role survives the update', merged[COLUMNS.indexOf('job_role')], 'Closer')
eq('the funnel is written', merged[COLUMNS.indexOf('leads_per_month')], values.leads_per_month)
eq('the leak is written', merged[COLUMNS.indexOf('calculated_leak_monthly')], funnel.leakMonthly)
eq('the emailed flag is updated', merged[COLUMNS.indexOf('emailed')], 'yes')
eq('the merged row keeps its width', merged.length, COLUMNS.length)
eq('a zero overwrites rather than being treated as blank', mergeRow(['x'], [0])[0], 0)
eq('an empty capture cell stays empty', merged[COLUMNS.indexOf('response_time_label')], 'Same day')

// The client hands the row range back, so it is never trusted on shape alone.
for (const bad of ['Tab!A1:R1', 'Tab!A2:R3', 'Tab!A:R', 'Tab!A2:Z2', '../etc', '', null]) {
  eq(`row range rejected: ${JSON.stringify(bad)}`, parseRowRange(bad), null)
}
truthy('a real single row below the header is accepted', parseRowRange('Untitled!A6:R6')?.row === 6)

// Alert throttling. Without it a dead credential emails on every submission,
// the inbox gets muted, and muted alerting is the same as none.
const { shouldAlert, alertRecipient } = await import('../lib/alert.js')
const t0 = Date.now()
eq('first alert for a key fires', shouldAlert('k1', t0), true)
eq('same key inside the hour is suppressed', shouldAlert('k1', t0 + 59 * 60 * 1000), false)
eq('same key after the hour fires again', shouldAlert('k1', t0 + 61 * 60 * 1000), true)
eq('a different failure is not suppressed by the first', shouldAlert('k2', t0), true)

// The alert has to reach a mailbox without another variable to forget.
eq('explicit recipient wins', alertRecipient({ MAIL_ALERT_TO: 'ops@x.com', MAIL_FROM: 'Tyler <t@y.com>' }), 'ops@x.com')
eq('falls back to the From address', alertRecipient({ MAIL_FROM: 'Tyler <t@y.com>' }), 't@y.com')
eq('handles a bare From address', alertRecipient({ MAIL_FROM: 't@y.com' }), 't@y.com')
eq('no mail config means no recipient', alertRecipient({}), null)

// The HighLevel field list is the thing three files used to disagree about.
const {
  CUSTOM_FIELDS, FIELD_NAMES, indexCustomFields, missingFieldNames,
  customFieldPayload, createCustomField, ghlConfigured,
} = await import('../lib/ghl.js')

eq('names are derived from the specs, so they cannot drift', FIELD_NAMES, CUSTOM_FIELDS.map((f) => f.name))
eq('field names are unique', new Set(FIELD_NAMES).size, FIELD_NAMES.length)
truthy('every field declares a type', CUSTOM_FIELDS.every((f) => f.dataType && f.placeholder))
truthy('the sheet carries every GHL field', FIELD_NAMES.every((n) => COLUMNS.includes(n)))

// HighLevel returns fieldKey prefixed with "contact.". Indexing both forms is
// why renaming a field in the UI does not break the integration.
const idx = indexCustomFields([
  { id: 'i1', name: 'leads_per_month' },
  { id: 'i2', fieldKey: 'contact.job_role' },
  { id: 'i3', name: 'Deal_Value' },
])
eq('matches on name', idx.get('leads_per_month'), 'i1')
eq('matches on prefixed fieldKey', idx.get('job_role'), 'i2')
eq('matching ignores case', idx.get('deal_value'), 'i3')
eq('the rest are reported missing', missingFieldNames(idx).length, FIELD_NAMES.length - 3)

// Both value spellings, every time, or the value silently lands empty.
const { customFields, missing } = customFieldPayload(idx, { leads_per_month: 60, job_role: 'Closer', deal_value: 0 })
eq('only resolved fields are sent', customFields.length, 3)
truthy('both spellings on every entry', customFields.every((c) => c.fieldValue === c.field_value && c.id))
eq('a zero is sent, not dropped', customFields.find((c) => c.id === 'i3').fieldValue, '0')
eq('unresolved fields are reported', missing.length, FIELD_NAMES.length - 3)
eq('a null value becomes an empty string, not "null"',
  customFieldPayload(idx, { leads_per_month: null }).customFields[0].fieldValue, '')

// The setup route must not be usable to create arbitrary fields.
let refused = false
try { await createCustomField('loc', 'not_one_of_ours') } catch { refused = true }
truthy('creating a field outside the list is refused', refused)

eq('ghl off with no env', ghlConfigured({}), false)
eq('ghl off with only a token', ghlConfigured({ GHL_PRIVATE_TOKEN: 't' }), false)
eq('ghl on when complete', ghlConfigured({ GHL_PRIVATE_TOKEN: 't', GHL_LOCATION_ID: 'l' }), true)

// The privileged routes share one guard, and it must fail closed.
const { authorize } = await import('../lib/authorize.js')
const fakeRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const withSecret = (secret, header) => {
  const prev = process.env.CRON_SECRET
  if (secret === null) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = secret
  const res = fakeRes()
  const ok = authorize({ headers: header ? { authorization: header } : {} }, res)
  if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev
  return { ok, code: res.code }
}
eq('no secret configured refuses rather than allowing', withSecret(null, 'Bearer anything'), { ok: false, code: 503 })
eq('correct secret passes', withSecret('s3cret', 'Bearer s3cret'), { ok: true, code: 0 })
eq('wrong secret is rejected', withSecret('s3cret', 'Bearer nope'), { ok: false, code: 401 })
eq('missing header is rejected', withSecret('s3cret', null), { ok: false, code: 401 })
eq('a prefix of the secret is rejected', withSecret('s3cret', 'Bearer s3cre'), { ok: false, code: 401 })
eq('the bare secret without the scheme is rejected', withSecret('s3cret', 's3cret'), { ok: false, code: 401 })

console.log(failed ? `\n${failed} failing` : '\nall passing')
process.exit(failed ? 1 : 0)
