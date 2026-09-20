import { money, count, pct, liftPct } from '../lib/format'
import { SOURCES, CEILING } from '../lib/calc'

export default function Result({ result, leads, closeRate, multiplier, isOptimal, target }) {
  if (isOptimal) return <Optimal />
  if (result.aboveCeiling) return <AboveCeiling closeRate={closeRate} />

  return (
    <>
      <section className="card card--accent">
        <p className="result__caption">Leaking every month</p>
        <p className="result__amount">
          {result.belowFloor ? 'Under $100' : money(result.leakMonthly)}
        </p>
        <p className="result__annual">
          {result.belowFloor ? (
            <>Your numbers are small enough that the gap rounds to nothing. That is a real answer.</>
          ) : (
            <>
              That is <b>{money(result.leakAnnual)}</b> a year, at your current lead volume.
            </>
          )}
        </p>
        {result.ceilingBinding && (
          <span className="flag">
            Capped at a {CEILING}% close rate. Dragging further stops moving the number.
          </span>
        )}
      </section>

      <section className="card">
        <h2>How we got there</h2>
        <dl className="working">
          <Row label="Leads per month" value={count(leads)} />
          <Row label="Close rate now" value={pct(closeRate)} />
          <Row label={`Close rate answering ${target}`} value={pct(result.improvedCloseRate)} />
          <Row label="Lift applied" value={liftPct(result.effectiveMultiplier)} />
        </dl>
        <hr className="rule" />
        <p className="fine">
          The multiplier is applied to your close rate, never to your revenue, and it stops at a{' '}
          {CEILING}% close rate. Every figure is rounded down. The comparison is against{' '}
          {target}.
          {Math.abs(multiplier - result.effectiveMultiplier) > 0.01 &&
            ' You set the lift higher than the cap allows, so the cap is what you are seeing.'}
        </p>
      </section>

      <Sources />

      <p className="fine">
        This is an estimate built on published averages. Your business is not an average. Use it to
        size the problem, not to forecast a quarter.
      </p>
    </>
  )
}

function Row({ label, value }) {
  return (
    <div className="working__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function Optimal() {
  return (
    <>
      <section className="card card--accent">
        <p className="result__caption">Your leak</p>
        <p className="result__amount">$0</p>
        <p className="result__annual">
          You answer faster than almost everyone in the studies below. There is no response-time
          money to recover, and we are not going to invent a number so this page feels worth your
          time.
        </p>
      </section>

      <section className="card">
        <h2>So what is actually breaking?</h2>
        <p className="lede" style={{ fontSize: 16 }}>
          When speed is already handled, the leak is usually further down: what happens on the call,
          how many times you follow up before giving up, or who you let book in the first place.
        </p>
        <p className="fine">
          Tell me what yours looks like and I will tell you where I would look first.
        </p>
      </section>

      <Sources />
    </>
  )
}

function AboveCeiling({ closeRate }) {
  return (
    <>
      <section className="card card--accent">
        <p className="result__caption">No number for you</p>
        <p className="result__amount">&mdash;</p>
        <p className="result__annual">
          You are closing {pct(closeRate)} of your leads. This tool refuses to project past a{' '}
          {CEILING}% close rate, so anything it told you here would be made up.
        </p>
      </section>

      <section className="card">
        <h2>Worth a sanity check</h2>
        <p className="lede" style={{ fontSize: 16 }}>
          A lead-to-sale rate that high usually means the number being counted is not raw inbound
          leads. If it really is, response time is not your constraint and lead volume probably is.
        </p>
      </section>

      <Sources />
    </>
  )
}

function Sources() {
  return (
    <section className="card">
      <h2>Where the numbers come from</h2>
      <ul className="sources">
        {SOURCES.map((s) => (
          <li key={s.org}>
            <b>{s.org}</b>
            {s.detail}
          </li>
        ))}
      </ul>
    </section>
  )
}
