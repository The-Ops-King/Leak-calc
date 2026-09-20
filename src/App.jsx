import { useMemo, useState } from 'react'
import Slider from './components/Slider'
import MultiplierSlider from './components/MultiplierSlider'
import Result from './components/Result'
import LeadForm from './components/LeadForm'
import {
  BANDS, LIMITS, ROUNDERS,
  computeLeak, defaultMultiplier, researchMax, basisFor, validateField,
} from './lib/calc'
import { money, count } from './lib/format'

export default function App() {
  const [leads, setLeads] = useState(String(LIMITS.leads.default))
  const [dealValue, setDealValue] = useState(String(LIMITS.dealValue.default))
  const [closeRate, setCloseRate] = useState(String(LIMITS.closeRate.default))
  const [band, setBand] = useState('same_day')
  const [multiplier, setMultiplier] = useState(() => defaultMultiplier('same_day'))

  const errors = {
    leads: validateField('leads', leads),
    dealValue: validateField('dealValue', dealValue),
    closeRate: validateField('closeRate', closeRate),
  }
  const firstError = errors.leads || errors.dealValue || errors.closeRate
  const isOptimal = band === 'under_1_min'
  const target = band === '1_to_5_min' ? 'inside 1 minute' : 'inside 5 minutes'

  const n = {
    leads: Number(leads),
    dealValue: Number(dealValue),
    closeRate: Number(closeRate),
  }

  const result = useMemo(
    () => (firstError ? null : computeLeak({ ...n, multiplier })),
    [firstError, n.leads, n.dealValue, n.closeRate, multiplier],
  )

  function pickBand(id) {
    setBand(id)
    setMultiplier(defaultMultiplier(id))
  }

  return (
    <div className="wrap">
      <p className="eyebrow">Response time / revenue leak</p>
      <h1>What answering slowly costs you every month</h1>
      <p className="lede">
        Move four sliders. You get the number, the math behind it, and the studies it came from. No
        email needed to see the result.
      </p>

      <section className="card">
        <Slider
          id="leads"
          label="Leads per month"
          limits={LIMITS.leads}
          value={n.leads || LIMITS.leads.default}
          raw={leads}
          onChange={setLeads}
          error={errors.leads}
          format={count}
          scaleLabel={count}
        />

        <Slider
          id="dealValue"
          label="Average deal value"
          limits={LIMITS.dealValue}
          value={n.dealValue || LIMITS.dealValue.default}
          raw={dealValue}
          onChange={setDealValue}
          error={errors.dealValue}
          format={money}
          scaleLabel={money}
        />

        <Slider
          id="closeRate"
          label="Close rate, lead to sale"
          hint="Most businesses land between 2% and 10%."
          limits={LIMITS.closeRate}
          value={n.closeRate || LIMITS.closeRate.default}
          raw={closeRate}
          onChange={setCloseRate}
          error={errors.closeRate}
          format={(v) => `${v}%`}
          scaleLabel={(v) => `${v}%`}
        />

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
          <MultiplierSlider
            value={multiplier}
            base={defaultMultiplier(band)}
            max={researchMax(band)}
            disabled={false}
            onChange={setMultiplier}
            basis={basisFor(band)}
            target={target}
          />
        </section>
      )}

      {firstError ? (
        <section className="card">
          <h2>Cannot run that one</h2>
          <p className="fine">{firstError}</p>
        </section>
      ) : (
        <Result
          result={result}
          leads={n.leads}
          closeRate={n.closeRate}
          multiplier={multiplier}
          isOptimal={isOptimal}
          target={target}
        />
      )}

      <LeadForm
        payload={{
          leads_per_month: n.leads,
          deal_value: n.dealValue,
          close_rate: n.closeRate,
          response_time_band: band,
          response_time_label: BANDS.find((b) => b.id === band)?.label,
          multiplier_used: Number(multiplier.toFixed(2)),
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
