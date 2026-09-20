import { useMemo, useState } from 'react'
import Slider from './components/Slider'
import ConfidenceSlider from './components/ConfidenceSlider'
import Result from './components/Result'
import LeadForm from './components/LeadForm'
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

  function pickBand(id) {
    setBand(id)
    setConfidence(defaultConfidence(id))
  }

  const fields = [
    { id: 'leads', label: 'Leads per month', state: leads, set: setLeads, fmt: count },
    { id: 'dealValue', label: 'Average deal value', state: dealValue, set: setDealValue, fmt: money },
    {
      id: 'bookingRate',
      label: 'Leads that book',
      hint: 'Of every 100 leads, how many end up on the calendar?',
      state: bookingRate, set: setBookingRate, fmt: asPct,
    },
    {
      id: 'showRate',
      label: 'Bookings that show',
      hint: 'Of those appointments, how many actually turn up?',
      state: showRate, set: setShowRate, fmt: asPct,
    },
    {
      id: 'closeRate',
      label: 'Shows that buy',
      hint: 'Of the people who turn up, how many become customers?',
      state: closeRate, set: setCloseRate, fmt: asPct,
    },
  ]

  return (
    <div className="wrap">
      <p className="eyebrow">Response time / revenue leak</p>
      <h1>What answering slowly costs you every month</h1>
      <p className="lede">
        Set your funnel. You get the number, the math behind it, and the studies it came from. No
        email needed to see the result.
      </p>

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
            format={f.fmt}
            scaleLabel={f.fmt}
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

      <LeadForm
        payload={{
          leads_per_month: n.leads,
          deal_value: n.dealValue,
          booking_rate: n.bookingRate,
          show_rate: n.showRate,
          close_rate: n.closeRate,
          response_time_band: band,
          response_time_label: BANDS.find((b) => b.id === band)?.label,
          study_confidence: confidence,
          calculated_leak_monthly: isOptimal || !result ? 0 : result.leakMonthly,
        }}
      />

      <p className="foot">
        If you are looking for help building systems that make your sales process easier, get in
        touch at <a href="https://jtylerray.com/card">jtylerray.com/card</a>.
      </p>
    </div>
  )
}
