import { useEffect, useRef, useState } from 'react'

const PHOTO = '/tyler.jpg'
const CARD = 'https://jtylerray.com/card'

/**
 * Shown once, straight after the form succeeds, while the visitor is still
 * looking at something they just asked for. Dismissing it reveals their number,
 * so it is a pause rather than a toll: nothing is withheld if they ignore it.
 *
 * Falls back to a monogram when the photo is missing, so a missing file is a
 * plainer modal rather than a broken image.
 */
export default function OfferModal({ onClose }) {
  const dialog = useRef(null)
  const [photoOk, setPhotoOk] = useState(true)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    dialog.current?.focus()

    // The page behind a modal should not scroll under it on a phone.
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    function onKey(e) {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return

      // Keep Tab inside the dialog; without this the first Tab lands on browser
      // chrome and a keyboard user is stranded outside a modal they cannot see.
      const focusable = dialog.current?.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [onClose])

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offer-title"
        tabIndex={-1}
        ref={dialog}
      >
        {photoOk ? (
          <img
            className="modal__photo"
            src={PHOTO}
            alt="J. Tyler Ray"
            width="96"
            height="96"
            onError={() => setPhotoOk(false)}
          />
        ) : (
          <div className="modal__photo modal__photo--fallback" aria-hidden="true">
            JTR
          </div>
        )}

        <p className="modal__name">J. Tyler Ray</p>

        <h2 id="offer-title" className="modal__title">
          If you are looking for someone to help you identify leaks in your high ticket coaching
          business, <a href={CARD} target="_blank" rel="noopener noreferrer">reach out here</a>.
        </h2>

        <button className="btn" type="button" onClick={onClose}>
          Continue to calculator
        </button>
      </div>
    </div>
  )
}
