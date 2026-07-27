import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CalendarAccess, CalendarEvent, CalendarSource, CalendarState } from '@shared/types'

export interface ProviderResult {
  access: CalendarAccess
  events: CalendarEvent[]
}

export interface CalendarProvider {
  /** Events from the start of today onwards, in start order. */
  listEvents(now: number, options?: { mayPrompt?: boolean }): Promise<ProviderResult>
}

interface MockTemplate {
  title: string
  hour: number
  minute: number
  durationMinutes: number
}

/** Sample schedule — useful for demos and when system access is unavailable. */
export class MockCalendarProvider implements CalendarProvider {
  private readonly templates: MockTemplate[] = [
    { title: 'STANDUP', hour: 9, minute: 30, durationMinutes: 15 },
    { title: 'TEAM SYNC', hour: 11, minute: 30, durationMinutes: 30 },
    { title: 'DESIGN REVIEW', hour: 14, minute: 0, durationMinutes: 45 },
    { title: '1:1 WITH SAM', hour: 16, minute: 30, durationMinutes: 25 }
  ]

  async listEvents(now: number): Promise<ProviderResult> {
    // Same span as the system source, so switching between them feels alike.
    const events = Array.from({ length: CALENDAR_WINDOW_DAYS }, (_, i) => i).flatMap((dayOffset) =>
      this.templates.map((template) => {
        const day = new Date(now)
        day.setDate(day.getDate() + dayOffset)
        const startsAt = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          template.hour,
          template.minute,
          0,
          0
        ).getTime()
        return {
          id: `mock-${dayOffset}-${template.hour}-${template.minute}`,
          title: template.title,
          startsAt,
          endsAt: startsAt + template.durationMinutes * 60_000,
          isAllDay: false,
          calendar: 'Sample'
        }
      })
    )
    return { access: 'sample', events }
  }
}

interface HelperOutput {
  status: string
  events?: Array<{
    id: string
    title: string
    startsAt: number
    endsAt: number
    isAllDay: boolean
    calendar?: string
    location?: string | null
    isCancelled?: boolean
  }>
  message?: string
}

const HELPER_TIMEOUT_MS = 15_000
const PROMPT_TIMEOUT_MS = 130_000

/** How far ahead the helper reads, from the start of today. */
export const CALENDAR_WINDOW_DAYS = 7

/**
 * Real macOS Calendar data, read through the bundled EventKit helper.
 *
 * Electron has no EventKit binding, so `native/StitchCalendar.swift` is compiled
 * to `resources/stitch-calendar` and spawned per refresh. The helper prints one
 * JSON object and always exits 0 — `status` distinguishes "no events" from
 * "not allowed", which is what the UI needs to say something useful.
 */
export class EventKitCalendarProvider implements CalendarProvider {
  private readonly binary: string

  constructor(private readonly days = CALENDAR_WINDOW_DAYS) {
    const base = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', 'resources')
    this.binary = join(base, 'stitch-calendar')
  }

  isAvailable(): boolean {
    return process.platform === 'darwin' && existsSync(this.binary)
  }

  async listEvents(now: number, options: { mayPrompt?: boolean } = {}): Promise<ProviderResult> {
    if (!this.isAvailable()) {
      return { access: 'unavailable', events: [] }
    }
    const args = ['--days', String(this.days)]
    if (options.mayPrompt) args.push('--request')

    let raw: string
    try {
      raw = await this.run(args, options.mayPrompt ? PROMPT_TIMEOUT_MS : HELPER_TIMEOUT_MS)
    } catch (error) {
      console.error('[stitch] calendar helper failed:', error)
      return { access: 'error', events: [] }
    }

    let parsed: HelperOutput
    try {
      parsed = JSON.parse(raw) as HelperOutput
    } catch {
      console.error('[stitch] calendar helper returned unparseable output')
      return { access: 'error', events: [] }
    }

    const access = this.toAccess(parsed.status)
    if (access !== 'authorized') {
      if (parsed.message) console.error(`[stitch] calendar helper: ${parsed.message}`)
      return { access, events: [] }
    }

    const events = (parsed.events ?? [])
      .filter((event) => !event.isCancelled)
      .map((event) => ({
        id: event.id,
        title: event.title,
        startsAt: Math.round(event.startsAt),
        endsAt: Math.round(event.endsAt),
        isAllDay: event.isAllDay,
        calendar: event.calendar ?? '',
        location: event.location ?? undefined
      }))
      // Yesterday's leftovers can slip in through recurrence expansion.
      .filter((event) => event.endsAt > now - 24 * 60 * 60_000)

    return { access: 'authorized', events }
  }

  private toAccess(status: string): CalendarAccess {
    switch (status) {
      case 'authorized':
        return 'authorized'
      case 'denied':
      case 'writeOnly':
        return 'denied'
      case 'restricted':
        return 'restricted'
      case 'notDetermined':
        return 'notDetermined'
      default:
        return 'error'
    }
  }

  private run(args: string[], timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.binary, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        if (error && !stdout) reject(error)
        else resolve(stdout)
      })
    })
  }
}

export interface CalendarEvents {
  change: []
}

export class CalendarService extends EventEmitter<CalendarEvents> {
  private state: CalendarState = {
    current: null,
    next: null,
    events: [],
    access: 'notDetermined',
    source: 'system'
  }
  private timer: NodeJS.Timeout | null = null
  private refreshing = false
  private readonly onEvents?: (access: CalendarAccess, events: CalendarEvent[]) => void
  /** Most recent events from a successful system read, cache included. */
  private lastAuthorized: CalendarEvent[] | null = null

  constructor(
    private readonly system: EventKitCalendarProvider,
    private readonly sample: MockCalendarProvider,
    source: CalendarSource,
    options: {
      /** Last known events, so the panel is useful before the first read lands. */
      cache?: { access: CalendarAccess; events: CalendarEvent[] } | null
      onEvents?: (access: CalendarAccess, events: CalendarEvent[]) => void
    } = {}
  ) {
    super()
    this.onEvents = options.onEvents
    this.state = { ...this.state, source }
    if (options.cache) {
      if (options.cache.access === 'authorized') this.lastAuthorized = options.cache.events
      this.state = { ...this.state, access: options.cache.access }
      this.applyEvents(options.cache.events, options.cache.access, Date.now(), false)
    }
  }

  start(): void {
    void this.refresh()
    // Re-derive current/next every half minute; the helper call is cheap.
    this.timer = setInterval(() => void this.refresh(), 30_000)
  }

  getState(): CalendarState {
    return this.state
  }

  setSource(source: CalendarSource): void {
    if (this.state.source === source) return
    this.state = { ...this.state, source }
    void this.refresh()
  }

  /** `mayPrompt` lets the helper show the macOS access dialog. */
  async refresh(options: { mayPrompt?: boolean } = {}): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const now = Date.now()
      const useSystem = this.state.source === 'system'
      const provider = useSystem ? this.system : this.sample
      let result = await provider.listEvents(now, options)

      // System read failed. Prefer the last real events we saw — stale truth
      // beats invented meetings — and only fall back to the sample schedule
      // when there has never been a successful read. `access` keeps the real
      // reason either way, so the UI can still explain itself.
      if (useSystem && result.access !== 'authorized') {
        if (this.lastAuthorized) {
          result = { access: result.access, events: this.lastAuthorized }
        } else if (result.access !== 'error') {
          const fallback = await this.sample.listEvents(now)
          result = { access: result.access, events: fallback.events }
        }
      }

      this.applyEvents(result.events, result.access, now, result.access === 'authorized')
    } catch (error) {
      console.error('[stitch] calendar refresh failed:', error)
    } finally {
      this.refreshing = false
    }
  }

  private applyEvents(
    incoming: CalendarEvent[],
    access: CalendarAccess,
    now: number,
    persist: boolean
  ): void {
    const events = [...incoming].sort((a, b) => a.startsAt - b.startsAt)
    const current = events.find((e) => !e.isAllDay && e.startsAt <= now && e.endsAt > now) ?? null
    const next = events.find((e) => !e.isAllDay && e.startsAt > now) ?? null
    const changed =
      current?.id !== this.state.current?.id ||
      next?.id !== this.state.next?.id ||
      events.length !== this.state.events.length ||
      access !== this.state.access

    this.state = { current, next, events, access, source: this.state.source }
    if (persist) {
      this.lastAuthorized = events
      this.onEvents?.(access, events)
    }
    if (changed) this.emit('change')
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
