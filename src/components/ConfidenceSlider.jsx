import { liftPct } from '../lib/format'
import { confidenceToMultiplier, researchMax, defaultConfidence } from '../lib/calc'

/**
 * Not a multiplier dial. The visitor says how much of the published research
 * they actually believe, and the lift follows. 391% is a real figure and also
 * an unbelievable one, so the honest move is to let them halve it.
 */
export default function ConfidenceSlider({ band, confidence, onChange, basis }) {
  const max = researchMax(band)
  const studyLift = liftPct(max)
  const applied = liftPct(confidenceToMultiplier(band, confidence))
  const base = defaultConfidence(band)
  const isDefault = confidence === base

  return (
    <div className="field">
      <div className="field__top">
        <label className="field__label" htmlFor="confidence">
          The research on this band points to {studyLift} more bookings. How much of that do you
          believe?
          <span className="field__hint">
            {isDefault
              ? `We open at ${base}%, well under what the study claims. Drag it anywhere.`
              : 'Drag it to zero and the leak goes to zero with it.'}
          </span>
        </label>
        <span className="field__value field__value--plain">{confidence}%</span>
      </div>

      <input
        id="confidence"
        type="range"
        min="0"
        max="100"
        step="1"
        value={confidence}
        aria-valuetext={`${confidence}% of the study, which is ${applied} more bookings`}
        onChange={(e) => onChange(Number(e.target.value))}
      />

      <div className="scale">
        <span>none of it</span>
        {base > 12 && base < 88 && (
          <span style={{ color: isDefault ? 'var(--accent-text)' : 'var(--grey-dim)' }}>
            {base}% ours
          </span>
        )}
        <span>all of it</span>
      </div>

      <p className="applied">
        Applied to your booking rate: <b>{applied}</b>
      </p>

      <p className="fine" style={{ marginTop: 10 }}>{basis}</p>
    </div>
  )
}
