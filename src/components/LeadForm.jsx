import { useState } from 'react'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function LeadForm({ payload }) {
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [trap, setTrap] = useState('') // honeypot; name avoids every autofill token
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const [openedAt] = useState(() => Date.now())

  async function submit(e) {
    e.preventDefault()
    setError('')

    if (!firstName.trim()) return setError('First name, please.')
    if (!EMAIL.test(email.trim())) return setError('That email address will not reach you.')

    setState('sending')
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          lc_ref: trap, // must stay empty
          elapsedMs: Date.now() - openedAt,
          ...payload,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Something went wrong on our end.')
      setState('done')
    } catch (err) {
      setState('idle')
      setError(err.message)
    }
  }

  if (state === 'done') {
    return (
      <section className="card">
        <h2>Sent.</h2>
        <p className="fine">
          The breakdown is on its way to {email}. If it is not there in a few minutes, check
          promotions.
        </p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Want the breakdown and the three things that usually cause this?</h2>
      <p className="fine" style={{ marginBottom: 16 }}>
        Drop your email. You already have the number, so this is only worth doing if you want to
        know what to do about it.
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
            {state === 'sending' ? 'Sending' : 'Send me the breakdown'}
          </button>
        </div>
      </form>

      {error && (
        <p className="msg msg--bad" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
