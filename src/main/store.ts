import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  CalendarAccess,
  CalendarEvent,
  SessionRecord,
  Settings,
  StatusState,
  TimerState,
  WindowState
} from '@shared/types'

export interface PersistedBounds {
  x: number
  y: number
}

/** Last successful calendar read, so the panel has data before the first refresh. */
export interface CalendarCache {
  access: CalendarAccess
  events: CalendarEvent[]
  fetchedAt: number
}

export interface PersistedState {
  version: number
  settings: Settings
  window: WindowState
  status: StatusState
  /** Saved so an interrupted session survives a restart or a crash. */
  timer: TimerState | null
  focusBarPosition: PersistedBounds | null
  sessions: SessionRecord[]
  calendarCache: CalendarCache | null
}

export const DEFAULT_SETTINGS: Settings = {
  presets: [15, 25, 35, 50],
  selectedPresetIndex: 1,
  breakMinutes: 5,
  soundEnabled: true,
  brightness: 0.85,
  reduceMotion: null,
  autoStartBreak: false,
  launchAtLogin: false,
  hideOnBlur: true,
  defaultTitle: 'DEEP WORK',
  calendarSource: 'system'
}

const DEFAULT_STATE: PersistedState = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  window: { pinned: false, expanded: false },
  status: { id: 'available', customLabel: '', until: null },
  timer: null,
  focusBarPosition: null,
  sessions: [],
  calendarCache: null
}

/**
 * Small JSON store in `userData`. Writes are debounced and atomic (write to a
 * temp file, then rename) so a crash mid-write cannot truncate the state file.
 */
export class Store {
  private readonly file: string
  private state: PersistedState
  private writeTimer: NodeJS.Timeout | null = null

  constructor(fileName = 'gerdoo-state.json') {
    this.file = join(app.getPath('userData'), fileName)
    this.state = this.load()
  }

  private load(): PersistedState {
    try {
      if (!existsSync(this.file)) return structuredClone(DEFAULT_STATE)
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<PersistedState>
      return {
        ...structuredClone(DEFAULT_STATE),
        ...raw,
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        window: { ...DEFAULT_STATE.window, ...(raw.window ?? {}) },
        status: { ...DEFAULT_STATE.status, ...(raw.status ?? {}) },
        sessions: Array.isArray(raw.sessions) ? raw.sessions.slice(-500) : []
      }
    } catch (error) {
      console.error('[gerdoo] state file unreadable, starting fresh:', error)
      return structuredClone(DEFAULT_STATE)
    }
  }

  get(): PersistedState {
    return this.state
  }

  patch(patch: Partial<PersistedState>): PersistedState {
    this.state = { ...this.state, ...patch }
    this.scheduleWrite()
    return this.state
  }

  patchSettings(patch: Partial<Settings>): Settings {
    this.state.settings = { ...this.state.settings, ...patch }
    this.scheduleWrite()
    return this.state.settings
  }

  addSession(session: SessionRecord): void {
    this.state.sessions = [...this.state.sessions, session].slice(-500)
    this.scheduleWrite()
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (error) {
      console.error('[gerdoo] failed to persist state:', error)
    }
  }
}
