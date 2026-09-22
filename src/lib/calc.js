import config from '../../config/multipliers.json' with { type: 'json' }

export const BANDS = config.bands
export const LIMITS = config.limits
export const SOURCES = config.sources
export const JOB_ROLES = config.job_roles
export const BOOKING_CEILING = config.booking_rate_ceiling

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
 * The slider is a confidence dial, not a multiplier dial. 100 means "the study
 * is right"; 0 means "none of it holds". The defaults in the config sit well
 * under half of what the research claims, which is where the dial opens.
 */
export function confidenceToMultiplier(bandId, confidence) {
  const max = researchMax(bandId)
  return 1 + (max - 1) * (confidence / 100)
}

export function defaultConfidence(bandId) {
  const max = researchMax(bandId)
  if (max <= 1) return 0
  return Math.round(((defaultMultiplier(bandId) - 1) / (max - 1)) * 100)
}

export function validateField(key, value) {
  const limit = LIMITS[key]
  if (!limit) return null
  if (value === '' || value === null || value === undefined) return FIELD_MESSAGES[key].empty
  const n = Number(value)
  if (!Number.isFinite(n)) return FIELD_MESSAGES[key].empty
  if (n < limit.min || n > limit.max) return FIELD_MESSAGES[key].range
  return null
}

const FIELD_MESSAGES = {
  leads: {
    empty: 'Put a number of leads in and the math will run.',
    range: `This tool handles ${LIMITS.leads.min} to ${LIMITS.leads.max.toLocaleString()} leads a month. Above that your economics are different enough that an average multiplier would be guessing.`,
  },
  dealValue: {
    empty: 'Put an average deal value in and the math will run.',
    range: `This tool handles deals between $${LIMITS.dealValue.min} and $${LIMITS.dealValue.max.toLocaleString()}. Outside that the response-time research stops being a fair comparison for your sale.`,
  },
  bookingRate: {
    empty: 'Put your booking rate in and the math will run.',
    range: `A booking rate has to land between ${LIMITS.bookingRate.min}% and ${LIMITS.bookingRate.max}% of the leads you get.`,
  },
  showRate: {
    empty: 'Put your show rate in and the math will run.',
    range: `A show rate under ${LIMITS.showRate.min}% usually means something other than no-shows is going on. Check what is being counted.`,
  },
  closeRate: {
    empty: 'Put your close rate in and the math will run.',
    range: `This is the percentage of people who show up that buy, so it has to sit between ${LIMITS.closeRate.min}% and ${LIMITS.closeRate.max}%.`,
  },
}

/**
 * The funnel. The multiplier touches the booking rate and nothing else, because
 * that is what the studies measure: whether you reach and qualify the lead.
 * Show rate and close rate stay exactly where the operator put them.
 */
export function computeLeak({ leads, dealValue, bookingRate, showRate, closeRate, multiplier }) {
  const aboveCeiling = bookingRate >= BOOKING_CEILING
  const improvedBooking = liftBookingRate(bookingRate, multiplier)
  const ceilingBinding = !aboveCeiling && improvedBooking >= BOOKING_CEILING - 1e-9

  const now = stage(leads, bookingRate, showRate, closeRate, dealValue)
  const improved = stage(leads, improvedBooking, showRate, closeRate, dealValue)

  const rawLeak = improved.revenue - now.revenue
  const leakMonthly = Math.floor(rawLeak / 100) * 100

  return {
    now,
    improved,
    improvedBooking,
    rawLeak,
    leakMonthly,
    // Derived from the rounded monthly so it checks out on a calculator.
    leakAnnual: leakMonthly * 12,
    aboveCeiling,
    ceilingBinding,
    effectiveMultiplier: bookingRate > 0 ? improvedBooking / bookingRate : 1,
    belowFloor: rawLeak > 0 && leakMonthly === 0,
  }
}

/**
 * The lift is an odds ratio, not a rate multiplier, because that is what the
 * research actually says. "21x more likely to qualify" is a statement about
 * odds, and odds are what you can legitimately multiply.
 *
 * Multiplying the rate itself breaks at both ends: it sends a 50% booker past
 * 100%, and it pins everyone to the cap so the confidence dial goes dead.
 * Closing the gap to the cap instead breaks at the bottom, promoting a 1%
 * booker to 64%. The odds transform behaves at both: near-multiplicative when
 * the rate is low, naturally saturating when it is high.
 */
export function liftBookingRate(bookingRate, multiplier) {
  if (bookingRate >= BOOKING_CEILING || multiplier <= 1) return bookingRate
  const odds = bookingRate / (100 - bookingRate)
  const lifted = odds * multiplier
  return Math.min((lifted / (1 + lifted)) * 100, BOOKING_CEILING)
}

function stage(leads, bookingRate, showRate, closeRate, dealValue) {
  const booked = leads * (bookingRate / 100)
  const showed = booked * (showRate / 100)
  const sold = showed * (closeRate / 100)
  return {
    leads,
    booked,
    showed,
    sold,
    revenue: sold * dealValue,
    bookingRate,
    // What the whole funnel comes out to, lead to sale.
    leadToSale: (bookingRate / 100) * (showRate / 100) * (closeRate / 100) * 100,
  }
}

// A field can cap its slider below what the box accepts. Deal value stops the
// track at $25k so the range most people live in gets real travel, while
// someone with a $60k deal can still type it.
export const trackMax = (limits) => limits.sliderMax ?? limits.max

const STEPS = { leads: 100, dealValue: 500, bookingRate: 1, showRate: 1, closeRate: 1 }

/**
 * The range input drives the real value directly: linear, native min/max/step,
 * no position mapping.
 *
 * Mapping a 0-1000 position onto a value and then snapping that value to a
 * step deadlocks a controlled input. One arrow press moves the position by
 * less than a step, the value rounds back to where it was, React re-derives
 * the position from the unchanged value, and the thumb never moves.
 *
 * The base is the field minimum when the range divides evenly by the step, so
 * every stop is a legal value. When it does not divide (leads start at 1, step
 * by 100) the base drops to zero and the handler clamps up, which costs a dead
 * zone below the first step and nothing else.
 */
export function sliderSpec(key, limits) {
  const step = STEPS[key]
  const max = trackMax(limits)
  const min = (max - limits.min) % step === 0 ? limits.min : 0
  return { min, max, step }
}

export function clampToField(value, limits) {
  return clamp(value, limits.min, limits.max)
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max)
}
