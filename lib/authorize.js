import { timingSafeEqual } from 'node:crypto'

/**
 * Shared guard for the routes that are not for visitors.
 *
 * Fails closed. An unset secret used to skip the check entirely, which meant a
 * missing variable silently opened the endpoint and looked identical to a
 * working guard. Comparison is constant time, because comparing a secret with
 * === leaks it a byte at a time to anyone willing to measure.
 */
export function authorize(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET is not set; refusing to run a privileged route.')
    res.status(503).json({ error: 'This endpoint is not configured.' })
    return false
  }
  const offered = Buffer.from(req.headers.authorization || '')
  const expected = Buffer.from(`Bearer ${secret}`)
  if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) {
    res.status(401).json({ error: 'Unauthorized.' })
    return false
  }
  return true
}
