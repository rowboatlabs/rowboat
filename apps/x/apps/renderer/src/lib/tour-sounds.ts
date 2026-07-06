/**
 * Tiny synthesized sound effects for the product tour — oar splashes, dock
 * bumps, and an arrival fanfare. Everything is generated with Web Audio
 * oscillators/noise so no audio assets are needed. All methods fail silently
 * if audio is unavailable.
 */
export class TourSounds {
    private ctx: AudioContext | null = null
    private master: GainNode | null = null

    private ensure(): AudioContext | null {
        try {
            if (!this.ctx) {
                this.ctx = new AudioContext()
                this.master = this.ctx.createGain()
                this.master.gain.value = 0.5
                this.master.connect(this.ctx.destination)
            }
            if (this.ctx.state === 'suspended') void this.ctx.resume()
            return this.ctx
        } catch {
            return null
        }
    }

    /** Short filtered-noise burst with a falling pitch — an oar dipping. */
    splash() {
        const ctx = this.ensure()
        if (!ctx || !this.master) return
        const dur = 0.22
        const noise = ctx.createBufferSource()
        const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
        const data = buffer.getChannelData(0)
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
        noise.buffer = buffer

        const filter = ctx.createBiquadFilter()
        filter.type = 'bandpass'
        filter.Q.value = 1.2
        filter.frequency.setValueAtTime(1600, ctx.currentTime)
        filter.frequency.exponentialRampToValueAtTime(350, ctx.currentTime + dur)

        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0.14, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)

        noise.connect(filter).connect(gain).connect(this.master)
        noise.start()
        noise.stop(ctx.currentTime + dur)
    }

    /** Soft low thump — the boat nudging a dock. */
    bump() {
        const ctx = this.ensure()
        if (!ctx || !this.master) return
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(150, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.18)
        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0.2, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
        osc.connect(gain).connect(this.master)
        osc.start()
        osc.stop(ctx.currentTime + 0.3)
    }

    /** Gentle high blip — an email landing in the boat. */
    ding() {
        const ctx = this.ensure()
        if (!ctx || !this.master) return
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(880, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.05)
        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0.08, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
        osc.connect(gain).connect(this.master)
        osc.start()
        osc.stop(ctx.currentTime + 0.35)
    }

    /** Little four-note arpeggio for the tour finale. */
    fanfare() {
        const ctx = this.ensure()
        if (!ctx || !this.master) return
        const notes = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6
        notes.forEach((freq, i) => {
            const start = ctx.currentTime + i * 0.13
            const osc = ctx.createOscillator()
            osc.type = 'triangle'
            osc.frequency.value = freq
            const gain = ctx.createGain()
            gain.gain.setValueAtTime(0.0001, start)
            gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.001, start + (i === notes.length - 1 ? 0.7 : 0.3))
            osc.connect(gain).connect(this.master!)
            osc.start(start)
            osc.stop(start + 0.8)
        })
    }

    dispose() {
        this.ctx?.close().catch(() => {})
        this.ctx = null
        this.master = null
    }
}
