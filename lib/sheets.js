import { createSign } from 'node:crypto'

/**
 * Appends a row to a Google Sheet using a service account, signing the JWT
 * directly rather than pulling in googleapis. One dependency-free file, no
 * third party sitting between the form and the row.
 *
 * Needs GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_SHEET_ID,
 * with the sheet shared to the service account address as an Editor.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const DEFAULT_RANGE = 'Submissions!A:Q'

export const COLUMNS = [
  'timestamp',
  'first_name',
  'email',
  'phone',
  'leads_per_month',
  'deal_value',
  'booking_rate',
  'show_rate',
  'close_rate',
  'lead_to_sale_now',
  'response_time_band',
  'response_time_label',
  'study_confidence',
  'improved_booking_rate',
  'calculated_leak_monthly',
  'calculated_leak_annual',
  'emailed',
]

export function sheetsConfigured(env = process.env) {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY && env.GOOGLE_SHEET_ID)
}

const b64url = (input) => Buffer.from(input).toString('base64url')

// Vercel stores the key as one line, so the newlines arrive escaped.
const normalizeKey = (key) => key.replace(/\\n/g, '\n').trim()

export function signAssertion(email, privateKey) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, exp: now + 3600, iat: now }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  return `${header}.${claim}.${b64url(signer.sign(normalizeKey(privateKey)))}`
}

// Tokens last an hour. Reusing one across warm invocations saves a round trip
// on most submissions; the 60s margin keeps us clear of the boundary.
let cached = { token: null, expiresAt: 0 }

export async function getAccessToken(env = process.env) {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token

  const assertion = signAssertion(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_PRIVATE_KEY)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    throw new Error(`Google token exchange failed (${res.status}): ${body.error_description || body.error || 'no token'}`)
  }

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max((body.expires_in || 3600) - 60, 60) * 1000,
  }
  return cached.token
}

export async function appendRows(rows, env = process.env) {
  const token = await getAccessToken(env)
  const range = env.GOOGLE_SHEET_RANGE || DEFAULT_RANGE
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}` +
    `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  })

  if (!res.ok) {
    throw new Error(`Sheets append failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  }
  return res.json()
}

export function buildRow({ firstName, email, phone, values, label, funnel, emailed }) {
  return [
    new Date().toISOString(),
    firstName,
    email,
    phone || '',
    values.leads_per_month,
    values.deal_value,
    values.booking_rate,
    values.show_rate,
    values.close_rate,
    round(funnel.now.leadToSale, 2),
    values.response_time_band,
    label,
    values.study_confidence,
    round(funnel.improvedBooking, 1),
    funnel.leakMonthly,
    funnel.leakAnnual,
    emailed ? 'yes' : 'no',
  ]
}

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places
