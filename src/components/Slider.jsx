import { posToValue, valueToPos, ROUNDERS } from '../lib/calc'

/**
 * A log-scale range input paired with a typed box. The slider is for feel, the
 * box is for the person who knows their average deal is exactly $4,250.
 */
export default function Slider({
  id, label, hint, limits, value, raw, onChange, error,
  format = (n) => String(n), scaleLabel = (n) => String(n),
}) {
  const pos = valueToPos(value, limits)

  return (
    <div className="field">
      <div className="field__top">
        <label className="field__label" htmlFor={`${id}-box`}>
          {label}
          {hint && <span className="field__hint">{hint}</span>}
        </label>
        <input
          id={`${id}-box`}
          className={`field__value${error ? ' is-bad' : ''}`}
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={(e) => onChange(e.target.value, 'text')}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${id}-err` : undefined}
        />
      </div>

      <input
        type="range"
        min="0"
        max="1000"
        step="1"
        value={pos}
        aria-label={label}
        aria-valuetext={format(value)}
        onChange={(e) =>
          onChange(String(posToValue(Number(e.target.value), limits, ROUNDERS[id])), 'range')
        }
      />

      <div className="scale">
        <span>{scaleLabel(limits.min)}</span>
        <span>{scaleLabel(limits.max)}</span>
      </div>

      {error && (
        <p className="msg msg--bad" id={`${id}-err`} role="status">
          {error}
        </p>
      )}
    </div>
  )
}
