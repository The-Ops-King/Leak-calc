#!/usr/bin/env node
/** Math guardrails. No dependencies: `node scripts/test-calc.mjs`. */
import {
  computeLeak, BOOKING_CEILING, defaultMultiplier, researchMax, validateField, liftBookingRate,
  confidenceToMultiplier, defaultConfidence, posToValue, valueToPos, ROUNDERS, LIMITS, BANDS,
} from '../src/lib/calc.js'

let failed = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const truthy = (name, got) => eq(name, !!got, true)
const near = (name, got, want, tol = 1e-6) => eq(name, Math.abs(got - want) < tol, true)

const ids = BANDS.map((b) => b.id)
const base = { leads: 60, dealValue: 3000, bookingRate: 25, showRate: 60, closeRate: 35 }

// Under 1 minute never fabricates a leak.
eq('under 1 minute leaks nothing',
  computeLeak({ ...base, bookingRate: 70, multiplier: defaultMultiplier('under_1_min') }).leakMonthly, 0)
eq('under 1 minute cannot be dragged up', researchMax('under_1_min'), 1)
eq('under 1 minute confidence does nothing', confidenceToMultiplier('under_1_min', 100), 1)

// The confidence dial spans no-change to the full published lift.
for (const id of ids) {
  eq(`${id}: 0% confidence is no lift`, confidenceToMultiplier(id, 0), 1)
  near(`${id}: 100% confidence is the study max`, confidenceToMultiplier(id, 100), researchMax(id))
  const d = defaultConfidence(id)
  truthy(`${id}: default confidence is in range`, d >= 0 && d <= 100)
  truthy(`${id}: default sits under half the study`, d <= 50)
  near(`${id}: default confidence reproduces the config multiplier`,
    confidenceToMultiplier(id, d), defaultMultiplier(id), 0.02)
}

// Only the booking rate moves.
const r = computeLeak({ ...base, multiplier: 2.75 })
eq('show rate untouched', r.improved.showed / r.improved.booked, r.now.showed / r.now.booked)
eq('close rate untouched', r.improved.sold / r.improved.showed, r.now.sold / r.now.showed)
near('odds transform: 25% at 2.75x -> 47.8%', r.improvedBooking, (0.25 / 0.75 * 2.75) / (1 + 0.25 / 0.75 * 2.75) * 100)
eq('leads untouched', r.improved.leads, r.now.leads)

// The funnel multiplies out, so a skeptic can check it by hand.
for (const stage of [r.now, r.improved]) {
  near('booked = leads x booking rate', stage.booked, stage.leads * (stage.bookingRate / 100))
  near('revenue = sold x deal value', stage.revenue, stage.sold * 3000)
  near('lead to sale matches the funnel', stage.leadToSale, (stage.sold / stage.leads) * 100)
}

// The 80% booking cap holds, and never drags anyone backwards.
for (const id of ids) {
  for (const br of [1, 25, 50, 79, 80, 95, 100]) {
    const x = computeLeak({ ...base, bookingRate: br, multiplier: researchMax(id) })
    truthy(`${id} @ ${br}%: never exceeds ${BOOKING_CEILING}%`, x.improvedBooking <= BOOKING_CEILING + 1e-9 || br > BOOKING_CEILING)
    truthy(`${id} @ ${br}%: never goes backwards`, x.improvedBooking >= br - 1e-9)
    truthy(`${id} @ ${br}%: leak is never negative`, x.leakMonthly >= 0 && x.rawLeak >= 0)
  }
}
eq('already above the cap is flagged, not computed',
  computeLeak({ ...base, bookingRate: 85, multiplier: 2.75 }).aboveCeiling, true)

// The odds transform has to behave at BOTH ends. Multiplying the rate sends a
// 50% booker past 100%; closing the gap to the cap promotes a 1% booker to 64%.
near('1% booker stays believable at full confidence', liftBookingRate(1, 4.91), 4.73, 0.05)
truthy('1% booker lifts less than the raw multiplier would', liftBookingRate(1, 4.91) < 1 * 4.91)
truthy('low rates behave near-multiplicatively', Math.abs(liftBookingRate(1, 4.91) / 1 - 4.91) < 0.5)
truthy('high rates saturate instead of overflowing', liftBookingRate(50, 4.91) <= BOOKING_CEILING)
eq('a 1x multiplier changes nothing', liftBookingRate(25, 1), 25)

// The confidence dial must move the number across its whole range.
for (const id of ids.filter((i) => i !== 'under_1_min')) {
  let prev = -1
  for (let c = 0; c <= 100; c += 5) {
    const x = computeLeak({ ...base, multiplier: confidenceToMultiplier(id, c) })
    truthy(`${id} @ ${c}% confidence: never decreases`, x.leakMonthly >= prev)
    prev = x.leakMonthly
  }
  const lo = computeLeak({ ...base, multiplier: confidenceToMultiplier(id, 0) })
  const hi = computeLeak({ ...base, multiplier: confidenceToMultiplier(id, 100) })
  eq(`${id}: zero confidence means zero leak`, lo.leakMonthly, 0)
  truthy(`${id}: full confidence moves the number`, hi.leakMonthly > 0)
}

// Rounding is always down.
const odd = computeLeak({ leads: 37, dealValue: 2750, bookingRate: 18, showRate: 55, closeRate: 29, multiplier: 2.4 })
truthy('monthly rounds down', odd.leakMonthly <= odd.rawLeak)
eq('monthly lands on a hundred', odd.leakMonthly % 100, 0)
eq('annual is exactly 12x the shown monthly', odd.leakAnnual, odd.leakMonthly * 12)

// Validation refuses rather than computing.
truthy('rejects 0 leads', validateField('leads', 0))
truthy('rejects 10001 leads', validateField('leads', 10001))
truthy('rejects $99 deals', validateField('dealValue', 99))
truthy('rejects 0% booking', validateField('bookingRate', 0))
truthy('rejects 101% booking', validateField('bookingRate', 101))
truthy('rejects 5% show rate', validateField('showRate', 5))
truthy('rejects 101% close rate', validateField('closeRate', 101))
eq('accepts a normal funnel',
  ['leads', 'dealValue', 'bookingRate', 'showRate', 'closeRate'].map((k) => validateField(k, LIMITS[k].default)),
  [null, null, null, null, null])

// Log sliders map cleanly at both ends.
for (const key of Object.keys(LIMITS)) {
  eq(`${key} slider bottom`, posToValue(0, LIMITS[key], ROUNDERS[key]), LIMITS[key].min)
  eq(`${key} slider top`, posToValue(1000, LIMITS[key], ROUNDERS[key]), LIMITS[key].max)
  truthy(`${key} round trips`, Math.abs(valueToPos(posToValue(500, LIMITS[key], ROUNDERS[key]), LIMITS[key]) - 500) < 25)
}

console.log(failed ? `\n${failed} failing` : '\nall passing')
process.exit(failed ? 1 : 0)
