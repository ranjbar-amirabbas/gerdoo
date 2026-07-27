import { STATUSES, type SemanticColor } from './status'
import type { AppSnapshot, CalendarEvent, TimerState } from './types'

export interface LedContent {
  label: string
  /** Big countdown / clock line. Empty string means "no big line". */
  big: string
  sub: string
  color: SemanticColor
  /** A key that changes whenever the panel should play a mode transition. */
  transitionKey: string
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** `MM:SS`, or `H:MM:SS` past an hour. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`
  return `${pad2(minutes)}:${pad2(seconds)}`
}

/** 12-hour clock without a meridiem — `10:42`, `2:30`. */
export function formatClock(epochMs: number): string {
  const date = new Date(epochMs)
  const hours = date.getHours() % 12 || 12
  return `${hours}:${pad2(date.getMinutes())}`
}

export function formatMinutes(ms: number): string {
  return `${Math.max(0, Math.round(ms / 60000))} MIN`
}

/** "10:42 · 24 min away" nearby, an absolute weekday/time once it is hours out. */
export function describeWhen(startsAt: number, now: number): string {
  const minutesAway = Math.round((startsAt - now) / 60_000)
  if (minutesAway <= 90) {
    return `${formatClock(startsAt)} · ${minutesAway} min away`
  }
  return new Date(startsAt).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/** Milliseconds left on the timer, computed from the deadline while running. */
export function remainingMs(timer: TimerState, now: number): number {
  if (timer.phase === 'running' && timer.endsAt !== null) {
    return Math.max(0, timer.endsAt - now)
  }
  return Math.max(0, timer.remainingMs)
}

function sanitize(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9 :.,\-+/'!?%()=<>*"&#~_•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Trim to `max` characters so long titles never overflow the panel. */
export function fitLabel(text: string, max: number): string {
  const clean = sanitize(text)
  if (clean.length <= max) return clean
  return `${clean.slice(0, Math.max(1, max - 1)).trim()}.`
}

export interface FocusSuggestion {
  freeMs: number
  suggestMinutes: number
}

/** A focus block that fits before the next event, leaving a 5 minute buffer. */
export function suggestFocus(
  next: CalendarEvent | null,
  now: number,
  presets: number[]
): FocusSuggestion | null {
  if (!next) return null
  const freeMs = next.startsAt - now
  // Only suggest when the gap is short enough that fitting a session is a real
  // decision — with hours to spare the nudge is noise.
  if (freeMs > 2 * 60 * 60_000) return null
  const usableMinutes = Math.floor(freeMs / 60000) - 5
  if (usableMinutes < 10) return null
  const candidates = [...presets].sort((a, b) => a - b).filter((p) => p <= usableMinutes)
  const suggestMinutes = candidates.length > 0 ? candidates[candidates.length - 1] : 0
  if (suggestMinutes === 0) return null
  return { freeMs, suggestMinutes }
}

function statusSub(snapshot: AppSnapshot, now: number): string {
  const { status, calendar, settings } = snapshot
  const meta = STATUSES[status.id]

  if (status.id === 'meeting') {
    const until = calendar.current?.endsAt ?? status.until
    return until ? `UNTIL ${formatClock(until)}` : 'HEADS DOWN'
  }
  if (status.id === 'dnd') {
    return status.until ? `BACK AT ${formatClock(status.until)}` : 'STAY IN THE ZONE'
  }
  if (status.id === 'oncall') return meta.sub

  // Available / custom: prefer calendar awareness, then a focus suggestion.
  if (calendar.current) {
    return fitLabel(`NOW: ${calendar.current.title} TIL ${formatClock(calendar.current.endsAt)}`, 22)
  }
  const suggestion = suggestFocus(calendar.next, now, settings.presets)
  if (calendar.next) {
    const nextLine = `NEXT: ${calendar.next.title} ${formatClock(calendar.next.startsAt)}`
    if (suggestion && suggestion.freeMs < 90 * 60000) {
      return fitLabel(
        `${formatMinutes(suggestion.freeMs)} FREE - START ${suggestion.suggestMinutes} MIN`,
        22
      )
    }
    return fitLabel(nextLine, 22)
  }
  return status.id === 'custom' ? 'READY TO FOCUS' : meta.sub
}

/** Single source of truth for what the LED panel shows. */
export function deriveLedContent(snapshot: AppSnapshot, now: number): LedContent {
  const { timer, status } = snapshot

  if (timer.phase === 'running' || timer.phase === 'paused') {
    const paused = timer.phase === 'paused'
    const isBreak = timer.mode === 'break'
    const color: SemanticColor = paused ? 'paused' : isBreak ? 'break' : 'focus'
    return {
      label: paused ? 'PAUSED' : isBreak ? 'BREAK' : 'FOCUS',
      big: formatDuration(remainingMs(timer, now)),
      sub: isBreak ? 'BREATHE & RESET' : fitLabel(timer.title || 'DEEP WORK', 22),
      color,
      transitionKey: `${timer.mode}:${timer.phase}`
    }
  }

  if (timer.phase === 'completed') {
    const isBreak = timer.mode === 'break'
    return {
      label: isBreak ? 'BREAK OVER' : 'SESSION DONE',
      big: '00:00',
      sub: isBreak ? 'BACK TO WORK' : 'TAKE A BREAK',
      color: isBreak ? 'focus' : 'break',
      transitionKey: `completed:${timer.mode}`
    }
  }

  const meta = STATUSES[status.id]
  const label =
    status.id === 'custom' ? fitLabel(status.customLabel || 'FOCUS MODE', 18) : meta.label
  return {
    label,
    big: meta.showsClock ? formatClock(now) : '',
    sub: statusSub(snapshot, now),
    color: meta.color,
    transitionKey: `status:${status.id}`
  }
}

/** LED labels are shouty by design; the menu bar is not. `ON CALL` → `On Call`. */
function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-z0-9])/g, (_match, lead: string, char: string) => lead + char.toUpperCase())
}

/** Menu bar titles compete with every other app for the notch. */
const MENU_BAR_MAX = 22

/**
 * What the tray prints beside its icon. Derived from `deriveLedContent()` so the
 * menu bar can never claim a different state than the panel.
 */
export function deriveMenuBarTitle(snapshot: AppSnapshot, now: number): string {
  const mode = snapshot.settings.menuBarText
  if (mode === 'off') return ''

  const { timer } = snapshot
  const running = timer.phase === 'running'
  const active = running || timer.phase === 'paused'
  if (mode === 'timer') return running ? formatDuration(remainingMs(timer, now)) : ''

  const content = deriveLedContent(snapshot, now)
  const custom = !active && snapshot.status.id === 'custom' && snapshot.status.customLabel.trim()
  // A custom status is the user's own words — keep their capitalisation.
  const label = custom ? custom : titleCase(content.label)
  // Idle statuses show the wall clock on the panel — the menu bar already has one.
  const title = active ? `${label} ${formatDuration(remainingMs(timer, now))}` : label
  return title.length > MENU_BAR_MAX ? `${title.slice(0, MENU_BAR_MAX - 1).trim()}…` : title
}
