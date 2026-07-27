/** Types shared between main, preload and renderer. Keep this file dependency-free. */

export type StatusId =
  | 'available'
  | 'oncall'
  | 'meeting'
  | 'dnd'
  | 'custom'

export type TimerMode = 'focus' | 'break'

/** What the menu bar prints next to the tray icon. */
export type MenuBarText =
  /** Icon only. */
  | 'off'
  /** The countdown, and only while a session runs. */
  | 'timer'
  /** The current status, replaced by the running session. */
  | 'status'

export type TimerPhase = 'idle' | 'running' | 'paused' | 'completed'

export interface TimerState {
  mode: TimerMode
  phase: TimerPhase
  /** Planned duration of the current session. */
  durationMs: number
  /** Milliseconds left. Authoritative while paused/idle. */
  remainingMs: number
  /** Wall-clock deadline while running (epoch ms), null otherwise. */
  endsAt: number | null
  /** Epoch ms the current session started, null when idle. */
  startedAt: number | null
  title: string
}

export interface StatusState {
  id: StatusId
  /** Free-form label used when `id === 'custom'`. */
  customLabel: string
  /** Optional "until" hint, epoch ms — drives BACK AT / UNTIL sub-labels. */
  until: number | null
}

export interface CalendarEvent {
  id: string
  title: string
  startsAt: number
  endsAt: number
  isAllDay: boolean
  /** Name of the calendar the event belongs to. */
  calendar?: string
  location?: string
}

/**
 * Where events come from: the real macOS Calendar, a subscribed iCalendar feed,
 * or the built-in sample set.
 */
export type CalendarSource = 'system' | 'ics' | 'sample'

export type CalendarAccess =
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'notDetermined'
  /** The helper binary is missing, or this is not macOS. */
  | 'unavailable'
  /** An ICS feed is selected but no URL has been given yet. */
  | 'notConfigured'
  | 'error'
  /** Not a permission state — the sample source needs none. */
  | 'sample'

export interface CalendarState {
  /** The event happening right now, if any. */
  current: CalendarEvent | null
  /** The next upcoming event, if any. */
  next: CalendarEvent | null
  events: CalendarEvent[]
  access: CalendarAccess
  source: CalendarSource
  /** Why the last read failed, when there is something worth saying. */
  detail: string | null
}

export interface SessionRecord {
  id: string
  mode: TimerMode
  title: string
  startedAt: number
  endedAt: number
  plannedMs: number
  /** Time actually spent running (excludes paused time). */
  actualMs: number
  completed: boolean
}

export interface Settings {
  /** Focus presets in minutes, shown in the preset selector. */
  presets: number[]
  selectedPresetIndex: number
  breakMinutes: number
  soundEnabled: boolean
  /** 0.35 – 1. Scales LED pixel intensity. */
  brightness: number
  /**
   * `#rrggbb` the whole palette is derived from, or null for the built-in
   * multi-hue one. See `@shared/palette`.
   */
  accentColor: string | null
  /** null = follow the system reduced-motion setting. */
  reduceMotion: boolean | null
  autoStartBreak: boolean
  launchAtLogin: boolean
  hideOnBlur: boolean
  defaultTitle: string
  calendarSource: CalendarSource
  /** The feed read when `calendarSource` is `ics`. Empty until one is given. */
  icsUrl: string
  menuBarText: MenuBarText
}

export interface WindowState {
  pinned: boolean
  expanded: boolean
}

export interface AppSnapshot {
  timer: TimerState
  status: StatusState
  calendar: CalendarState
  settings: Settings
  window: WindowState
  sessions: SessionRecord[]
  /** Epoch ms the snapshot was produced — lets renderers resync their clocks. */
  now: number
}

export const SNAPSHOT_CHANNEL = 'gerdoo:snapshot'
export const SOUND_CHANNEL = 'gerdoo:sound'

export type SoundCue = 'complete' | 'start' | 'stop'
