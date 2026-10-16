export function bindPlayExit(
  element: HTMLCanvasElement,
  isPlaying: () => boolean,
  onExit: () => void,
) {
  const doc = element.ownerDocument
  const view = doc.defaultView
  let wasLocked = false

  const exit = () => {
    wasLocked = false
    if (isPlaying()) onExit()
  }
  const onEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || event.code === 'Escape') exit()
  }
  const onLockChange = () => {
    if (doc.pointerLockElement === element) {
      // A lock request may resolve after Escape has already left Play.
      if (!isPlaying()) doc.exitPointerLock()
      else wasLocked = true
    } else {
      exit()
    }
  }
  const checkLock = () => {
    if (!isPlaying()) {
      wasLocked = false
    } else if (doc.pointerLockElement === element) {
      wasLocked = true
    } else if (wasLocked) {
      // Recover even when the browser consumes Escape or delays its unlock event.
      exit()
    }
  }

  const escapeOptions = { capture: true }
  view?.addEventListener('keydown', onEscape, escapeOptions)
  view?.addEventListener('keyup', onEscape, escapeOptions)
  doc.addEventListener('pointerlockchange', onLockChange)
  return {
    checkLock,
    dispose() {
      view?.removeEventListener('keydown', onEscape, escapeOptions)
      view?.removeEventListener('keyup', onEscape, escapeOptions)
      doc.removeEventListener('pointerlockchange', onLockChange)
    },
  }
}
