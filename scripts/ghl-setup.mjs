#!/usr/bin/env node
/**
 * One-off setup for the HighLevel sub-account.
 *
 *   npm run ghl:setup              list fields, create any that are missing
 *   npm run ghl:setup -- --verify  also round trip a test contact and read it back
 *
 * Reads GHL_PRIVATE_TOKEN and GHL_LOCATION_ID from the environment. Nothing is
 * written to disk and no token is logged.
 */

const BASE = 'https://services.leadconnectorhq.com'
const TOKEN = process.env.GHL_PRIVATE_TOKEN
const LOCATION = process.env.GHL_LOCATION_ID
const VERIFY = process.argv.includes('--verify')

const FIELDS = [
  { name: 'leads_per_month', dataType: 'NUMERICAL', placeholder: 'Leads per month' },
  { name: 'deal_value', dataType: 'MONETORY', placeholder: 'Average deal value' },
  { name: 'booking_rate', dataType: 'NUMERICAL', placeholder: 'Leads that book %' },
  { name: 'show_rate', dataType: 'NUMERICAL', placeholder: 'Bookings that show %' },
  { name: 'close_rate', dataType: 'NUMERICAL', placeholder: 'Shows that buy %' },
  { name: 'response_time_band', dataType: 'TEXT', placeholder: 'Response time band' },
  { name: 'study_confidence', dataType: 'NUMERICAL', placeholder: 'Study confidence %' },
  { name: 'calculated_leak_monthly', dataType: 'MONETORY', placeholder: 'Monthly leak' },
]

if (!TOKEN || !LOCATION) {
  console.error('Set GHL_PRIVATE_TOKEN and GHL_LOCATION_ID first.')
  console.error('  export GHL_PRIVATE_TOKEN=pit-...')
  console.error('  export GHL_LOCATION_ID=...')
  process.exit(1)
}

const VERSIONS = [process.env.GHL_API_VERSION, '2021-07-28', 'v3'].filter(Boolean)
let goodVersion = null

async function call(path, { method = 'GET', body } = {}) {
  const tries = goodVersion ? [goodVersion] : VERSIONS
  let last
  for (const version of tries) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Version: version,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = { raw: text } }
    last = { ok: res.ok, status: res.status, json, version }
    if (res.ok) { goodVersion = version; return last }
    if (!/version/i.test(text)) return last
  }
  return last
}

async function main() {
  console.log(`Location ${LOCATION}\n`)

  const list = await call(`/locations/${LOCATION}/customFields?model=contact`)
  if (!list.ok) {
    console.error(`Could not read custom fields (HTTP ${list.status}).`)
    console.error(JSON.stringify(list.json, null, 2).slice(0, 800))
    console.error('\nCheck that the Private Integration token has the locations/customFields scopes.')
    process.exit(1)
  }
  console.log(`Version header that works: ${goodVersion}\n`)

  const existing = new Map()
  for (const f of list.json.customFields || []) {
    const bare = String(f.fieldKey || f.name || '').replace(/^contact\./, '').toLowerCase()
    existing.set(bare, f)
  }

  const ids = {}
  for (const spec of FIELDS) {
    const found = existing.get(spec.name.toLowerCase())
    if (found) {
      ids[spec.name] = found.id
      console.log(`  exists   ${spec.name.padEnd(26)} ${found.id}  (${found.dataType})`)
      continue
    }
    const made = await call(`/locations/${LOCATION}/customFields`, {
      method: 'POST',
      body: { name: spec.name, dataType: spec.dataType, placeholder: spec.placeholder, model: 'contact', position: 0 },
    })
    if (made.ok) {
      const id = made.json?.customField?.id
      ids[spec.name] = id
      console.log(`  created  ${spec.name.padEnd(26)} ${id}  (${spec.dataType})`)
    } else {
      console.log(`  FAILED   ${spec.name.padEnd(26)} HTTP ${made.status} ${JSON.stringify(made.json).slice(0, 200)}`)
    }
  }

  if (!VERIFY) {
    console.log('\nDone. Run with --verify to round trip a test contact.')
    return
  }

  const email = `leak-calc-test+${Date.now()}@example.com`
  const customFields = Object.entries(ids).map(([name, id]) => {
    const v = name === 'response_time_band' ? 'same_day' : '42'
    return { id, fieldValue: v, field_value: v }
  })

  console.log(`\nUpserting test contact ${email}`)
  const up = await call('/contacts/upsert', {
    method: 'POST',
    body: { locationId: LOCATION, firstName: 'Leak', lastName: 'CalcTest', email, tags: ['leak-calculator'], customFields },
  })
  if (!up.ok) {
    console.error(`Upsert failed (HTTP ${up.status}): ${JSON.stringify(up.json).slice(0, 600)}`)
    process.exit(1)
  }

  const contactId = up.json?.contact?.id
  console.log(`Created contact ${contactId}. Reading it back.`)

  const back = await call(`/contacts/${contactId}`)
  const got = new Map((back.json?.contact?.customFields || []).map((f) => [f.id, f.value ?? f.fieldValue ?? f.field_value]))

  let allGood = true
  for (const [name, id] of Object.entries(ids)) {
    const v = got.get(id)
    const ok = v !== undefined && v !== null && String(v) !== ''
    if (!ok) allGood = false
    console.log(`  ${ok ? 'ok  ' : 'EMPTY'} ${name.padEnd(26)} ${v ?? ''}`)
  }

  console.log(
    allGood
      ? '\nAll custom fields wrote correctly. Delete the test contact when you are done.'
      : '\nSome fields came back empty. Check the field dataType matches the value being sent.',
  )
  console.log(`Test contact: ${email} (${contactId})`)
}

main().catch((e) => { console.error(e); process.exit(1) })
