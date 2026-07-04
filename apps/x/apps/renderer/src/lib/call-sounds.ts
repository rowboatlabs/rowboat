// Tiny synthesized UI sounds for calls — no audio assets, one lazy context.

let ctx: AudioContext | null = null

/**
 * Soft rising blip played the instant an utterance is accepted — sub-second
 * acknowledgment makes the (still ongoing) model turn feel responsive
 * instead of dead air.
 */
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
