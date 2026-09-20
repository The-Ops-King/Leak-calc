/**
 * Operational alerts. Sent through the same Resend account the breakdown uses,
 * with the obvious caveat that a Resend outage takes the alarm down with the
 * thing it is meant to report. The health check covers that case by returning
 * a non-200, which Vercel's own cron failure notification picks up.
 */

// One alert per subject per hour. A dead credential fires on every request
// otherwise, and an inbox full of the same warning gets muted, which is the
// same as having no alerting at all.
const WINDOW_MS = 60 * 60 * 1000
const lastSent = new Map()

export function shouldAlert(key, now = Date.now()) {
  const previous = lastSent.get(key)
  if (previous && now - previous < WINDOW_MS) return false
  lastSent.set(key, now)
  return true
}

export function alertRecipient(env = process.env) {
  if (env.MAIL_ALERT_TO) return env.MAIL_ALERT_TO
  // Fall back to the From address, which is already a mailbox you own.
  const from = env.MAIL_FROM || ''
  const angled = from.match(/<([^>]+)>/)
  return angled ? angled[1] : from.trim() || null
}

export async function sendAlert({ subject, lines, env = process.env }) {
  const key = env.RESEND_API_KEY
  const from = env.MAIL_FROM
  const to = alertRecipient(env)
  if (!key || !from || !to) return false

  const body = lines.join('\n')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `[leak-calc] ${subject}`,
      text: `${body}\n\nhttps://leak.jtylerray.com\nhttps://vercel.com/jtylerray/leak-calc/logs\n`,
    }),
  })
  if (!res.ok) console.error('Alert send failed', res.status, (await res.text()).slice(0, 300))
  return res.ok
}
