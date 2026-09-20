#!/usr/bin/env node
/** Math guardrails. No dependencies: `node scripts/test-calc.mjs`. */
import { computeLeak, CEILING, defaultMultiplier, researchMax, validateField, posToValue, valueToPos, ROUNDERS, LIMITS, BANDS } from '../src/lib/calc.js'

let failed = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const truthy = (name, got) => eq(name, !!got, true)

// Under 1 minute must never fabricate a leak.
const optimal = computeLeak({ leads: 500, dealValue: 90000, closeRate: 40, multiplier: defaultMultiplier('under_1_min') })
eq('under 1 minute leaks nothing', optimal.leakMonthly, 0)
eq('under 1 minute multiplier is 1.00', defaultMultiplier('under_1_min'), 1)
eq('under 1 minute cannot be dragged up', researchMax('under_1_min'), 1)

// Nobody ever sees a negative leak, whatever they put in.
for (const cr of [0.1, 5, 24.9, 25, 30, 50]) {
  for (const band of BANDS.map((b) => b.id)) {
    const x = computeLeak({ leads: 1000, dealValue: 100000, closeRate: cr, multiplier: researchMax(band) })
    truthy(`${band} @ ${cr}% close rate is never negative`, x.leakMonthly >= 0 && x.rawLeak >= 0)
  }
}
eq('above the ceiling is flagged, not computed', computeLeak({ leads: 60, dealValue: 3000, closeRate: 30, multiplier: 2.75 }).aboveCeiling, true)

// The ceiling holds no matter how far the slider goes.
for (const band of BANDS.map((b) => b.id)) {
  const r = computeLeak({ leads: 100, dealValue: 5000, closeRate: 20, multiplier: researchMax(band) })
  truthy(`${band}: close rate never exceeds ${CEILING}%`, r.improvedCloseRate <= CEILING + 1e-9)
}

// Rounding is always down, never up.
const r = computeLeak({ leads: 37, dealValue: 2750, closeRate: 4.3, multiplier: 2.4 })
truthy('monthly rounds down', r.leakMonthly <= r.rawLeak)
eq('monthly lands on a hundred', r.leakMonthly % 100, 0)
eq('annual is exactly 12x the shown monthly', r.leakAnnual, r.leakMonthly * 12)

// Revenue is never multiplied directly.
const base = computeLeak({ leads: 60, dealValue: 3000, closeRate: 5, multiplier: 2.75 })
eq('current revenue', base.currentRevenue, 9000)
eq('improved close rate 5 x 2.75', base.improvedCloseRate, 13.75)
truthy('leak is far below revenue x multiplier', base.leakMonthly < base.currentRevenue * 2.75)

// Validation refuses rather than computing.
truthy('rejects 0 leads', validateField('leads', 0))
truthy('rejects 10001 leads', validateField('leads', 10001))
truthy('rejects $99 deals', validateField('dealValue', 99))
truthy('rejects 51% close rate', validateField('closeRate', 51))
eq('accepts a normal set', [validateField('leads', 60), validateField('dealValue', 3000), validateField('closeRate', 5)], [null, null, null])

// Log slider maps cleanly at both ends.
for (const key of ['leads', 'dealValue', 'closeRate']) {
  const lo = posToValue(0, LIMITS[key], ROUNDERS[key])
  const hi = posToValue(1000, LIMITS[key], ROUNDERS[key])
  eq(`${key} slider bottom`, lo, LIMITS[key].min)
  eq(`${key} slider top`, hi, LIMITS[key].max)
  truthy(`${key} round trips`, Math.abs(valueToPos(posToValue(500, LIMITS[key], ROUNDERS[key]), LIMITS[key]) - 500) < 25)
}

// Every band has a default, a max above it, and a stated basis.
for (const { id } of BANDS) {
  truthy(`${id} has a max at or above its default`, researchMax(id) >= defaultMultiplier(id))
}

console.log(failed ? `\n${failed} failing` : '\nall passing')
process.exit(failed ? 1 : 0)
