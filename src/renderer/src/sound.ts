/** Tiny WebAudio cues, plus one sampled effect for focus <-> break switches. */
import effectUrl from '@resources/effect.mp3'

let context: AudioContext | null = null
let effect: HTMLAudioElement | null = null

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

/** Restarts the clip if a second switch lands while it is still playing. */
function playEffect(): void {
  effect ??= new Audio(effectUrl)
  effect.currentTime = 0
  // Rejects only if the renderer has no audio output; nothing useful to do.
  void effect.play().catch(() => {})
}

export function playCue(cue: string): void {
  if (cue === 'mode') {
    playEffect()
    return
  }
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
