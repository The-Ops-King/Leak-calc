import { getAccessToken, googleConfigured, googleAuthMode } from './google-auth.js'

/**
 * Appends a row to a Google Sheet. Credentials come from lib/google-auth.js,
 * which accepts either a service account or an OAuth refresh token, so this
 * file does not care which you use.
 */

// No sheet name: the Sheets API then appends to the first sheet in the file.
// Naming a tab here would break the moment the tab is renamed, or the file is
// created from a CSV, which names the tab after the file.
const DEFAULT_RANGE = 'A:R'

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
  // Appended rather than slotted next to the other person fields, so rows
  // written before this existed keep their column alignment.
  'job_role',
]

export function sheetsConfigured(env = process.env) {
  return Boolean(env.GOOGLE_SHEET_ID) && googleConfigured(env)
}

export { getAccessToken, googleAuthMode }

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
    values.job_role || '',
  ]
}

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places
