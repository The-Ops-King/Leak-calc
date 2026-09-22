/**
 * POST /api/setup
 *
 * Provisions what the submit path needs and nothing else: the HighLevel custom
 * fields on the fixed list in lib/ghl.js, and the sheet header row.
 *
 * It exists because the alternative was a terminal. Scope is deliberately
 * narrow. It creates only fields named in that list, it never edits or deletes
 * an existing field, and the only cell it writes is row one. It cannot be used
 * as a general HighLevel or Sheets proxy even by someone holding the secret.
 *
 * Idempotent: running it twice creates nothing the second time.
 */
import { authorize } from '../lib/authorize.js'
import { listCustomFields, createCustomField, missingFieldNames, ghlConfigured } from '../lib/ghl.js'
import { COLUMNS, sheetsConfigured } from '../lib/sheets.js'
import { getAccessToken } from '../lib/google-auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only.' })
  }
  if (!authorize(req, res)) return

  const report = {}

  report.ghl = await attempt(async () => {
    if (!ghlConfigured()) throw new Error('GHL_PRIVATE_TOKEN or GHL_LOCATION_ID is not set.')
    const locationId = process.env.GHL_LOCATION_ID

    const before = await listCustomFields(locationId)
    const missing = missingFieldNames(before)
    if (!missing.length) return { created: [], alreadyPresent: true }

    const created = []
    const failed = []
    // Serial, because a burst of creates against the same location is a good
    // way to end up with duplicates.
    for (const name of missing) {
      try {
        await createCustomField(locationId, name)
        created.push(name)
      } catch (err) {
        failed.push(`${name}: ${err.message}`)
      }
    }

    // Read back rather than trusting the writes.
    const after = await listCustomFields(locationId)
    const stillMissing = missingFieldNames(after)
    if (stillMissing.length) throw new Error(`Still missing after creating: ${stillMissing.join(', ')}. ${failed.join('; ')}`)
    return { created, verified: true }
  })

  report.sheet = await attempt(async () => {
    if (!sheetsConfigured()) throw new Error('Google credentials or GOOGLE_SHEET_ID are not set.')
    const token = await getAccessToken()
    const id = process.env.GOOGLE_SHEET_ID
    const range = encodeURIComponent('A1:Z1')

    const read = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!read.ok) throw new Error(`Header read failed, HTTP ${read.status}: ${(await read.text()).slice(0, 200)}`)

    const header = (await read.json()).values?.[0] || []
    if (header.join() === COLUMNS.join()) return { header: 'already correct', columns: header.length }

    const write = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent('A1')}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [COLUMNS] }),
      },
    )
    if (!write.ok) throw new Error(`Header write failed, HTTP ${write.status}: ${(await write.text()).slice(0, 200)}`)
    return { header: 'rewritten', was: header.length, now: COLUMNS.length }
  })

  const failed = Object.values(report).some((r) => !r.ok)
  return res.status(failed ? 502 : 200).json({ ok: !failed, ranAt: new Date().toISOString(), ...report })
}

async function attempt(fn) {
  try {
    return { ok: true, ...(await fn()) }
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 400) }
  }
}
