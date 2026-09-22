/**
 * POST /api/submit
 *
 * Two phases, because the form now comes before the calculator.
 *
 *   capture  The form. Creates the tagged HighLevel contact and a sheet row
 *            straight away, so a visitor who never touches the calculator is
 *            still a lead. The funnel cells stay empty rather than being
 *            filled with defaults nobody chose.
 *
 *   update   Once they have actually used the calculator. Upserts the same
 *            contact by email, rewrites that same sheet row rather than
 *            appending a second one, and sends the breakdown the first time.
 *
 * Tokens only ever exist here.
 */
import { buildBreakdownEmail } from '../lib/email.js'
import { appendRows, updateRow, buildRow, sheetsConfigured } from '../lib/sheets.js'
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
 * In-process on purpose: no KV store, no extra dependency. Vercel runs several
 * instances and recycles them, so this is best effort and stops ordinary form
 * hammering rather than a determined attacker. Swap this block for Upstash and
 * the rest of the file is unchanged.
 *
 * Captures and updates get separate budgets. A capture creates a lead and is
 * rare; an update fires whenever someone drags a slider, so one limit for both
 * would either throttle normal use or leave captures wide open.
 * ------------------------------------------------------------------ */
const WINDOW_MS = 60 * 60 * 1000
const CAPS = { capture: 5, update: 40 }
const MAX_TRACKED = 5000
const hits = new Map()

function rateLimited(key, cap) {
  const now = Date.now()
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= cap) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)

  if (hits.size > MAX_TRACKED) {
    for (const [k, times] of hits) {
      if (!times.length || now - times[times.length - 1] > WINDOW_MS) hits.delete(k)
      if (hits.size <= MAX_TRACKED) break
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

// One breakdown per address per hour, however many times they drag a slider.
const emailed = new Map()

/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only.' })
  }

  const locationId = process.env.GHL_LOCATION_ID
  if (!locationId || !process.env.GHL_PRIVATE_TOKEN) {
    console.error('Missing GHL_PRIVATE_TOKEN or GHL_LOCATION_ID')
    return res.status(500).json({ error: 'This form is not wired up yet.' })
  }

  let data = req.body
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return res.status(400).json({ error: 'Bad request body.' }) }
  }
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Bad request body.' })

  const phase = data.phase === 'update' ? 'update' : 'capture'

  // Bots get a 200 so they have nothing to tune against. Only the capture
  // carries the honeypot and the timer; an update is already behind one.
  if (phase === 'capture') {
    if (typeof data.lc_ref === 'string' && data.lc_ref.trim() !== '') return res.status(200).json({ ok: true })
    if (Number(data.elapsedMs) < 2000) return res.status(200).json({ ok: true })
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  if (rateLimited(`${phase}:${ip}`, CAPS[phase])) {
    return res.status(429).json({ error: 'Too many submissions from this connection. Try again later.' })
  }

  const email = String(data.email || '').trim().toLowerCase().slice(0, 254)
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'That email address is not valid.' })

  const firstName = String(data.firstName || '').trim().slice(0, 80)
  const phone = String(data.phone || '').trim().slice(0, 40)
  const jobRole = String(data.job_role || '').trim().slice(0, 60)

  if (phase === 'capture') {
    if (!firstName) return res.status(400).json({ error: 'First name is required.' })
    if (!jobRole) return res.status(400).json({ error: 'Job role is required.' })
  }

  // Only an update carries a funnel, and it must carry a complete one: a
  // partially filled contact is worse than one that is plainly still empty.
  let values = { job_role: jobRole }
  let funnel = null
  let label = ''

  if (phase === 'update') {
    if (!BAND_IDS.has(data.response_time_band)) {
      return res.status(400).json({ error: 'Unrecognised response time.' })
    }
    for (const [key, [min, max]] of Object.entries(LIMITS)) {
      const v = Number(data[key])
      if (!Number.isFinite(v) || v < min || v > max) {
        return res.status(400).json({ error: `${key} is out of range.` })
      }
      values[key] = v
    }
    values.response_time_band = data.response_time_band
    label = BANDS.find((b) => b.id === values.response_time_band)?.label || values.response_time_band

    // Recomputed here rather than trusted from the browser. The arithmetic in
    // a message going out under your name is not something a client can set.
    funnel = computeLeak({
      leads: values.leads_per_month,
      dealValue: values.deal_value,
      bookingRate: values.booking_rate,
      showRate: values.show_rate,
      closeRate: values.close_rate,
      multiplier: confidenceToMultiplier(values.response_time_band, values.study_confidence),
    })
  }

  const byName = await cachedCustomFields(locationId)
  const { customFields, missing } = customFieldPayload(byName, values)
  if (missing.length) {
    // Never drop the lead over a missing field. POST /api/setup creates them.
    console.warn(`GHL custom fields not found, skipped: ${missing.join(', ')}`)
  }

  const { ok, status, json } = await ghl('/contacts/upsert', {
    method: 'POST',
    body: {
      locationId,
      email,
      ...(firstName ? { firstName } : {}),
      ...(phone ? { phone } : {}),
      tags: [TAG],
      source: 'Lead Leak Calculator',
      ...(customFields.length ? { customFields } : {}),
    },
  })

  if (!ok) {
    console.error('GHL upsert failed', status, JSON.stringify(json).slice(0, 600))
    return res.status(502).json({ error: 'We could not save that. Try again in a moment.' })
  }

  // The contact is safe from here. Everything below is best effort: a failure
  // costs a record or a message, never the lead.
  const sentEmail = phase === 'update' && data.sendEmail !== false
    ? await sendBreakdown({ firstName, email, values, label, funnel })
    : false

  const sheet = phase === 'capture'
    ? await captureRow({ firstName, email, phone, values, emailed: sentEmail })
    : await refreshRow({ range: data.rowRange, firstName, email, phone, values, label, funnel, emailed: sentEmail })

  reportDegraded({ phase, sentEmail, sheet, missing, values, email })

  return res.status(200).json({
    ok: true,
    phase,
    emailed: sentEmail,
    sheeted: sheet.ok,
    rowRange: sheet.range,
    missingFields: missing,
  })
}

async function captureRow({ firstName, email, phone, values, emailed }) {
  if (!sheetsConfigured()) return { ok: false }
  try {
    const result = await appendRows([buildRow({ firstName, email, phone, values, funnel: null, emailed })])
    return { ok: true, range: result?.updates?.updatedRange }
  } catch (err) {
    console.error('Sheet append failed:', err?.message)
    return { ok: false }
  }
}

async function refreshRow({ range, firstName, email, phone, values, label, funnel, emailed }) {
  if (!sheetsConfigured()) return { ok: false }
  const row = buildRow({ firstName, email, phone, values, label, funnel, emailed })
  try {
    if (range) {
      await updateRow(range, row, email)
      return { ok: true, range }
    }
    // No range means the capture's append failed. Append now rather than
    // losing the funnel entirely.
    const result = await appendRows([row])
    return { ok: true, range: result?.updates?.updatedRange }
  } catch (err) {
    console.error('Sheet row update failed:', err?.message)
    return { ok: false, range }
  }
}

async function sendBreakdown({ firstName, email, values, label, funnel }) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM
  if (!key || !from || !funnel) return false

  // Neither of these gets a number on the page, so neither gets one by email.
  if (values.response_time_band === 'under_1_min' || funnel.aboveCeiling) return false

  const last = emailed.get(email)
  if (last && Date.now() - last < 60 * 60 * 1000) return false

  try {
    const { subject, html, text } = buildBreakdownEmail({
      firstName: firstName || 'there',
      deal: values.deal_value,
      band: label,
      target: values.response_time_band === '1_to_5_min' ? 'inside 1 minute' : 'inside 5 minutes',
      funnel,
    })

    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject, html, text, reply_to: process.env.MAIL_REPLY_TO || undefined }),
    })

    if (!res.ok) {
      console.error('Resend failed', res.status, (await res.text()).slice(0, 400))
      return false
    }
    emailed.set(email, Date.now())
    return true
  } catch (err) {
    console.error('Breakdown email threw:', err?.message)
    return false
  }
}

function reportDegraded({ phase, sentEmail, sheet, missing, values, email }) {
  const problems = []
  const emailExpected = phase === 'update' && values.response_time_band !== 'under_1_min'
  if (!sentEmail && emailExpected && process.env.RESEND_API_KEY) problems.push('The breakdown email did not send.')
  if (!sheet.ok && sheetsConfigured()) problems.push(`The Google Sheet row was not ${phase === 'capture' ? 'written' : 'updated'}.`)
  if (missing.length) problems.push(`GHL custom fields not found, so their numbers were dropped: ${missing.join(', ')}`)
  if (!problems.length) return

  // Keyed by what broke, not by who submitted, so one dead credential is one
  // email rather than one per lead.
  if (!shouldAlert(`submit:${problems.join('|')}`)) return

  sendAlert({
    subject: 'A submission was only partly saved',
    lines: [
      `A ${phase} came in and the contact was created, but parts of the pipeline failed.`,
      '',
      ...problems.map((p) => `- ${p}`),
      '',
      `Lead: ${email}`,
      '',
      'Run /api/health for the full picture. Further alerts for this same failure are suppressed for an hour.',
    ],
  }).catch((e) => console.error('Degraded alert threw', e?.message))
}
