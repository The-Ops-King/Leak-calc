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
import { timingSafeEqual } from 'node:crypto'

// Constant time, so the comparison cannot be used to guess the secret a byte
// at a time. Length is compared first because timingSafeEqual throws on a
// mismatch, and length is not the secret.
function timingSafeEqualString(a, b) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

const GHL_BASE = 'https://services.leadconnectorhq.com'
const FIELD_NAMES = [
  'leads_per_month', 'deal_value', 'booking_rate', 'show_rate',
  'close_rate', 'response_time_band', 'study_confidence', 'calculated_leak_monthly', 'job_role',
]

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'GET only.' })
  }

  // Fails closed. An unset secret used to skip the check entirely, which meant
  // a missing variable turned the endpoint into a free way for anyone to burn
  // three API quotas per request, and looked identical to a working guard.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET is not set; refusing to run the health check.')
    return res.status(503).json({ error: 'Health checks are not configured.' })
  }
  if (!timingSafeEqualString(req.headers.authorization || '', `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'Unauthorized.' })
  }

  const checks = {}
  const record = async (name, fn) => {
    try {
      checks[name] = { ok: true, ...(await fn()) }
    } catch (err) {
      checks[name] = { ok: false, error: String(err?.message || err).slice(0, 300) }
    }
  }

  await record('ghl', async () => {
    const { token, locationId } = { token: process.env.GHL_PRIVATE_TOKEN, locationId: process.env.GHL_LOCATION_ID }
    if (!token || !locationId) throw new Error('GHL_PRIVATE_TOKEN or GHL_LOCATION_ID is not set.')

    const r = await fetch(`${GHL_BASE}/locations/${locationId}/customFields?model=contact`, {
      headers: { Authorization: `Bearer ${token}`, Version: process.env.GHL_API_VERSION || '2021-07-28', Accept: 'application/json' },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)

    const body = await r.json()
    const present = new Set(
      (body.customFields || []).flatMap((f) => [
        String(f.name || '').toLowerCase(),
        String(f.fieldKey || '').replace(/^contact\./, '').toLowerCase(),
      ]),
    )
    const missing = FIELD_NAMES.filter((n) => !present.has(n))
    if (missing.length) throw new Error(`Custom fields missing: ${missing.join(', ')}. Run: npm run ghl:setup`)
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
