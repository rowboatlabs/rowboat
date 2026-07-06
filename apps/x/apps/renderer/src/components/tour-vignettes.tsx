import { useEffect } from 'react'

export type MascotVignetteKind = 'email' | 'meetings' | 'brain'
export type TourVignetteKind = MascotVignetteKind | 'agents'

/**
 * Little looping "shows" staged around the mascot while it presents a section
 * during the product tour. Purely decorative: everything is pointer-events-none
 * and rendered on the tour's own layers, never inside the section's real UI.
 */
export function MascotVignette({ kind, playDing }: { kind: MascotVignetteKind; playDing?: () => void }) {
  // One round of dings as the first envelopes land, then let the loop run silent
  useEffect(() => {
    if (kind !== 'email' || !playDing) return
    const timers = [900, 1900, 2900].map((ms) => setTimeout(playDing, ms))
    return () => timers.forEach(clearTimeout)
  }, [kind, playDing])

  return (
    <div className="pointer-events-none absolute left-1/2 top-0 z-0 -translate-x-1/2" aria-hidden="true">
      <style>{`
        @keyframes tour-env-left {
          0% { opacity: 0; transform: translate(-150px, -130px) rotate(-26deg); }
          10% { opacity: 1; }
          52% { opacity: 1; transform: translate(0px, 0px) rotate(5deg); }
          64% { opacity: 0; transform: translate(2px, 12px) rotate(5deg); }
          100% { opacity: 0; transform: translate(2px, 12px) rotate(5deg); }
        }
        @keyframes tour-env-right {
          0% { opacity: 0; transform: translate(150px, -140px) rotate(26deg); }
          10% { opacity: 1; }
          52% { opacity: 1; transform: translate(0px, 0px) rotate(-5deg); }
          64% { opacity: 0; transform: translate(-2px, 12px) rotate(-5deg); }
          100% { opacity: 0; transform: translate(-2px, 12px) rotate(-5deg); }
        }
        @keyframes tour-badge-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
        @keyframes tour-note-line {
          0% { width: 0; }
          18% { width: var(--w); }
          80% { width: var(--w); opacity: 1; }
          92%, 100% { width: var(--w); opacity: 0; }
        }
        @keyframes tour-quill-bob {
          0% { transform: translate(4px, 26px) rotate(-8deg); }
          25% { transform: translate(46px, 30px) rotate(4deg); }
          50% { transform: translate(6px, 40px) rotate(-8deg); }
          75% { transform: translate(48px, 44px) rotate(4deg); }
          100% { transform: translate(4px, 26px) rotate(-8deg); }
        }
        @keyframes tour-voice-bar {
          0%, 100% { transform: scaleY(0.35); }
          50% { transform: scaleY(1); }
        }
        @keyframes tour-orb {
          0% { opacity: 0; transform: translate(var(--from-x), var(--from-y)) scale(0.5); }
          15% { opacity: 0.9; }
          70% { opacity: 0.9; transform: translate(0, 0) scale(1); }
          85%, 100% { opacity: 0; transform: translate(0, 6px) scale(0.3); }
        }
        @keyframes tour-node-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        @keyframes tour-edge-draw {
          from { stroke-dashoffset: 60; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      {kind === 'email' && (
        <div className="relative" style={{ width: 240, height: 150 }}>
          {[
            { anim: 'tour-env-left', delay: 0, x: 78, y: 96 },
            { anim: 'tour-env-right', delay: 1.0, x: 128, y: 102 },
            { anim: 'tour-env-left', delay: 2.0, x: 104, y: 92 },
            { anim: 'tour-env-right', delay: 3.0, x: 90, y: 104 },
          ].map((e, i) => (
            <div
              key={i}
              className="absolute"
              style={{ left: e.x, top: e.y, animation: `${e.anim} 4s ease-in-out ${e.delay}s infinite both` }}
            >
              <svg width="34" height="24" viewBox="0 0 34 24">
                <rect x="1.5" y="1.5" width="31" height="21" rx="3" fill="#FFF8E7" stroke="#17171B" strokeWidth="2.5" />
                <path d="M 2 4 L 17 14 L 32 4" fill="none" stroke="#17171B" strokeWidth="2.5" strokeLinejoin="round" />
              </svg>
            </div>
          ))}
          <div
            className="absolute"
            style={{ left: 148, top: 78, animation: 'tour-badge-pulse 2s ease-in-out infinite' }}
          >
            <svg width="22" height="22" viewBox="0 0 22 22">
              <circle cx="11" cy="11" r="9.5" fill="#3FA95C" stroke="#17171B" strokeWidth="2.5" />
              <path d="M 6.5 11.5 L 9.5 14.5 L 15.5 8" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}

      {kind === 'meetings' && (
        <div className="relative" style={{ width: 220, height: 160, top: -110 }}>
          {/* someone's talking */}
          <div className="absolute left-1/2 flex -translate-x-1/2 items-end gap-1" style={{ top: 0, height: 26 }}>
            {[0.9, 1.1, 0.7, 1.3, 0.8].map((dur, i) => (
              <div
                key={i}
                className="w-1.5 origin-bottom rounded-full bg-[#8FB6D9]"
                style={{ height: 22, animation: `tour-voice-bar ${dur}s ease-in-out ${i * 0.12}s infinite` }}
              />
            ))}
          </div>
          {/* ...and the notepad writes itself */}
          <div
            className="absolute left-1/2 rounded-md border-2 border-[#17171B] bg-[#FFFDF6] shadow-md"
            style={{ top: 36, width: 96, height: 104, transform: 'translateX(-50%) rotate(-3deg)' }}
          >
            <div className="mx-2 mt-2 h-1.5 rounded bg-[#D9534F]/70" />
            {[64, 52, 60, 44].map((w, i) => (
              <div
                key={i}
                className="ml-2 mt-3 h-1.5 rounded bg-[#9AA1AE]"
                style={{ ['--w' as string]: `${w}px`, animation: `tour-note-line 5s ease-out ${i * 1.1}s infinite both` }}
              />
            ))}
            <svg
              className="absolute left-0 top-0"
              width="26"
              height="26"
              viewBox="0 0 26 26"
              style={{ animation: 'tour-quill-bob 5s ease-in-out infinite' }}
            >
              <path d="M 4 22 L 10 12 Q 14 4 22 2 Q 18 10 12 14 Z" fill="#6B5138" stroke="#17171B" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}

      {kind === 'brain' && (
        <div className="relative" style={{ width: 260, height: 180, top: -128 }}>
          {/* constellation assembling above the head */}
          <svg className="absolute left-1/2 -translate-x-1/2" width="140" height="80" viewBox="0 0 140 80" style={{ top: 0 }}>
            {[
              'M 22 58 L 52 24',
              'M 52 24 L 88 40',
              'M 88 40 L 120 18',
              'M 88 40 L 70 66',
            ].map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="#9CCBEA"
                strokeWidth="2"
                strokeDasharray="60"
                style={{ animation: `tour-edge-draw 1.2s ease-out ${0.4 + i * 0.35}s both` }}
              />
            ))}
            {[
              [22, 58], [52, 24], [88, 40], [120, 18], [70, 66],
            ].map(([cx, cy], i) => (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={5}
                fill="#BFE0F5"
                stroke="#17171B"
                strokeWidth="2"
                style={{ animation: `tour-node-pulse 2.4s ease-in-out ${i * 0.3}s infinite` }}
              />
            ))}
          </svg>
          {/* thought-orbs drifting into the head */}
          {[
            { fx: '-120px', fy: '-30px', delay: 0 },
            { fx: '120px', fy: '-40px', delay: 1.1 },
            { fx: '-90px', fy: '50px', delay: 2.2 },
            { fx: '110px', fy: '46px', delay: 3.3 },
          ].map((o, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                left: 122,
                top: 118,
                width: 16,
                height: 16,
                background: 'radial-gradient(circle, #FFF3B8 20%, #FFD166 60%, transparent 75%)',
                ['--from-x' as string]: o.fx,
                ['--from-y' as string]: o.fy,
                animation: `tour-orb 4.4s ease-in-out ${o.delay}s infinite both`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Background-agents vignette: a fleet of tiny mascots rowing across the water
 * at the bottom of the screen while the big one takes a break.
 */
export function AgentsFleet() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[67] h-28 overflow-hidden" aria-hidden="true">
      <style>{`
        @keyframes tour-fleet-right {
          from { transform: translateX(-18vw); }
          to { transform: translateX(112vw); }
        }
        @keyframes tour-fleet-left {
          from { transform: translateX(112vw); }
          to { transform: translateX(-18vw); }
        }
        @keyframes tour-fleet-bob {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-3px) rotate(2deg); }
        }
      `}</style>
      {[
        { size: 46, bottom: 4, dur: 16, delay: 0, dir: 'tour-fleet-right' },
        { size: 34, bottom: 22, dur: 22, delay: -8, dir: 'tour-fleet-left' },
        { size: 28, bottom: 14, dur: 27, delay: -3, dir: 'tour-fleet-right' },
      ].map((b, i) => (
        <div
          key={i}
          className="absolute left-0"
          style={{ bottom: b.bottom, animation: `${b.dir} ${b.dur}s linear ${b.delay}s infinite` }}
        >
          <div style={{ animation: 'tour-fleet-bob 1.4s ease-in-out infinite', transform: b.dir === 'tour-fleet-left' ? 'scaleX(-1)' : undefined }}>
            <MiniRower size={b.size} flipped={b.dir === 'tour-fleet-left'} />
          </div>
        </div>
      ))}
    </div>
  )
}

function MiniRower({ size, flipped }: { size: number; flipped: boolean }) {
  return (
    <svg
      width={size}
      height={size * 0.75}
      viewBox="0 0 60 45"
      style={{ transform: flipped ? 'scaleX(-1)' : undefined }}
    >
      <circle cx="27" cy="13" r="10" fill="#E8E9F5" stroke="#17171B" strokeWidth="3" />
      <circle cx="23.5" cy="11.5" r="1.4" fill="#17171B" />
      <circle cx="30.5" cy="11.5" r="1.4" fill="#17171B" />
      <path d="M 23 16 Q 27 19 31 16" fill="none" stroke="#17171B" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="40" y1="14" x2="20" y2="38" stroke="#17171B" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="40" y1="14" x2="20" y2="38" stroke="#54402F" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 7 25 C 17 31 43 31 53 25 C 51 37 43 42 30 42 C 17 42 9 37 7 25 Z" fill="#54402F" stroke="#17171B" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}
