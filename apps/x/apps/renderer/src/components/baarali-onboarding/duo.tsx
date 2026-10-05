import { useEffect, useState } from 'react'

// BAARALI(04/10/2026): the two marks of the sign-in page (control
// sign-in-duo.ts), here to guide the onboarding: each bubble shows « … »
// first, as someone writing, then its words. They float while waiting and
// hop when it is done; still for anyone who asks for less motion.

const BODY =
  'M450 250 H502 C574 250 612 280 612 322 C612 345 602 360 590 368 Q584 373 590 378 C612 388 626 408 626 436 C626 476 590 502 512 502 H450 C413 502 384 473 384 436 V316 C384 279 413 250 450 250 Z'

function Mark({ className, size, tile, ink, eye, feet }: { className: string; size: number; tile: string; ink: string; eye: string; feet: string }) {
  return (
    <svg className={className} viewBox="0 0 1024 1024" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="1024" height="1024" rx="230" fill={tile} />
      <g transform="translate(512 512) scale(1.7) translate(-505 -423)">
        <g className="bd-body">
          <path d={BODY} fill={ink} />
          <g className="bd-lids">
            <circle cx="500" cy="324" r="12" fill={eye} />
            <circle cx="554" cy="324" r="12" fill={eye} />
          </g>
        </g>
        <circle cx="460" cy="556" r="38" fill={feet} />
        <circle cx="552" cy="556" r="38" fill={feet} />
      </g>
    </svg>
  )
}

const CSS = `
.bd-stage{position:relative;height:150px}
.bd-duo{position:absolute;left:50%;bottom:4px;transform:translateX(-50%);display:flex;align-items:flex-end}
.bd-duo svg{display:block;overflow:visible}
.bd-duo .bd-2{margin-left:-14px;margin-bottom:-4px}
.bd-lids,.bd-body{transform-box:fill-box}
.bd-lids{transform-origin:50% 50%;animation:bd-blink 5.2s infinite}
.bd-2 .bd-lids{animation-delay:1.3s}
.bd-body{transform-origin:50% 100%}
.bd-bob .bd-1 .bd-body{animation:bd-bob 2.4s ease-in-out infinite}
.bd-bob .bd-2 .bd-body{animation:bd-bob 2.4s ease-in-out .5s infinite}
.bd-hop .bd-body{animation:bd-hop 1.8s cubic-bezier(.3,.7,.3,1) 2}
.bd-hop .bd-2 .bd-body{animation-delay:.25s}
@keyframes bd-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
@keyframes bd-bob{50%{transform:translateY(-14px)}}
@keyframes bd-hop{0%,55%,100%{transform:translateY(0)}25%{transform:translateY(-70px)}}
.bd-bubble{position:absolute;width:max-content;max-width:170px;font-size:13px;line-height:1.35;padding:7px 11px;border-radius:12px;opacity:0;transform:translateY(6px) scale(.96);transition:opacity .2s,transform .2s}
.bd-bubble.bd-on{opacity:1;transform:none}
.bd-l{right:calc(50% + 34px);top:20px;border-bottom-right-radius:4px}
.bd-r{left:calc(50% + 34px);top:2px;border-bottom-left-radius:4px}
.bd-dots{display:inline-flex;gap:3px;padding:3px 0}
.bd-dots i{width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.4;animation:bd-dot 1s infinite}
.bd-dots i:nth-child(2){animation-delay:.15s}.bd-dots i:nth-child(3){animation-delay:.3s}
@keyframes bd-dot{40%{opacity:1;transform:translateY(-2px)}}
@media (prefers-reduced-motion: reduce){.bd-lids,.bd-body,.bd-dots i{animation:none!important}.bd-bubble{transition:none}}
`

/** One bubble: « … » for a moment, then the words; `null` keeps it typing. Keyed by its words, so new words start over. */
function Bubble({ side, text, delay }: { side: 'l' | 'r'; text: string | null; delay: number }) {
  const [shown, setShown] = useState<'off' | 'typing' | 'text'>('off')
  useEffect(() => {
    const typing = window.setTimeout(() => setShown('typing'), delay)
    const words = text === null ? null : window.setTimeout(() => setShown('text'), delay + 650)
    return () => {
      window.clearTimeout(typing)
      if (words !== null) window.clearTimeout(words)
    }
  }, [text, delay])
  return (
    <div className={`bd-bubble bd-${side} border bg-popover text-popover-foreground shadow-sm${shown === 'off' ? '' : ' bd-on'}`} aria-live="polite">
      {shown === 'text' ? text : <span className="bd-dots" aria-label="…"><i /><i /><i /></span>}
    </div>
  )
}

export function Duo({ first, second, motion }: { first: string; second: string | null; motion: 'bob' | 'hop' }) {
  return (
    <div className="bd-stage">
      <style>{CSS}</style>
      <Bubble key={`l:${first}`} side="l" text={first} delay={300} />
      <Bubble key={`r:${second ?? ''}`} side="r" text={second} delay={1200} />
      <div className={`bd-duo bd-${motion}`}>
        <Mark className="bd-1" size={86} tile="#1A6DFF" ink="#FFFFFF" eye="#0A0A0A" feet="#FFFFFF" />
        <Mark className="bd-2" size={70} tile="#0A0A0A" ink="#FFFFFF" eye="#1A6DFF" feet="#1A6DFF" />
      </div>
    </div>
  )
}
