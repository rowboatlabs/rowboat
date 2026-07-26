// Tiny synthesized UI sounds for calls — no audio assets, one lazy context.

let ctx: AudioContext | null = null

/**
 * Soft rising blip played the instant an utterance is accepted — sub-second
 * acknowledgment makes the (still ongoing) model turn feel responsive
 * instead of dead air.
 */
/**
 * Two-tone attention chime for permission problems — something needs the
 * user's action and would otherwise fail silently (they may be looking at
 * another app entirely when it fires).
 */
export function playAlertCue() {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime
    for (const [offset, freq] of [
      [0, 660],
      [0.16, 494],
    ] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t + offset)
      gain.gain.setValueAtTime(0.0001, t + offset)
      gain.gain.exponentialRampToValueAtTime(0.14, t + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.22)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t + offset)
      osc.stop(t + offset + 0.24)
    }
  } catch {
    // cosmetic — never let a sound failure affect the flow
  }
}

export function playAckCue() {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t)
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.08)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.13)
  } catch {
    // cosmetic — never let a sound failure affect the call
  }
}
