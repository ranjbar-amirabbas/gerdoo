/** Tiny WebAudio cues — no audio assets to ship, no autoplay policy trouble. */
let context: AudioContext | null = null

function ensureContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  context ??= new AudioContext()
  void context.resume()
  return context
}

function tone(ctx: AudioContext, frequency: number, startAt: number, duration: number, gain: number): void {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  amp.gain.setValueAtTime(0.0001, startAt)
  amp.gain.exponentialRampToValueAtTime(gain, startAt + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(amp).connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}

export function playCue(cue: string): void {
  const ctx = ensureContext()
  if (!ctx) return
  const t = ctx.currentTime + 0.01
  if (cue === 'complete') {
    tone(ctx, 660, t, 0.18, 0.16)
    tone(ctx, 880, t + 0.16, 0.26, 0.14)
  } else if (cue === 'start') {
    tone(ctx, 520, t, 0.09, 0.1)
  } else {
    tone(ctx, 300, t, 0.12, 0.09)
  }
}
