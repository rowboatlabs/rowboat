import { useEffect, useState } from 'react'

/**
 * Screen-pointer overlay (window hash #screen-pointer): a transparent,
 * click-through window covering the shared display, on which the assistant's
 * pointer is drawn — a laser-dot with ping rings and an optional label.
 * Driven entirely by main over the screen-pointer:state push channel
 * (replayed on load); the window exists only while something is pointed at.
 */

type PointerState = {
  visible: boolean
  x: number
  y: number
  label: string | null
  nonce: number
}

export function ScreenPointerOverlay() {
  const [state, setState] = useState<PointerState | null>(null)

  // Transparent window: clear every background layer — any paint here is a
  // permanent smudge over the user's real screen.
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
  }, [])

  useEffect(() => {
    // Subscribe FIRST, then pull: main's did-finish-load push can fire
    // before this effect runs (the popout had the same race — a missed
    // push here is an invisible pointer). The nonce guard keeps a stale
    // pulled state from clobbering a fresher pushed one.
    const off = window.ipc.on('screen-pointer:state', (s) =>
      setState((prev) => (prev && prev.nonce > s.nonce ? prev : s)),
    )
    void window.ipc
      .invoke('screenPointer:getState', null)
      .then(({ state: s }) => {
        if (s) setState((prev) => (prev && prev.nonce >= s.nonce ? prev : s))
      })
      .catch((err) => console.warn('[screen-pointer] getState failed:', err))
    return off
  }, [])

  if (!state?.visible) return null

  // Flip the label to the dot's other side near the right edge so it stays
  // on screen; clamp isn't needed vertically (the chip is dot-centered).
  const labelOnLeft = state.x > 0.62

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none select-none">
      <style>{`
        @keyframes sp-ping {
          0% { transform: scale(0.5); opacity: 0.9; }
          100% { transform: scale(2.6); opacity: 0; }
        }
        @keyframes sp-pop {
          0% { transform: scale(0); }
          60% { transform: scale(1.35); }
          100% { transform: scale(1); }
        }
        @keyframes sp-label-in {
          0% { opacity: 0; transform: translateY(-50%) scale(0.9); }
          100% { opacity: 1; transform: translateY(-50%) scale(1); }
        }
      `}</style>
      {/* key={nonce}: pointing again — even at the same spot — restarts the
          pop/ping so the user's eye is drawn there each time. */}
      <div
        key={state.nonce}
        className="absolute"
        style={{ left: `${state.x * 100}%`, top: `${state.y * 100}%` }}
      >
        {[0, 0.5].map((delay) => (
          <span
            key={delay}
            className="absolute rounded-full"
            style={{
              width: 44,
              height: 44,
              left: -22,
              top: -22,
              border: '3px solid rgba(239, 68, 68, 0.85)',
              boxShadow: '0 0 6px rgba(239, 68, 68, 0.5)',
              animation: `sp-ping 1.6s cubic-bezier(0, 0, 0.2, 1) ${delay}s infinite`,
            }}
          />
        ))}
        <span
          className="absolute rounded-full"
          style={{
            width: 16,
            height: 16,
            left: -8,
            top: -8,
            background: '#ef4444',
            border: '2.5px solid #ffffff',
            boxShadow: '0 0 10px rgba(239, 68, 68, 0.9), 0 1px 4px rgba(0, 0, 0, 0.45)',
            animation: 'sp-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />
        {state.label ? (
          <span
            className="absolute whitespace-nowrap rounded-full"
            style={{
              top: 0,
              ...(labelOnLeft ? { right: 22 } : { left: 22 }),
              transform: 'translateY(-50%)',
              maxWidth: 320,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              padding: '5px 12px',
              background: 'rgba(23, 23, 23, 0.92)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 500,
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.4)',
              animation: 'sp-label-in 0.25s ease-out',
            }}
          >
            {state.label}
          </span>
        ) : null}
      </div>
    </div>
  )
}
