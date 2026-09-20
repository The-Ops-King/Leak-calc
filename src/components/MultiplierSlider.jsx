import { liftPct } from '../lib/format'

/**
 * Lets the visitor set the lift themselves. The default sits at the
 * conservative figure; the top of the track is the Velocify 391% number scaled
 * to their band. Nobody has to take our word for the multiplier.
 */
export default function MultiplierSlider({ value, base, max, disabled, onChange, basis, target }) {
  const min = 1
  const basePos = max > min ? ((base - min) / (max - min)) * 100 : 0
  const isDefault = Math.abs(value - base) < 0.005

  return (
    <div className="field">
      <div className="field__top">
        <label className="field__label" htmlFor="mult-range">
          How much better would you close answering {target}?
          <span className="field__hint">
            {disabled
              ? 'Locked. You are already answering inside a minute.'
              : 'Starts on the conservative number. Drag it wherever you actually believe.'}
          </span>
        </label>
        <span className="field__value" style={{ border: 'none', background: 'none' }}>
          {liftPct(value)}
        </span>
      </div>

      <input
        id="mult-range"
        type="range"
        min={min}
        max={max}
        step="0.01"
        value={value}
        disabled={disabled}
        aria-valuetext={`${liftPct(value)} more sales from the same leads`}
        onChange={(e) => onChange(Number(e.target.value))}
      />

      <div className="scale">
        <span>no change</span>
        {!disabled && basePos > 12 && basePos < 88 && (
          <span style={{ color: isDefault ? 'var(--accent-text)' : 'var(--grey-dim)' }}>
            {liftPct(base)} our number
          </span>
        )}
        <span>{liftPct(max)} research high</span>
      </div>

      <p className="fine" style={{ marginTop: 10 }}>{basis}</p>
    </div>
  )
}
