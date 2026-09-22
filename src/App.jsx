import { useEffect, useMemo, useRef, useState } from 'react'
import Slider from './components/Slider'
import ConfidenceSlider from './components/ConfidenceSlider'
import Result from './components/Result'
import LeadForm from './components/LeadForm'
import OfferModal from './components/OfferModal'
import {
  BANDS, LIMITS,
  computeLeak, confidenceToMultiplier, defaultConfidence, basisFor, validateField,
} from './lib/calc'
import { money, count } from './lib/format'

const asPct = (v) => `${v}%`

export default function App() {
  const [leads, setLeads] = useState(String(LIMITS.leads.default))
  const [dealValue, setDealValue] = useState(String(LIMITS.dealValue.default))
  const [bookingRate, setBookingRate] = useState(String(LIMITS.bookingRate.default))
  const [showRate, setShowRate] = useState(String(LIMITS.showRate.default))
  const [closeRate, setCloseRate] = useState(String(LIMITS.closeRate.default))
  const [band, setBand] = useState('same_day')
  const [confidence, setConfidence] = useState(() => defaultConfidence('same_day'))

  // The gate. Held in memory only, so a refresh re-gates: nothing about this
  // visitor is stored on their device, and an upsert makes a repeat submission
  // harmless rather than a duplicate.
  const [unlocked, setUnlocked] = useState(null)
  const [sent, setSent] = useState(false)
  // Shown once on unlock. Dismissing it reveals the result underneath, so it
  // never blocks what they already paid an email for.
  const [showOffer, setShowOffer] = useState(false)

  const errors = {
    leads: validateField('leads', leads),
    dealValue: validateField('dealValue', dealValue),
    bookingRate: validateField('bookingRate', bookingRate),
    showRate: validateField('showRate', showRate),
    closeRate: validateField('closeRate', closeRate),
  }
  const firstError = Object.values(errors).find(Boolean)
  const isOptimal = band === 'under_1_min'
  const target = band === '1_to_5_min' ? 'inside 1 minute' : 'inside 5 minutes'

  const n = {
    leads: Number(leads),
    dealValue: Number(dealValue),
    bookingRate: Number(bookingRate),
    showRate: Number(showRate),
    closeRate: Number(closeRate),
  }

  const multiplier = confidenceToMultiplier(band, confidence)

  const result = useMemo(
    () => (firstError ? null : computeLeak({ ...n, multiplier })),
    [firstError, n.leads, n.dealValue, n.bookingRate, n.showRate, n.closeRate, multiplier],
  )

  // Phase two. The form created the contact with no funnel, because defaults
  // are not answers. Once they actually change something, the same contact is
  // upserted with their real numbers and their sheet row is rewritten in
  // place. Debounced, so dragging a slider is one write and not forty.
  const touched = useRef(false)
  const rowRange = useRef(null)
  const firstUpdate = useRef(true)

  const funnelKey = [n.leads, n.dealValue, n.bookingRate, n.showRate, n.closeRate, band, confidence].join('|')
  const initialKey = useRef(funnelKey)

  useEffect(() => {
    if (!unlocked || firstError) return
    if (funnelKey === initialKey.current && !touched.current) return
    touched.current = true

    const timer = setTimeout(() => {
      const wasFirst = firstUpdate.current
      firstUpdate.current = false

      fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase: 'update',
          email: unlocked.email,
          rowRange: rowRange.current ?? unlocked.rowRange,
          sendEmail: wasFirst,
          leads_per_month: n.leads,
          deal_value: n.dealValue,
          booking_rate: n.bookingRate,
          show_rate: n.showRate,
          close_rate: n.closeRate,
          response_time_band: band,
          study_confidence: confidence,
          calculated_leak_monthly: isOptimal || !result ? 0 : result.leakMonthly,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (!body) return
          if (body.rowRange) rowRange.current = body.rowRange
          if (body.emailed) setSent(true)
        })
        // A failed background save must never interrupt someone reading their
        // number. The server alerts on it; the visitor does not need to know.
        .catch(() => {})
    }, 2500)

    return () => clearTimeout(timer)
  }, [unlocked, firstError, funnelKey])

  function pickBand(id) {
    setBand(id)
    setConfidence(defaultConfidence(id))
  }

  const fields = [
    { id: 'leads', label: 'Leads per month', state: leads, set: setLeads, fmt: count },
    {
      id: 'dealValue', label: 'Average deal value', state: dealValue, set: setDealValue,
      fmt: money, suffix: null,
      scaleLabel: (v) => (v === LIMITS.dealValue.sliderMax ? `${money(v)}+` : money(v)),
    },
    {
      id: 'bookingRate',
      label: 'Lead > Book %',
      hint: 'Of every 100 leads, how many end up on the calendar?',
      state: bookingRate, set: setBookingRate, fmt: asPct, suffix: '%',
    },
    {
      id: 'showRate',
      label: 'Book > Show %',
      hint: 'Of those appointments, how many actually turn up?',
      state: showRate, set: setShowRate, fmt: asPct, suffix: '%',
    },
    {
      id: 'closeRate',
      label: 'Show > Close %',
      hint: 'Of the people who show, how many buy?',
      state: closeRate, set: setCloseRate, fmt: asPct, suffix: '%',
    },
  ]

  return (
    <div className="wrap">
      <p className="eyebrow">Response time / revenue leak</p>
      <h1>What answering slowly costs you every month</h1>
      <p className="lede">
        Most businesses lose more to slow replies than to bad leads. Find out what it costs you,
        with the math and the studies behind it.
      </p>

      {!unlocked ? (
        <LeadForm
          onUnlock={(u) => {
            setUnlocked(u)
            setShowOffer(true)
          }}
        />
      ) : (
        <>
          <section className="card">
            {fields.map((f) => (
              <Slider
                key={f.id}
                id={f.id}
                label={f.label}
                hint={f.hint}
                limits={LIMITS[f.id]}
                value={n[f.id] || LIMITS[f.id].default}
                raw={f.state}
                onChange={f.set}
                error={errors[f.id]}
                suffix={f.suffix}
                format={f.fmt}
                scaleLabel={f.scaleLabel || f.fmt}
              />
            ))}

            <div className="field">
              <div className="field__top">
                <label className="field__label" htmlFor="band">
                  How fast do you contact a new lead?
                </label>
              </div>
              <select id="band" value={band} onChange={(e) => pickBand(e.target.value)}>
                {BANDS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {!isOptimal && (
            <section className="card">
              <ConfidenceSlider
                band={band}
                confidence={confidence}
                onChange={setConfidence}
                basis={basisFor(band)}
              />
            </section>
          )}

          {firstError ? (
            <section className="card">
              <h2>Cannot run that one</h2>
              <p className="fine">{firstError}</p>
            </section>
          ) : (
            <Result result={result} isOptimal={isOptimal} target={target} />
          )}

          {sent && (
            <section className="card">
              <h2>Breakdown sent</h2>
              <p className="fine">
                It is on its way to {unlocked.email}. If it is not there in a few minutes, check
                promotions. The numbers above stay live if you keep adjusting them.
              </p>
            </section>
          )}
        </>
      )}

      {showOffer && <OfferModal onClose={() => setShowOffer(false)} />}

      <p className="foot">
        If you are looking for help building systems that make your sales process easier, get in
        touch at <a href="https://jtylerray.com/card">jtylerray.com/card</a>.
      </p>
    </div>
  )
}
