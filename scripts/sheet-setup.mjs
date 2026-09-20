#!/usr/bin/env node
/**
 * One-off setup for the Google Sheet.
 *
 *   npm run sheet:setup              write the header row, prove access
 *   npm run sheet:setup -- --verify  also append a test row and read it back
 *
 * Reads GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_SHEET_ID
 * from the environment. Nothing is written to disk and no key is logged.
 */
import { COLUMNS, appendRows, getAccessToken, sheetsConfigured, googleAuthMode } from '../lib/sheets.js'

const VERIFY = process.argv.includes('--verify')
const SHEET = process.env.GOOGLE_SHEET_ID
// Only treat the range as naming a tab when it actually does. Without one the
// API appends to the first sheet, which is what we want by default.
const RANGE = process.env.GOOGLE_SHEET_RANGE || ''
const NAMED_TAB = RANGE.includes('!') ? RANGE.split('!')[0].replace(/^'|'$/g, '') : null

if (!sheetsConfigured()) {
  console.error('Set GOOGLE_SHEET_ID plus one set of credentials.\n')
  console.error('  export GOOGLE_SHEET_ID=...     # the long id in the sheet URL\n')
  console.error('Service account:')
  console.error('  export GOOGLE_SERVICE_ACCOUNT_EMAIL=automation@your-project.iam.gserviceaccount.com')
  console.error('  export GOOGLE_PRIVATE_KEY="$(jq -r .private_key key.json)"\n')
  console.error('Or OAuth (npm run google:auth mints the refresh token):')
  console.error('  export GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... GOOGLE_OAUTH_REFRESH_TOKEN=...')
  process.exit(1)
}

async function api(path, init = {}) {
  const token = await getAccessToken()
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { ok: res.ok, status: res.status, json }
}

async function main() {
  const mode = googleAuthMode()
  console.log(`Auth mode:       ${mode}`)
  if (mode === 'service_account') console.log(`Service account: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`)
  console.log(`Sheet:           ${SHEET}`)

  const meta = await api('')
  if (!meta.ok) {
    console.error(`Cannot open the sheet (HTTP ${meta.status}).`)
    console.error(JSON.stringify(meta.json, null, 2).slice(0, 600))
    if (meta.status === 403) {
      console.error(
        mode === 'service_account'
          ? `\nShare the sheet with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} as an Editor. Project IAM roles do not grant access to Drive files; sharing does.`
          : '\nThe signed-in account cannot edit this sheet, or the refresh token lacks the spreadsheets scope. Re-run `npm run google:auth -- --scopes sheets,drive-file`.',
      )
    }
    if (meta.status === 404) console.error('\nCheck GOOGLE_SHEET_ID against the long id in the sheet URL.')
    process.exit(1)
  }
  console.log(`Opened "${meta.json.properties?.title}"`)

  const tabs = (meta.json.sheets || []).map((s) => s.properties.title)
  console.log(`Tabs: ${tabs.join(', ')}`)

  if (NAMED_TAB && !tabs.includes(NAMED_TAB)) {
    console.log(`\nGOOGLE_SHEET_RANGE names "${NAMED_TAB}", which does not exist. Creating it.`)
    const made = await api(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: NAMED_TAB } } }] }),
    })
    if (!made.ok) {
      console.error(`Could not create the tab: ${JSON.stringify(made.json).slice(0, 300)}`)
      process.exit(1)
    }
  }

  const TAB = NAMED_TAB || tabs[0]
  console.log(`Writing to:      ${TAB}${NAMED_TAB ? '' : '  (first sheet, no tab named in GOOGLE_SHEET_RANGE)'}`)

  const existing = await api(`/values/${encodeURIComponent(`${TAB}!A1:Q1`)}`)
  const header = existing.json?.values?.[0] || []

  if (header.length === 0) {
    const put = await api(
      `/values/${encodeURIComponent(`${TAB}!A1`)}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [COLUMNS] }) },
    )
    console.log(put.ok ? `\nHeader row written (${COLUMNS.length} columns).` : `\nHeader write failed: ${JSON.stringify(put.json).slice(0, 300)}`)
  } else if (header.join() === COLUMNS.join()) {
    console.log(`\nHeader row already correct (${header.length} columns).`)
  } else {
    console.log('\nHeader row differs from what the function writes.')
    console.log(`  sheet:    ${header.join(', ')}`)
    console.log(`  expected: ${COLUMNS.join(', ')}`)
    console.log('  Rows will still append in column order. Fix the header if you want them to line up.')
  }

  if (!VERIFY) {
    console.log('\nDone. Run with --verify to append a test row.')
    return
  }

  const row = [new Date().toISOString(), 'Leak', 'calc-test@example.com', '', 1000, 5000, 25, 60, 25, 3.75, 'same_day', 'Same day', 38, 41.2, 121400, 1456800, 'no']
  console.log('\nAppending a test row.')
  await appendRows([row])

  const back = await api(`/values/${encodeURIComponent(`${TAB}!A:Q`)}`)
  const rows = back.json?.values || []
  const last = rows[rows.length - 1] || []
  console.log(`Sheet now has ${rows.length} row(s) including the header.`)
  console.log(`Last row: ${last.join(' | ')}`)
  console.log(
    last[2] === 'calc-test@example.com'
      ? '\nThe append worked. Delete that test row when you are done.'
      : '\nThe row did not come back as expected. Check the tab and range.',
  )
}

main().catch((e) => { console.error(e.message); process.exit(1) })
