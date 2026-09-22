import { useState } from 'react'
import { JOB_ROLES } from '../lib/calc'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const OTHER = 'Something else'

/**
 * The gate. Nothing below the inputs renders until this succeeds, so the copy
 * has to be worth the trade: they are handing over an address before they have
 * seen anything. Saying plainly that the number appears on submit is the whole
 * pitch.
 */
export default function LeadForm({ onUnlock }) {
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('')
  const [roleOther, setRoleOther] = useState('')
  const [trap, setTrap] = useState('') // honeypot; name avoids every autofill token
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const [openedAt] = useState(() => Date.now())

  const resolvedRole = role === OTHER ? roleOther.trim() : role

  async function submit(e) {
    e.preventDefault()
    setError('')

    if (!firstName.trim()) return setError('First name, please.')
    if (!EMAIL.test(email.trim())) return setError('That email address will not reach you.')
    if (!role) return setError('Pick the closest thing to what you do.')
    if (role === OTHER && !roleOther.trim()) return setError('Tell me what you do and I will send it over.')

    setState('sending')
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase: 'capture',
          firstName: firstName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          job_role: resolvedRole,
          lc_ref: trap, // must stay empty
          elapsedMs: Date.now() - openedAt,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Something went wrong on our end.')
      // rowRange lets the later update rewrite this visitor's row instead of
      // appending a second one.
      onUnlock({ email: email.trim().toLowerCase(), rowRange: body.rowRange || null })
    } catch (err) {
      setState('idle')
      setError(err.message)
    }
  }

  return (
    <section className="card card--accent">
      <p className="result__caption">Takes about thirty seconds</p>
      <h2 style={{ fontSize: 22, marginTop: 6 }}>Open the calculator</h2>
      <p className="lede" style={{ fontSize: 16, marginBottom: 18 }}>
        Five numbers about your funnel and how fast you answer a lead, and you will see what the
        delay costs you every month, with the math and the studies behind it.
      </p>

      <form onSubmit={submit} noValidate>
        <div className="form__grid">
          <div className="form__grid form__grid--two">
            <input
              className="input"
              placeholder="First name"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <input
              className="input"
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <select
            className={`input${role ? '' : ' is-placeholder'}`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="What do you do?"
          >
            <option value="" disabled>
              What do you do?
            </option>
            {JOB_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          {role === OTHER && (
            <input
              className="input"
              placeholder="What do you do?"
              value={roleOther}
              onChange={(e) => setRoleOther(e.target.value)}
              maxLength={60}
            />
          )}

          <input
            className="input"
            type="tel"
            placeholder="Phone (optional)"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <div className="hp" aria-hidden="true">
            <label htmlFor="lc-ref">Leave this field empty</label>
            <input
              id="lc-ref"
              name="lc_ref"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={trap}
              onChange={(e) => setTrap(e.target.value)}
            />
          </div>

          <button className="btn" type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? 'One second' : 'Open the calculator'}
          </button>
        </div>
      </form>

      {error && (
        <p className="msg msg--bad" role="alert">
          {error}
        </p>
      )}

      <p className="fine" style={{ marginTop: 14 }}>
        One email with your breakdown once you have run the numbers. No list, no sequence, no
        sharing your address with anyone.
      </p>
    </section>
  )
}
