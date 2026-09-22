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

/**
 * The A1 range a capture landed on, e.g. "Submissions!A7:R7". Handed to the
 * client so the later update can rewrite that row instead of appending a
 * second one per visitor.
 */
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

// The client hands this range back on the update, so it is never trusted on
// shape alone: it has to be a single full row below the header, and the row's
// email has to match the person doing the updating.
const ROW_RANGE = /^(?:'[^']{1,80}'|[A-Za-z0-9_ ]{1,80})?!?A(\d{1,7}):R\1$/

export function parseRowRange(range) {
  const m = ROW_RANGE.exec(String(range || '').trim())
  if (!m) return null
  const row = Number(m[1])
  // Row 1 is the header. Rewriting it would break every reader of this sheet.
  if (!Number.isInteger(row) || row < 2) return null
  return { range: String(range).trim(), row }
}

async function sheetsFetch(path, init, env) {
  const token = await getAccessToken(env)
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
}

/**
 * Rewrites the row a capture created, once the visitor has actually used the
 * calculator. Refuses unless the row still belongs to the same email, so a
 * forged range cannot overwrite somebody else's record.
 */
export async function updateRow(range, row, expectedEmail, env = process.env) {
  const parsed = parseRowRange(range)
  if (!parsed) throw new Error('Malformed row range.')

  const read = await sheetsFetch(`/values/${encodeURIComponent(parsed.range)}`, {}, env)
  if (!read.ok) throw new Error(`Row read failed (${read.status}): ${(await read.text()).slice(0, 200)}`)

  const existing = (await read.json()).values?.[0] || []
  const emailCell = String(existing[COLUMNS.indexOf('email')] || '').toLowerCase()
  if (emailCell !== String(expectedEmail).toLowerCase()) {
    throw new Error('That row belongs to a different submission.')
  }

  // Merge rather than replace. The update carries a funnel but not the name,
  // phone or role the capture stored, and a blank in the new row means "I do
  // not have this" rather than "clear it".
  const merged = mergeRow(existing, row)

  const write = await sheetsFetch(
    `/values/${encodeURIComponent(parsed.range)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values: [merged] }) },
    env,
  )
  if (!write.ok) throw new Error(`Row update failed (${write.status}): ${(await write.text()).slice(0, 200)}`)
  return true
}

/**
 * A capture has no funnel yet, so those cells stay empty rather than being
 * filled with the defaults the visitor never chose. An empty cell is honest;
 * a default recorded as their answer is a lie in a spreadsheet.
 */
/** A blank in the incoming row keeps whatever the row already held. */
export function mergeRow(existing, incoming) {
  return COLUMNS.map((_, i) => {
    const next = incoming[i]
    if (next === '' || next === undefined || next === null) return existing?.[i] ?? ''
    return next
  })
}

export function buildRow({ firstName, email, phone, values, label, funnel, emailed }) {
  if (!funnel) {
    const blanks = () => ''
    return [
      new Date().toISOString(),
      firstName,
      email,
      phone || '',
      ...Array.from({ length: 12 }, blanks),
      emailed ? 'yes' : 'no',
      values.job_role || '',
    ]
  }
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
