import { sliderSpec, clampToField, trackMax } from '../lib/calc'

/**
 * A range input paired with a typed box. The slider is for feel, the box is for
 * the person who knows their average deal is exactly $4,250. The suffix sits
 * beside the input rather than inside its value, so the caret never has to
 * step over it.
 */
export default function Slider({
  id, label, hint, limits, value, raw, onChange, error, suffix,
  format = (n) => String(n), scaleLabel = (n) => String(n),
}) {
  const spec = sliderSpec(id, limits)

  return (
    <div className="field">
      <div className="field__top">
        <label className="field__label" htmlFor={`${id}-box`}>
          {label}
          {hint && <span className="field__hint">{hint}</span>}
        </label>

        <div className={`field__box${error ? ' is-bad' : ''}`}>
          <input
            id={`${id}-box`}
            className="field__input"
            type="text"
            inputMode="decimal"
            value={raw}
            onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${id}-err` : undefined}
          />
          {suffix && <span className="field__suffix">{suffix}</span>}
        </div>
      </div>

      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={Math.min(Math.max(value, spec.min), spec.max)}
        aria-label={label}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(String(clampToField(Number(e.target.value), limits)))}
      />

      <div className="scale">
        <span>{scaleLabel(limits.min)}</span>
        <span>{scaleLabel(trackMax(limits))}</span>
      </div>

      {error && (
        <p className="msg msg--bad" id={`${id}-err`} role="status">
          {error}
        </p>
      )}
    </div>
  )
}
