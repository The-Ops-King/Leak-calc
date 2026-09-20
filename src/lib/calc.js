import config from '../../config/multipliers.json' with { type: 'json' }

export const BANDS = config.bands
export const LIMITS = config.limits
export const SOURCES = config.sources
export const CEILING = config.close_rate_ceiling

export function defaultMultiplier(bandId) {
  return config[bandId]
}

export function researchMax(bandId) {
  return config.research_max[bandId]
}

export function basisFor(bandId) {
  return config.basis[bandId]
}

/**
 * Validates a single numeric input against config/multipliers.json limits.
 * Returns null when the value is fine, or a sentence to show the user.
 */
export function validateField(key, value) {
  const limit = LIMITS[key]
  if (!limit) return null
  if (value === '' || value === null || value === undefined) {
    return FIELD_MESSAGES[key].empty
  }
  const n = Number(value)
  if (!Number.isFinite(n)) return FIELD_MESSAGES[key].empty
  if (n < limit.min || n > limit.max) return FIELD_MESSAGES[key].range
  return null
}

const FIELD_MESSAGES = {
  leads: {
    empty: 'Put a number of leads in and the math will run.',
    range: `That is outside what this tool can read honestly. It handles ${LIMITS.leads.min} to ${LIMITS.leads.max.toLocaleString()} leads a month. Above that your economics are different enough that an average multiplier would be guessing.`,
  },
  dealValue: {
    empty: 'Put an average deal value in and the math will run.',
    range: `This tool handles deals between $${LIMITS.dealValue.min} and $${LIMITS.dealValue.max.toLocaleString()}. Outside that range the response-time research stops being a fair comparison for your sale.`,
  },
  closeRate: {
    empty: 'Put your close rate in and the math will run.',
    range: `A lead-to-sale close rate under ${LIMITS.closeRate.min}% or over ${LIMITS.closeRate.max}% usually means the number being measured is not lead-to-sale. Check what the denominator is and try again.`,
  },
}

/**
 * The whole model. Multiplier is applied to close rate, never to revenue, and
 * the improved close rate is capped so nothing projects an absurd number.
 */
export function computeLeak({ leads, dealValue, closeRate, multiplier }) {
  const currentRevenue = leads * (closeRate / 100) * dealValue

  const uncappedCloseRate = closeRate * multiplier

  // The ceiling stops us projecting an absurd close rate. It must never drag
  // someone BELOW where they already are, which would print a negative leak
  // for anyone already closing above the ceiling.
  const aboveCeiling = closeRate >= CEILING
  const improvedCloseRate = Math.max(closeRate, Math.min(uncappedCloseRate, CEILING))
  const ceilingBinding = !aboveCeiling && uncappedCloseRate > CEILING

  const improvedRevenue = leads * (improvedCloseRate / 100) * dealValue
  const rawLeak = improvedRevenue - currentRevenue

  // Round down to the nearest hundred, always.
  const leakMonthly = Math.floor(rawLeak / 100) * 100

  // Annual is derived from the rounded monthly so anyone can check it with a
  // calculator and get the same answer.
  const leakAnnual = leakMonthly * 12

  // The multiplier the user actually gets once the ceiling is applied.
  const effectiveMultiplier = closeRate > 0 ? improvedCloseRate / closeRate : 1

  return {
    currentRevenue,
    improvedCloseRate,
    improvedRevenue,
    rawLeak,
    leakMonthly,
    leakAnnual,
    ceilingBinding,
    aboveCeiling,
    effectiveMultiplier,
    belowFloor: rawLeak > 0 && leakMonthly === 0,
  }
}

/**
 * Sliders run on a log scale. Leads, deal size and close rates are all
 * clustered near the bottom of their ranges, so a linear track would waste
 * most of the thumb travel on values nobody has.
 */
export function posToValue(pos, { min, max }, round) {
  const raw = Math.exp(Math.log(min) + (pos / 1000) * (Math.log(max) - Math.log(min)))
  return round(raw, min, max)
}

export function valueToPos(value, { min, max }) {
  const clamped = Math.min(Math.max(value, min), max)
  return ((Math.log(clamped) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 1000
}

export const ROUNDERS = {
  leads: (n, min, max) => clamp(Math.round(n), min, max),
  dealValue: (n, min, max) => {
    const step = n < 1000 ? 50 : n < 10000 ? 100 : 500
    return clamp(Math.round(n / step) * step, min, max)
  },
  closeRate: (n, min, max) => {
    const step = n < 1 ? 0.1 : n < 10 ? 0.25 : 1
    return clamp(Math.round(n / step) * step, min, max)
  },
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max)
}
