#!/usr/bin/env node
/**
 * One-time OAuth consent, run locally. Prints a refresh token you paste into
 * your secret store. The token never touches a file, a shell history or a
 * chat window.
 *
 *   export GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
 *   export GOOGLE_OAUTH_CLIENT_SECRET=...
 *   npm run google:auth
 *   npm run google:auth -- --scopes sheets,drive,gmail-send,calendar
 *   npm run google:auth -- --verify        # check an existing refresh token
 *
 * Create the client as an OAuth "Desktop app". Google then accepts any
 * http://127.0.0.1 port without registering a redirect URI.
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'

const SCOPES = {
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
  drive: 'https://www.googleapis.com/auth/drive',
  'drive-file': 'https://www.googleapis.com/auth/drive.file',
  docs: 'https://www.googleapis.com/auth/documents',
  'gmail-send': 'https://www.googleapis.com/auth/gmail.send',
  'gmail-read': 'https://www.googleapis.com/auth/gmail.readonly',
  'gmail-modify': 'https://www.googleapis.com/auth/gmail.modify',
  calendar: 'https://www.googleapis.com/auth/calendar',
  'calendar-read': 'https://www.googleapis.com/auth/calendar.readonly',
}

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : process.argv[i + 1]
}

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const PORT = Number(arg('port') || 53682)

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set the client credentials first:\n')
  console.error('  export GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com')
  console.error('  export GOOGLE_OAUTH_CLIENT_SECRET=...\n')
  console.error('Create them at console.cloud.google.com -> APIs & Services -> Credentials')
  console.error('-> Create Credentials -> OAuth client ID -> Desktop app.')
  process.exit(1)
}

const requested = (arg('scopes') || 'sheets,drive-file').split(',').map((s) => s.trim()).filter(Boolean)
const unknown = requested.filter((s) => !SCOPES[s])
if (unknown.length) {
  console.error(`Unknown scope shortcut: ${unknown.join(', ')}`)
  console.error(`Available: ${Object.keys(SCOPES).join(', ')}`)
  process.exit(1)
}
const scope = requested.map((s) => SCOPES[s]).join(' ')

async function exchange(body) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

async function verify() {
  const token = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (!token) {
    console.error('Set GOOGLE_OAUTH_REFRESH_TOKEN to verify it.')
    process.exit(1)
  }
  const { ok, json } = await exchange({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: token,
  })
  if (!ok) {
    console.error(`Refresh failed: ${json.error_description || json.error}`)
    if (json.error === 'invalid_grant') {
      console.error('\nThe token is dead. Causes, in order of likelihood:')
      console.error('  1. The consent screen is still in Testing. Those tokens expire after 7 days.')
      console.error('  2. The account password changed.')
      console.error('  3. App access was revoked at myaccount.google.com/permissions.')
      console.error('  4. Unused for six months.')
      console.error('\nRe-run without --verify to mint a new one.')
    }
    process.exit(1)
  }
  console.log('Refresh token is valid.')
  console.log(`Access token expires in ${json.expires_in}s`)
  console.log(`Scopes: ${json.scope}`)
}

async function consent() {
  const state = randomBytes(16).toString('hex')
  const redirect = `http://127.0.0.1:${PORT}`
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirect,
      response_type: 'code',
      scope,
      // offline is what mints a refresh token at all; consent forces a fresh
      // one even when this account has already approved these scopes.
      access_type: 'offline',
      prompt: 'consent',
      state,
    })

  console.log('Scopes requested:')
  for (const s of requested) console.log(`  ${s.padEnd(14)} ${SCOPES[s]}`)
  console.log(`\nOpen this in a browser signed in as the account you want to act as:\n\n${url}\n`)
  console.log(`Waiting on ${redirect} ...`)

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, redirect)
      if (u.pathname !== '/') { res.writeHead(404).end(); return }

      const err = u.searchParams.get('error')
      const got = u.searchParams.get('code')
      const back = u.searchParams.get('state')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!doctype html><meta charset=utf-8><body style="font-family:system-ui;background:#0c0b0a;color:#f5f3ee;display:grid;place-items:center;height:100vh;margin:0"><p>${err || back !== state ? 'Something went wrong. Check the terminal.' : 'Done. Close this tab and go back to the terminal.'}</p></body>`)

      server.close()
      if (err) return reject(new Error(`Consent refused: ${err}`))
      if (back !== state) return reject(new Error('State mismatch. Start over.'))
      if (!got) return reject(new Error('No code in the callback.'))
      resolve(got)
    })
    server.on('error', (e) => reject(e.code === 'EADDRINUSE'
      ? new Error(`Port ${PORT} is busy. Re-run with --port 53683.`) : e))
    server.listen(PORT, '127.0.0.1')
    setTimeout(() => { server.close(); reject(new Error('Timed out after 5 minutes.')) }, 300000).unref()
  })

  const { ok, json } = await exchange({
    grant_type: 'authorization_code',
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: redirect,
  })

  if (!ok) {
    console.error(`\nToken exchange failed: ${json.error_description || json.error}`)
    process.exit(1)
  }
  if (!json.refresh_token) {
    console.error('\nGoogle returned no refresh token.')
    console.error('That happens when the account has already granted these scopes and prompt=consent')
    console.error('was not honoured. Revoke this app at myaccount.google.com/permissions and re-run.')
    process.exit(1)
  }

  console.log('\n' + '-'.repeat(64))
  console.log('GOOGLE_OAUTH_REFRESH_TOKEN')
  console.log(json.refresh_token)
  console.log('-'.repeat(64))
  console.log('\nStore it as a secret. It does not expire on its own, but it dies on a')
  console.log('password change, on revoking app access, after six months idle, and after')
  console.log('SEVEN DAYS if the OAuth consent screen is still in Testing.')
  console.log('\nSet the consent screen to Internal (Workspace only) to avoid that, or')
  console.log('publish it. Internal needs no Google verification.')
  console.log('\nAdd it with:  npx vercel env add GOOGLE_OAUTH_REFRESH_TOKEN production')
}

const run = process.argv.includes('--verify') ? verify : consent
run().catch((e) => { console.error(`\n${e.message}`); process.exit(1) })
