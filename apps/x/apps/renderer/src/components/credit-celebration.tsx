"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Sparkles } from "lucide-react"
import { formatCreditsAsDollars, type CreditActivatedEvent } from "@x/shared/dist/credits.js"

// Deterministic pseudo-random confetti geometry — stable per piece index so a
// re-render mid-animation doesn't reshuffle the burst.
function confettiPieces(seed: number) {
  const COLORS = ["#f59e0b", "#10b981", "#3b82f6", "#ec4899", "#8b5cf6", "#ef4444"]
  return Array.from({ length: 28 }, (_, i) => {
    const t = Math.sin(seed * 997 + i * 131) * 0.5 + 0.5
    const u = Math.sin(seed * 613 + i * 379) * 0.5 + 0.5
    const angle = (i / 28) * Math.PI * 2
    const distance = 90 + t * 140
    return {
      id: i,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance * 0.75 - 40 - u * 60,
      rotate: (t - 0.5) * 720,
      color: COLORS[i % COLORS.length],
      size: 5 + u * 5,
      round: i % 3 === 0,
      delay: t * 0.12,
    }
  })
}

/**
 * Full-window celebration shown when the backend confirms a first-time-action
 * credit grant (`credits:didActivate`): a confetti burst plus a card naming
 * the action and the amount earned. Mount once near the app root.
 */
export function CreditCelebration() {
  const [event, setEvent] = useState<CreditActivatedEvent | null>(null)
  const [burst, setBurst] = useState(0)

  useEffect(() => {
    return window.ipc.on("credits:didActivate", (e) => {
      setEvent(e)
      setBurst((n) => n + 1)
    })
  }, [])

  useEffect(() => {
    if (!event) return
    const timer = window.setTimeout(() => setEvent(null), 4500)
    return () => window.clearTimeout(timer)
  }, [event])

  const pieces = useMemo(() => confettiPieces(burst), [burst])

  return (
    <AnimatePresence>
      {event && (
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center">
          {/* confetti burst */}
          <div className="absolute left-1/2 top-1/2">
            {pieces.map((p) => (
              <motion.span
                key={`${burst}-${p.id}`}
                className="absolute block"
                style={{
                  width: p.size,
                  height: p.size * (p.round ? 1 : 0.6),
                  backgroundColor: p.color,
                  borderRadius: p.round ? "9999px" : "1px",
                }}
                initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
                animate={{
                  x: p.x,
                  y: [0, p.y, p.y + 260],
                  opacity: [1, 1, 0],
                  rotate: p.rotate,
                  scale: 1,
                }}
                transition={{ duration: 2.2, delay: p.delay, ease: "easeOut", times: [0, 0.35, 1] }}
              />
            ))}
          </div>

          {/* reward card */}
          <motion.div
            initial={{ scale: 0.7, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: -12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            className="relative flex items-center gap-3 rounded-2xl border bg-background/95 px-5 py-4 shadow-2xl backdrop-blur"
          >
            <motion.div
              className="flex size-10 items-center justify-center rounded-full bg-amber-500/15"
              animate={{ rotate: [0, -12, 12, 0] }}
              transition={{ duration: 0.9, delay: 0.15 }}
            >
              <Sparkles className="size-5 text-amber-500" />
            </motion.div>
            <div>
              <p className="text-sm font-semibold">
                {formatCreditsAsDollars(event.credits)} in credits earned!
              </p>
              <p className="text-xs text-muted-foreground">{event.title}</p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
