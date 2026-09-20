import { money, pct, liftPct, qty, count } from '../lib/format'
import { SOURCES, BOOKING_CEILING } from '../lib/calc'

export default function Result({ result, isOptimal, target }) {
  if (isOptimal) return <Optimal />
  if (result.aboveCeiling) return <AboveCeiling bookingRate={result.now.bookingRate} />

  const { now, improved } = result

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
            Booking rate held at {BOOKING_CEILING}%. Nobody books more of their raw leads than that.
          </span>
        )}
      </section>

      <section className="card">
        <h2>Your funnel, both ways</h2>
        <table className="funnel">
          <thead>
            <tr>
              <th />
              <th>Now</th>
              <th className="is-improved">{target.replace('inside ', 'In ').replace(' minutes', ' min').replace(' minute', ' min')}</th>
            </tr>
          </thead>
          <tbody>
            <FunnelRow label="Leads" now={count(now.leads)} improved={count(improved.leads)} />
            <FunnelRow
              label={`Booked (${pct(now.bookingRate)} → ${pct(improved.bookingRate)})`}
              now={qty(now.booked)}
              improved={qty(improved.booked)}
            />
            <FunnelRow label="Showed up" now={qty(now.showed)} improved={qty(improved.showed)} />
            <FunnelRow label="Bought" now={qty(now.sold)} improved={qty(improved.sold)} />
            <FunnelRow
              total
              label="Revenue"
              now={money(now.revenue)}
              improved={money(improved.revenue)}
            />
          </tbody>
        </table>

        <hr className="rule" />

        <p className="fine">
          Only the booking rate moves. Your show rate and your close rate stay exactly where you set
          them, because none of the studies below claim a rep closes better for having called
          sooner. They measure whether you reach the lead at all.
        </p>
        <p className="fine" style={{ marginTop: 10 }}>
          The lift is applied to your odds of booking rather than to the rate itself, which is what
          "21x more likely to qualify" actually means, and it stops at a {BOOKING_CEILING}% booking
          rate. Lead to sale goes from {pct(now.leadToSale)} to {pct(improved.leadToSale)}, a{' '}
          {liftPct(result.effectiveMultiplier)} move on bookings. Every figure is rounded down.
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

function FunnelRow({ label, now, improved, total }) {
  return (
    <tr className={total ? 'is-total' : undefined}>
      <td>{label}</td>
      <td>{now}</td>
      <td className="is-improved">{improved}</td>
    </tr>
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
          When speed is already handled, the leak moves down the funnel: people booking and not
          showing, or showing and not buying. Those are different problems with different fixes.
        </p>
        <p className="fine">
          Tell me what yours looks like and I will tell you where I would look first.
        </p>
      </section>

      <Sources />
    </>
  )
}

function AboveCeiling({ bookingRate }) {
  return (
    <>
      <section className="card card--accent">
        <p className="result__caption">No number for you</p>
        <p className="result__amount">&mdash;</p>
        <p className="result__annual">
          You already book {pct(bookingRate)} of your leads. This tool will not project past{' '}
          {BOOKING_CEILING}%, so anything it told you here would be made up.
        </p>
      </section>

      <section className="card">
        <h2>Worth a sanity check</h2>
        <p className="lede" style={{ fontSize: 16 }}>
          A booking rate that high usually means the number being counted is not raw inbound leads.
          If it really is, speed is not your constraint and lead volume probably is.
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
