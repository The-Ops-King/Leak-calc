/**
 * GET /api/health
 *
 * Exercises every credential the submit path depends on, so a dead token is
 * found by a scheduled check rather than by a lead going missing. Run daily by
 * the cron in vercel.json. Emails on the transition into failure.
 *
 * Returns 200 when everything passes and 503 when anything does not, so a
 * failure is visible to Vercel's cron notifications even if the alert email is
 * itself the thing that is broken.
 *
 * No secret is ever returned. Only names, booleans and error text.
 */
import { getAccessToken, googleAuthMode } from '../lib/google-auth.js'
import { COLUMNS } from '../lib/sheets.js'
import { sendAlert, shouldAlert, alertRecipient } from '../lib/alert.js'
import { authorize } from '../lib/authorize.js'
import { listCustomFields, missingFieldNames, FIELD_NAMES, ghlConfigured } from '../lib/ghl.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'GET only.' })
  }

  if (!authorize(req, res)) return

  const checks = {}
  const record = async (name, fn) => {
    try {
      checks[name] = { ok: true, ...(await fn()) }
    } catch (err) {
      checks[name] = { ok: false, error: String(err?.message || err).slice(0, 300) }
    }
  }

  await record('ghl', async () => {
    if (!ghlConfigured()) throw new Error('GHL_PRIVATE_TOKEN or GHL_LOCATION_ID is not set.')
    const byName = await listCustomFields(process.env.GHL_LOCATION_ID)
    const missing = missingFieldNames(byName)
    if (missing.length) {
      throw new Error(`Custom fields missing: ${missing.join(', ')}. POST /api/setup creates them.`)
    }
    return { fields: FIELD_NAMES.length }
  })

  await record('google', async () => {
    const mode = googleAuthMode()
    if (!mode) throw new Error('No Google credentials configured.')
    const token = await getAccessToken()

    const sheetId = process.env.GOOGLE_SHEET_ID
    if (!sheetId) throw new Error('GOOGLE_SHEET_ID is not set.')
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('A1:R1')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!r.ok) throw new Error(`Sheet read failed, HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)

    const header = (await r.json()).values?.[0] || []
    if (header.join() !== COLUMNS.join()) {
      throw new Error(`Sheet header no longer matches the row the function writes. Expected ${COLUMNS.length} columns, found ${header.length}.`)
    }
    return { mode, columns: header.length }
  })

  await record('resend', async () => {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set.')
    const r = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const domains = (await r.json()).data || []
    const verified = domains.filter((d) => d.status === 'verified').map((d) => d.name)
    if (!verified.length) throw new Error(`No verified sending domain. Found: ${domains.map((d) => `${d.name}=${d.status}`).join(', ') || 'none'}`)
    return { verified }
  })

  const failed = Object.entries(checks).filter(([, v]) => !v.ok)

  if (failed.length && shouldAlert(failed.map(([k]) => k).join(','))) {
    await sendAlert({
      subject: `${failed.length} check${failed.length > 1 ? 's' : ''} failing`,
      lines: [
        'The lead calculator is still taking submissions, but part of the pipeline is broken.',
        '',
        ...failed.map(([name, v]) => `${name.toUpperCase()}: ${v.error}`),
        '',
        'Passing: ' + (Object.entries(checks).filter(([, v]) => v.ok).map(([k]) => k).join(', ') || 'none'),
      ],
    }).catch((e) => console.error('Alert threw', e?.message))
  }

  return res.status(failed.length ? 503 : 200).json({
    ok: failed.length === 0,
    checkedAt: new Date().toISOString(),
    alertsTo: alertRecipient() ? 'configured' : 'NOT CONFIGURED',
    checks,
  })
}
