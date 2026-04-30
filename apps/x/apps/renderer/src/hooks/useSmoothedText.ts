import { useEffect, useRef, useState } from 'react'

/**
 * Smoothly reveals streamed text by buffering incoming chunks and releasing
 * them gradually via requestAnimationFrame, producing the fluid typing effect
 * seen in apps like Claude and ChatGPT.
 */
export function useSmoothedText(targetText: string): string {
  const [displayText, setDisplayText] = useState('')
  const targetRef = useRef('')
  const displayLenRef = useRef(0)
  const rafRef = useRef<number>(0)

  targetRef.current = targetText

  useEffect(() => {
    // Target cleared → immediately clear display
    if (!targetText) {
      displayLenRef.current = 0
      setDisplayText('')
      cancelAnimationFrame(rafRef.current)
      return
    }

    const tick = () => {
      const target = targetRef.current
      if (!target) return

      const currentLen = displayLenRef.current
      if (currentLen < target.length) {
        const remaining = target.length - currentLen
        // Adaptive speed: reveal faster when buffer is large, slower when small
        const step = Math.max(2, Math.ceil(remaining * 0.18))
        displayLenRef.current = Math.min(currentLen + step, target.length)
        setDisplayText(target.slice(0, displayLenRef.current))
        rafRef.current = requestAnimationFrame(tick)
      }
      // When caught up, stop. New useEffect call restarts when more text arrives.
    }

    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(rafRef.current)
  }, [targetText])

  return displayText
}
