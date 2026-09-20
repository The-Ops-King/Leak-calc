import { createSign } from 'node:crypto'

/**
 * One access-token source for every Google call, accepting either credential
 * type so the choice is an env change rather than a code change.
 *
 *   service account  GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY
 *                    A robot identity with its own empty Drive. Reaches only
 *                    what is explicitly shared with it. Never expires, never
 *                    needs a human. The right default for anything unattended.
 *
 *   oauth            GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET
 *                    + GOOGLE_OAUTH_REFRESH_TOKEN
 *                    Acts as the user, so it reaches Gmail and Calendar too.
 *                    The refresh token dies on a password change, on revoking
 *                    app access, after six months idle, and after seven days
 *                    if the OAuth consent screen is still in Testing.
 *
 * Both are honoured when both are present, service account first, because an
 * unattended function should prefer the credential that cannot expire.
 * GOOGLE_AUTH_MODE forces one.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

export function googleAuthMode(env = process.env) {
  const hasServiceAccount = Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY)
  const hasOauth = Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN,
  )

  const forced = env.GOOGLE_AUTH_MODE
  if (forced === 'service_account') return hasServiceAccount ? 'service_account' : null
  if (forced === 'oauth') return hasOauth ? 'oauth' : null

  if (hasServiceAccount) return 'service_account'
  if (hasOauth) return 'oauth'
  return null
}

export const googleConfigured = (env = process.env) => googleAuthMode(env) !== null

const b64url = (input) => Buffer.from(input).toString('base64url')

// Vercel stores multi-line secrets on one line, so newlines arrive escaped.
const normalizeKey = (key) => key.replace(/\\n/g, '\n').trim()

export function signAssertion(email, privateKey, scope = DEFAULT_SCOPE) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({ iss: email, scope, aud: TOKEN_URL, exp: now + 3600, iat: now }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  return `${header}.${claim}.${b64url(signer.sign(normalizeKey(privateKey)))}`
}

// Tokens last an hour. Reusing one across warm invocations saves a round trip;
// the 60s margin keeps us clear of the boundary. Keyed by mode so switching
// credentials cannot serve a token minted by the other one.
let cached = { key: null, token: null, expiresAt: 0 }

export async function getAccessToken(env = process.env, scope = DEFAULT_SCOPE) {
  const mode = googleAuthMode(env)
  if (!mode) throw new Error('No Google credentials configured.')

  const cacheKey = `${mode}:${scope}`
  if (cached.key === cacheKey && cached.token && Date.now() < cached.expiresAt) return cached.token

  const body =
    mode === 'service_account'
      ? {
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: signAssertion(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_PRIVATE_KEY, scope),
        }
      : {
          grant_type: 'refresh_token',
          client_id: env.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
          refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
        }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    // invalid_grant on the oauth path almost always means the refresh token
    // died, not that the request was malformed. Say so, or the next person
    // spends an hour checking the client secret.
    const hint =
      mode === 'oauth' && json.error === 'invalid_grant'
        ? ' The refresh token is no longer valid. Re-run `npm run google:auth`. This happens after a password change, after revoking app access, after six months idle, or after seven days if the consent screen is still in Testing.'
        : ''
    throw new Error(`Google token exchange failed (${res.status}, ${mode}): ${json.error_description || json.error || 'no token'}.${hint}`)
  }

  cached = {
    key: cacheKey,
    token: json.access_token,
    expiresAt: Date.now() + Math.max((json.expires_in || 3600) - 60, 60) * 1000,
  }
  return cached.token
}
