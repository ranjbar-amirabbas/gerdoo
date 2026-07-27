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

/** Where events come from: the real macOS Calendar, or the built-in sample set. */
export type CalendarSource = 'system' | 'sample'

export type CalendarAccess =
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'notDetermined'
  /** The helper binary is missing, or this is not macOS. */
  | 'unavailable'
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
  /** Start the next focus session as soon as a break ends. */
  autoStartFocus: boolean
  launchAtLogin: boolean
  hideOnBlur: boolean
  defaultTitle: string
  calendarSource: CalendarSource
  menuBarText: MenuBarText
}

export interface WindowState {
  pinned: boolean
  expanded: boolean
  /**
   * Uniform zoom applied to the whole device, 1 = the design size. The window
   * keeps its aspect ratio, so one number describes the size completely.
   */
  scale: number
}

/** Device artwork size at scale 1. The window adds padding so CSS can cast a
    real shadow — the renderer needs these to size a drag, so they live here. */
export const DEVICE_WIDTH = 520
export const DEVICE_COLLAPSED_HEIGHT = 230
export const DEVICE_EXPANDED_HEIGHT = 490
export const SHADOW_PAD = 14

export const WINDOW_WIDTH = DEVICE_WIDTH + SHADOW_PAD * 2
export const COLLAPSED_HEIGHT = DEVICE_COLLAPSED_HEIGHT + SHADOW_PAD * 2
export const EXPANDED_HEIGHT = DEVICE_EXPANDED_HEIGHT + SHADOW_PAD * 2

/** Bounds for `WindowState.scale`, shared so main and renderer clamp alike. */
export const MIN_DEVICE_SCALE = 0.7
export const MAX_DEVICE_SCALE = 2
/** One press of ⌘+ / ⌘−. */
export const DEVICE_SCALE_STEP = 0.1

export function clampDeviceScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_DEVICE_SCALE, Math.max(MIN_DEVICE_SCALE, scale))
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

export type SoundCue = 'complete' | 'start' | 'stop' | 'mode'
