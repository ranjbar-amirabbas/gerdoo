import { EventEmitter } from 'node:events'
import type { SessionRecord, TimerMode, TimerState } from '@shared/types'

const MINUTE = 60_000

export interface TimerEvents {
  change: []
  tick: []
  complete: [SessionRecord]
  /** Fired when a start switches focus <-> break, so callers can cue the change. */
  modeChange: [TimerMode]
}

/**
 * Authoritative timer. Lives in the main process so it keeps running while the
 * Focus Bar is hidden, and stores a wall-clock deadline rather than a countdown
 * so sleep/resume and dropped intervals cannot drift.
 */
export class TimerService extends EventEmitter<TimerEvents> {
  private state: TimerState
  private interval: NodeJS.Timeout | null = null
  /** Running time accumulated before the current run segment (excludes pauses). */
  private accumulatedMs = 0
  private segmentStartedAt: number | null = null

  constructor(restored: TimerState | null, defaultMinutes: number, defaultTitle: string) {
    super()
    this.state = restored ?? {
      mode: 'focus',
      phase: 'idle',
      durationMs: defaultMinutes * MINUTE,
      remainingMs: defaultMinutes * MINUTE,
      endsAt: null,
      startedAt: null,
      title: defaultTitle
    }
    if (this.state.phase === 'running') {
      // Restored mid-session: either it finished while we were gone, or it keeps going.
      if (this.state.endsAt !== null && this.state.endsAt <= Date.now()) {
        this.state = { ...this.state, phase: 'completed', remainingMs: 0 }
      } else {
        this.segmentStartedAt = Date.now()
        this.startInterval()
      }
    }
  }

  getState(): TimerState {
    if (this.state.phase === 'running' && this.state.endsAt !== null) {
      return { ...this.state, remainingMs: Math.max(0, this.state.endsAt - Date.now()) }
    }
    return { ...this.state }
  }

  start(options: { mode?: TimerMode; minutes?: number; title?: string } = {}): void {
    const mode = options.mode ?? 'focus'
    const previousMode = this.state.mode
    const durationMs =
      options.minutes !== undefined ? Math.round(options.minutes * MINUTE) : this.state.durationMs
    const now = Date.now()
    this.accumulatedMs = 0
    this.segmentStartedAt = now
    this.state = {
      mode,
      phase: 'running',
      durationMs,
      remainingMs: durationMs,
      endsAt: now + durationMs,
      startedAt: now,
      title: options.title ?? this.state.title
    }
    this.startInterval()
    if (mode !== previousMode) this.emit('modeChange', mode)
    this.emit('change')
  }

  pause(): void {
    if (this.state.phase !== 'running') return
    const now = Date.now()
    this.closeSegment(now)
    this.state = {
      ...this.state,
      phase: 'paused',
      remainingMs: Math.max(0, (this.state.endsAt ?? now) - now),
      endsAt: null
    }
    this.stopInterval()
    this.emit('change')
  }

  resume(): void {
    if (this.state.phase !== 'paused') return
    const now = Date.now()
    this.segmentStartedAt = now
    this.state = { ...this.state, phase: 'running', endsAt: now + this.state.remainingMs }
    this.startInterval()
    this.emit('change')
  }

  toggle(): void {
    if (this.state.phase === 'running') this.pause()
    else if (this.state.phase === 'paused') this.resume()
    else this.start({ mode: this.state.mode })
  }

  /** Ends the session early. Returns the record if one was in flight. */
  stop(): SessionRecord | null {
    if (this.state.phase === 'idle') return null
    const now = Date.now()
    this.closeSegment(now)
    const record = this.state.startedAt ? this.buildRecord(now, false) : null
    this.stopInterval()
    this.state = {
      ...this.state,
      phase: 'idle',
      remainingMs: this.state.durationMs,
      endsAt: null,
      startedAt: null
    }
    this.accumulatedMs = 0
    this.emit('change')
    return record
  }

  /** Clears a `completed` phase without recording anything new. */
  acknowledgeCompletion(): void {
    if (this.state.phase !== 'completed') return
    this.state = {
      ...this.state,
      phase: 'idle',
      remainingMs: this.state.durationMs,
      endsAt: null,
      startedAt: null
    }
    this.emit('change')
  }

  setTitle(title: string): void {
    this.state = { ...this.state, title }
    this.emit('change')
  }

  setDurationMinutes(minutes: number): void {
    if (this.state.phase !== 'idle') return
    const durationMs = Math.round(minutes * MINUTE)
    this.state = { ...this.state, durationMs, remainingMs: durationMs }
    this.emit('change')
  }

  /** Re-checks the deadline — called on power resume and window show. */
  sync(): void {
    if (this.state.phase !== 'running') return
    this.checkDeadline()
    this.emit('tick')
  }

  dispose(): void {
    this.stopInterval()
  }

  private buildRecord(endedAt: number, completed: boolean): SessionRecord {
    return {
      id: `${this.state.startedAt ?? endedAt}-${this.state.mode}`,
      mode: this.state.mode,
      title: this.state.title,
      startedAt: this.state.startedAt ?? endedAt,
      endedAt,
      plannedMs: this.state.durationMs,
      actualMs: this.accumulatedMs,
      completed
    }
  }

  private closeSegment(now: number): void {
    if (this.segmentStartedAt !== null) {
      this.accumulatedMs += now - this.segmentStartedAt
      this.segmentStartedAt = null
    }
  }

  private startInterval(): void {
    this.stopInterval()
    // 500ms keeps the second boundary tight without busy-waiting.
    this.interval = setInterval(() => {
      this.checkDeadline()
      if (this.state.phase === 'running') this.emit('tick')
    }, 500)
  }

  private stopInterval(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  private checkDeadline(): void {
    if (this.state.phase !== 'running' || this.state.endsAt === null) return
    const now = Date.now()
    if (now < this.state.endsAt) return
    this.closeSegment(this.state.endsAt)
    const record = this.buildRecord(this.state.endsAt, true)
    this.stopInterval()
    this.state = { ...this.state, phase: 'completed', remainingMs: 0, endsAt: null }
    this.emit('complete', record)
    this.emit('change')
  }
}
