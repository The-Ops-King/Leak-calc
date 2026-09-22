/**
 * POST /api/submit
 *
 * Upserts a HighLevel contact tagged `leak-calculator` with the calculator
 * inputs stored as custom fields. The GHL token only ever exists here.
 */

import { buildBreakdownEmail } from '../lib/email.js'
import { appendRows, buildRow, sheetsConfigured } from '../lib/sheets.js'
import { sendAlert, shouldAlert } from '../lib/alert.js'
import { computeLeak, confidenceToMultiplier, BANDS } from '../src/lib/calc.js'
import { ghl, TAG, listCustomFields, customFieldPayload } from '../lib/ghl.js'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

// Mirrors config/multipliers.json. close_rate is show-to-sale, not lead-to-sale.
const LIMITS = {
  leads_per_month: [1, 10000],
  deal_value: [100, 100000],
  booking_rate: [1, 100],
  show_rate: [10, 100],
  close_rate: [1, 100],
  study_confidence: [0, 100],
  calculated_leak_monthly: [0, 100000000],
}

const BAND_IDS = new Set(BANDS.map((b) => b.id))

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/* ------------------------------------------------------------------ *
 * Rate limiting
 *
 * This is deliberately in-process: no KV store, no extra dependency. Vercel
 * runs several instances and recycles them, so a determined attacker can get
 * past it by waiting out a cold start or hitting a different instance. It
 * stops ordinary repeat submits and form-hammering, which is what it is for.
 * If this ever needs to be real, swap this block for Upstash Redis and the
 * rest of the file is unchanged.
 * ------------------------------------------------------------------ */
const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_WINDOW = 5
const MAX_TRACKED_IPS = 5000
const hits = new Map()

function rateLimited(ip) {
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS)

  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent)
    return true
  }

  recent.push(now)
  hits.set(ip, recent)

  if (hits.size > MAX_TRACKED_IPS) {
    for (const [key, times] of hits) {
      if (!times.length || now - times[times.length - 1] > WINDOW_MS) hits.delete(key)
      if (hits.size <= MAX_TRACKED_IPS) break
    }
  }
  return false
}

// Field ids change rarely and the lookup costs a round trip, so it is cached
// per warm instance. Ten minutes means a field created elsewhere is picked up
// without a redeploy.
const FIELD_TTL_MS = 10 * 60 * 1000
let fieldCache = { at: 0, byName: null }

async function cachedCustomFields(locationId) {
  if (fieldCache.byName && Date.now() - fieldCache.at < FIELD_TTL_MS) return fieldCache.byName
  try {
    const byName = await listCustomFields(locationId)
    fieldCache = { at: Date.now(), byName }
    return byName
  } catch (err) {
    console.error('Custom field lookup failed:', err.message)
    return fieldCache.byName || new Map()
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only.' })
  }

  const locationId = process.env.GHL_LOCATION_ID
  const token = process.env.GHL_PRIVATE_TOKEN
  if (!locationId || !token) {
    console.error('Missing GHL_PRIVATE_TOKEN or GHL_LOCATION_ID')
    return res.status(500).json({ error: 'This form is not wired up yet.' })
  }

  let data = req.body
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return res.status(400).json({ error: 'Bad request body.' }) }
  }
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Bad request body.' })

  // Bots get a 200 so they have nothing to tune against.
  if (typeof data.lc_ref === 'string' && data.lc_ref.trim() !== '') {
    return res.status(200).json({ ok: true })
  }
  if (Number(data.elapsedMs) < 2000) {
    return res.status(200).json({ ok: true })
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many submissions from this connection. Try again later.' })
  }

  const firstName = String(data.firstName || '').trim().slice(0, 80)
  const email = String(data.email || '').trim().toLowerCase().slice(0, 254)
  const phone = String(data.phone || '').trim().slice(0, 40)
  const jobRole = String(data.job_role || '').trim().slice(0, 60)

  if (!firstName) return res.status(400).json({ error: 'First name is required.' })
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'That email address is not valid.' })
  if (!BAND_IDS.has(data.response_time_band)) {
    return res.status(400).json({ error: 'Unrecognised response time.' })
  }
  if (!jobRole) return res.status(400).json({ error: 'Job role is required.' })

  const values = {}
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const v = Number(data[key])
    if (!Number.isFinite(v) || v < min || v > max) {
      return res.status(400).json({ error: `${key} is out of range.` })
    }
    values[key] = v
  }
  values.response_time_band = data.response_time_band
  values.job_role = jobRole

  const byName = await cachedCustomFields(locationId)
  const { customFields, missing } = customFieldPayload(byName, values)
  if (missing.length) {
    // Never drop the lead over a missing field. POST /api/setup creates them.
    console.warn(`GHL custom fields not found, skipped: ${missing.join(', ')}`)
  }

  const payload = {
    locationId,
    firstName,
    email,
    ...(phone ? { phone } : {}),
    tags: [TAG],
    source: 'Lead Leak Calculator',
    ...(customFields.length ? { customFields } : {}),
  }

  const { ok, status, json } = await ghl('/contacts/upsert', { method: 'POST', body: payload })

  if (!ok) {
    console.error('GHL upsert failed', status, JSON.stringify(json).slice(0, 600))
    return res.status(502).json({ error: 'We could not save that. Try again in a moment.' })
  }

  // The contact is safe from here. The sheet row and the email are both best
  // effort: either one failing costs a record or a message, never the lead.
  const label = BANDS.find((b) => b.id === values.response_time_band)?.label || values.response_time_band

  // Recomputed here rather than trusted from the browser. The arithmetic in a
  // message going out under your name should not be settable by the client.
  const funnel = computeLeak({
    leads: values.leads_per_month,
    dealValue: values.deal_value,
    bookingRate: values.booking_rate,
    showRate: values.show_rate,
    closeRate: values.close_rate,
    multiplier: confidenceToMultiplier(values.response_time_band, values.study_confidence),
  })

  const emailed = await sendBreakdown({ firstName, email, values, label, funnel })

  // The row goes in last so it can record whether the email actually went. Every
  // submission is logged, including the ones that get no number on the page.
  const sheeted = await appendSubmission({ firstName, email, phone, values, label, funnel, emailed })

  // A degraded submission still returns 200, because the lead is saved and the
  // visitor has nothing to act on. But silent degradation is how a dead token
  // goes unnoticed for weeks, so it gets reported.
  reportDegraded({ emailed, sheeted, missing, band: values.response_time_band, email })

  return res.status(200).json({ ok: true, emailed, sheeted, missingFields: missing })
}

function reportDegraded({ emailed, sheeted, missing, band, email }) {
  const problems = []
  // No email is expected for these two: neither gets a number on the page.
  const emailExpected = band !== 'under_1_min'
  if (!emailed && emailExpected && process.env.RESEND_API_KEY) problems.push('The breakdown email did not send.')
  if (!sheeted && sheetsConfigured()) problems.push('The Google Sheet row was not written.')
  if (missing.length) problems.push(`GHL custom fields not found, so their numbers were dropped: ${missing.join(', ')}`)
  if (!problems.length) return

  // Keyed by what broke, not by who submitted, so one dead credential is one
  // email rather than one per lead.
  if (!shouldAlert(`submit:${problems.join('|')}`)) return

  sendAlert({
    subject: 'A submission was only partly saved',
    lines: [
      `A lead came in and the contact was created, but parts of the pipeline failed.`,
      '',
      ...problems.map((p) => `- ${p}`),
      '',
      `Lead: ${email}`,
      '',
      'Run /api/health for the full picture. Further alerts for this same failure are suppressed for an hour.',
    ],
  }).catch((e) => console.error('Degraded alert threw', e?.message))
}

async function appendSubmission(entry) {
  if (!sheetsConfigured()) return false
  try {
    await appendRows([buildRow(entry)])
    return true
  } catch (err) {
    console.error('Sheet append failed:', err?.message)
    return false
  }
}

async function sendBreakdown({ firstName, email, values, label, funnel }) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM
  if (!key || !from) return false

  // Neither of these gets a number on the page, so neither gets one by email.
  if (values.response_time_band === 'under_1_min' || funnel.aboveCeiling) return false

  try {
    const { subject, html, text } = buildBreakdownEmail({
      firstName,
      deal: values.deal_value,
      band: label,
      target: values.response_time_band === '1_to_5_min' ? 'inside 1 minute' : 'inside 5 minutes',
      funnel,
    })

    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        html,
        text,
        reply_to: process.env.MAIL_REPLY_TO || undefined,
      }),
    })

    if (!res.ok) {
      console.error('Resend failed', res.status, (await res.text()).slice(0, 400))
      return false
    }
    return true
  } catch (err) {
    console.error('Breakdown email threw:', err?.message)
    return false
  }
}
