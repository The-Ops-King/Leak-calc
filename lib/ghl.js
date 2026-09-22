/**
 * Everything that talks to HighLevel. The field list lived in three places
 * before this and was about to live in four; a custom field that exists in one
 * copy and not another is a lead quietly losing its numbers.
 */

const BASE = 'https://services.leadconnectorhq.com'

// HighLevel documents both of these for the Version header. We send the first
// and retry once with the second if the API rejects the version.
const PRIMARY_VERSION = process.env.GHL_API_VERSION || '2021-07-28'
const FALLBACK_VERSION = PRIMARY_VERSION === 'v3' ? '2021-07-28' : 'v3'

export const TAG = 'leak-calculator'

/**
 * The contact custom fields this tool writes. Order is not meaningful. Adding
 * one here is enough: the submit path writes it, the health check notices it
 * missing, and the setup route creates it.
 */
export const CUSTOM_FIELDS = [
  { name: 'leads_per_month', dataType: 'NUMERICAL', placeholder: 'Leads per month' },
  { name: 'deal_value', dataType: 'MONETORY', placeholder: 'Average deal value' },
  { name: 'booking_rate', dataType: 'NUMERICAL', placeholder: 'Leads that book %' },
  { name: 'show_rate', dataType: 'NUMERICAL', placeholder: 'Bookings that show %' },
  { name: 'close_rate', dataType: 'NUMERICAL', placeholder: 'Shows that buy %' },
  { name: 'response_time_band', dataType: 'TEXT', placeholder: 'Response time band' },
  { name: 'study_confidence', dataType: 'NUMERICAL', placeholder: 'Study confidence %' },
  { name: 'calculated_leak_monthly', dataType: 'MONETORY', placeholder: 'Monthly leak' },
  { name: 'job_role', dataType: 'TEXT', placeholder: 'What they do' },
]

export const FIELD_NAMES = CUSTOM_FIELDS.map((f) => f.name)

export function ghlConfigured(env = process.env) {
  return Boolean(env.GHL_PRIVATE_TOKEN && env.GHL_LOCATION_ID)
}

export async function ghl(path, { method = 'GET', body, version = PRIMARY_VERSION } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GHL_PRIVATE_TOKEN}`,
      Version: version,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok && version === PRIMARY_VERSION && looksLikeVersionError(res.status, text)) {
    return ghl(path, { method, body, version: FALLBACK_VERSION })
  }

  return { ok: res.ok, status: res.status, json }
}

function looksLikeVersionError(status, text) {
  if (status !== 400 && status !== 404 && status !== 422) return false
  return /version/i.test(text)
}

/**
 * Field ids keyed by name. HighLevel returns `fieldKey` prefixed with
 * "contact.", and both forms are indexed so a field found either way still
 * resolves. That is also why renaming a field in the UI does not break this,
 * while deleting one does.
 */
export function indexCustomFields(list) {
  const byName = new Map()
  for (const f of list || []) {
    if (f.name) byName.set(String(f.name).toLowerCase(), f.id)
    if (f.fieldKey) byName.set(String(f.fieldKey).replace(/^contact\./, '').toLowerCase(), f.id)
  }
  return byName
}

export async function listCustomFields(locationId) {
  const { ok, status, json } = await ghl(`/locations/${locationId}/customFields?model=contact`)
  if (!ok) throw new Error(`Could not read custom fields (HTTP ${status}): ${JSON.stringify(json).slice(0, 200)}`)
  return indexCustomFields(json.customFields)
}

export function missingFieldNames(byName) {
  return FIELD_NAMES.filter((n) => !byName.has(n))
}

/** Creates one field from the list above. Refuses anything not on it. */
export async function createCustomField(locationId, name) {
  const spec = CUSTOM_FIELDS.find((f) => f.name === name)
  if (!spec) throw new Error(`${name} is not one of this tool's fields.`)

  const { ok, status, json } = await ghl(`/locations/${locationId}/customFields`, {
    method: 'POST',
    body: { name: spec.name, dataType: spec.dataType, placeholder: spec.placeholder, model: 'contact', position: 0 },
  })
  if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(json).slice(0, 200)}`)
  return json?.customField?.id
}

/**
 * HighLevel's docs show `fieldValue` while a lot of live v2 traffic uses
 * `field_value`. Both are sent so the value cannot land empty either way.
 */
export function customFieldPayload(byName, values) {
  const customFields = []
  const missing = []
  for (const name of FIELD_NAMES) {
    const id = byName.get(name)
    if (!id) { missing.push(name); continue }
    const v = String(values[name] ?? '')
    customFields.push({ id, fieldValue: v, field_value: v })
  }
  return { customFields, missing }
}
