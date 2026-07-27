import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, net } from 'electron'
import type { CalendarAccess, CalendarEvent, CalendarSource, CalendarState } from '@shared/types'
import { expandIcs, parseIcs, type IcsCalendar } from './ics'

export interface ProviderResult {
  access: CalendarAccess
  events: CalendarEvent[]
  /** Why a read failed, in words the Settings window can show. */
  detail?: string | null
}

export interface ProviderOptions {
  /** Allow a permission dialog to be raised. */
  mayPrompt?: boolean
  /** Bypass any provider-side cache — the user asked for this refresh. */
  force?: boolean
}

export interface CalendarProvider {
  /** Events from the start of today onwards, in start order. */
  listEvents(now: number, options?: ProviderOptions): Promise<ProviderResult>
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
 * Electron has no EventKit binding, so `native/GerdooCalendar.swift` is compiled
 * to `resources/gerdoo-calendar` and spawned per refresh. The helper prints one
 * JSON object and always exits 0 — `status` distinguishes "no events" from
 * "not allowed", which is what the UI needs to say something useful.
 */
export class EventKitCalendarProvider implements CalendarProvider {
  private readonly binary: string

  constructor(private readonly days = CALENDAR_WINDOW_DAYS) {
    const base = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', 'resources')
    this.binary = join(base, 'gerdoo-calendar')
  }

  isAvailable(): boolean {
    return process.platform === 'darwin' && existsSync(this.binary)
  }

  async listEvents(now: number, options: ProviderOptions = {}): Promise<ProviderResult> {
    if (!this.isAvailable()) {
      return { access: 'unavailable', events: [] }
    }
    const args = ['--days', String(this.days)]
    if (options.mayPrompt) args.push('--request')

    let raw: string
    try {
      raw = await this.run(args, options.mayPrompt ? PROMPT_TIMEOUT_MS : HELPER_TIMEOUT_MS)
    } catch (error) {
      console.error('[gerdoo] calendar helper failed:', error)
      return { access: 'error', events: [] }
    }

    let parsed: HelperOutput
    try {
      parsed = JSON.parse(raw) as HelperOutput
    } catch {
      console.error('[gerdoo] calendar helper returned unparseable output')
      return { access: 'error', events: [] }
    }

    const access = this.toAccess(parsed.status)
    if (access !== 'authorized') {
      if (parsed.message) console.error(`[gerdoo] calendar helper: ${parsed.message}`)
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

/** Longest an ICS body may be before we assume something has gone wrong. */
const ICS_MAX_BYTES = 8 * 1024 * 1024
const ICS_FETCH_TIMEOUT_MS = 15_000
/**
 * The service re-derives "now" and "next" every 30 seconds, which is far too
 * often to be pulling a file off somebody's server. Between fetches the parsed
 * feed is re-expanded from memory, so the window still slides forward — only
 * the network call is rationed. The Refresh button skips this.
 */
const ICS_CACHE_MS = 5 * 60_000

/**
 * Events from a subscribed iCalendar feed: the `.ics` URL that Google Calendar,
 * Outlook, Fastmail and friends all offer under "secret address" or "publish".
 *
 * The only cross-platform source Gerdoo has — it needs no native binding and no
 * permission prompt, which makes it the way Windows gets real events.
 */
export class IcsCalendarProvider implements CalendarProvider {
  private url = ''
  private cache: { url: string; calendar: IcsCalendar; fetchedAt: number } | null = null
  /** Concurrent refreshes share one request rather than racing each other. */
  private pending: Promise<IcsCalendar> | null = null

  constructor(private readonly days = CALENDAR_WINDOW_DAYS) {}

  setUrl(url: string): void {
    const next = url.trim()
    if (next === this.url) return
    this.url = next
    this.cache = null
  }

  async listEvents(now: number, options: ProviderOptions = {}): Promise<ProviderResult> {
    if (!this.url) return { access: 'notConfigured', events: [], detail: null }

    let endpoint: URL
    try {
      endpoint = normalizeIcsUrl(this.url)
    } catch (error) {
      return { access: 'error', events: [], detail: (error as Error).message }
    }

    const fresh =
      this.cache &&
      this.cache.url === this.url &&
      now - this.cache.fetchedAt < ICS_CACHE_MS &&
      !options.force

    let calendar: IcsCalendar
    if (fresh && this.cache) {
      calendar = this.cache.calendar
    } else {
      try {
        calendar = await (this.pending ??= this.load(endpoint))
        this.cache = { url: this.url, calendar, fetchedAt: Date.now() }
      } catch (error) {
        console.error('[gerdoo] calendar feed failed:', error)
        return { access: 'error', events: [], detail: (error as Error).message }
      } finally {
        this.pending = null
      }
    }

    // A whole day back, so an event running across midnight is still "current".
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const windowStart = start.getTime()
    const windowEnd = windowStart + this.days * 24 * 60 * 60_000

    const events = expandIcs(calendar, windowStart, windowEnd)
      .filter((event) => !event.isCancelled)
      .map((event) => ({
        id: `ics-${event.id}`,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        isAllDay: event.isAllDay,
        calendar: calendar.name ?? endpoint.hostname,
        location: event.location ?? undefined
      }))

    return { access: 'authorized', events, detail: null }
  }

  private async load(endpoint: URL): Promise<IcsCalendar> {
    const response = await net.fetch(endpoint.toString(), {
      signal: AbortSignal.timeout(ICS_FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/calendar, text/plain;q=0.5' }
    })
    if (!response.ok) {
      throw new Error(`The feed answered ${response.status} ${response.statusText}.`)
    }

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > ICS_MAX_BYTES) {
      throw new Error('The feed is larger than 8 MB.')
    }

    const text = await response.text()
    if (text.length > ICS_MAX_BYTES) throw new Error('The feed is larger than 8 MB.')
    if (!text.includes('BEGIN:VCALENDAR')) {
      // Almost always a share page or a login redirect rather than the feed.
      throw new Error('That URL did not return an iCalendar file.')
    }
    return parseIcs(text)
  }
}

/**
 * `webcal://` is the same thing over HTTPS with a scheme that asks the desktop
 * to subscribe; every calendar app rewrites it, and so do we. Anything that is
 * not HTTP(S) after that is refused — a feed URL has no business naming `file:`.
 */
function normalizeIcsUrl(raw: string): URL {
  const trimmed = raw.trim()
  // Rewritten as text, before parsing: assigning to `URL.protocol` cannot move
  // a URL between a non-special scheme like `webcal:` and a special one like
  // `https:` — the spec makes that a silent no-op.
  const text = /^webcal:\/\//i.test(trimmed) ? `https://${trimmed.slice(9)}` : trimmed

  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('That is not a valid URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The URL has to start with https://, http:// or webcal://.')
  }
  return url
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
    source: 'system',
    detail: null
  }
  private timer: NodeJS.Timeout | null = null
  private refreshing = false
  private readonly onEvents?: (
    access: CalendarAccess,
    events: CalendarEvent[],
    source: CalendarSource
  ) => void
  /**
   * Most recent events from a successful read, and which source produced them.
   * Keyed by source so switching feeds never shows the old one's meetings while
   * the new one is still loading or broken.
   */
  private lastGood: { source: CalendarSource; events: CalendarEvent[] } | null = null

  constructor(
    private readonly system: EventKitCalendarProvider,
    private readonly sample: MockCalendarProvider,
    private readonly ics: IcsCalendarProvider,
    source: CalendarSource,
    options: {
      /** Last known events, so the panel is useful before the first read lands. */
      cache?: { access: CalendarAccess; events: CalendarEvent[]; source?: CalendarSource } | null
      onEvents?: (
        access: CalendarAccess,
        events: CalendarEvent[],
        source: CalendarSource
      ) => void
    } = {}
  ) {
    super()
    this.onEvents = options.onEvents
    this.state = { ...this.state, source }
    // A cache written by a different source describes a calendar the user is no
    // longer looking at, so it is dropped rather than shown.
    const cache = options.cache
    if (cache && (cache.source ?? 'system') === source) {
      if (cache.access === 'authorized') this.lastGood = { source, events: cache.events }
      this.state = { ...this.state, access: cache.access }
      this.applyEvents(cache.events, cache.access, Date.now(), false, null)
    }
  }

  start(): void {
    void this.refresh()
    // Re-derive current/next every half minute. The helper call is cheap, and
    // the ICS provider serves this from its own cache between fetches.
    this.timer = setInterval(() => void this.refresh(), 30_000)
  }

  getState(): CalendarState {
    return this.state
  }

  setSource(source: CalendarSource): void {
    if (this.state.source === source) return
    this.state = { ...this.state, source, detail: null }
    void this.refresh({ force: true })
  }

  /** Points the ICS provider at a new feed, and re-reads if that is the source. */
  setIcsUrl(url: string): void {
    this.ics.setUrl(url)
    if (this.state.source === 'ics') void this.refresh({ force: true })
  }

  /** `mayPrompt` lets the helper show the macOS access dialog. */
  async refresh(options: ProviderOptions = {}): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const now = Date.now()
      const source = this.state.source
      const provider =
        source === 'system' ? this.system : source === 'ics' ? this.ics : this.sample
      let result = await provider.listEvents(now, options)

      // A real read failed. Prefer the last real events we saw — stale truth
      // beats invented meetings — and only fall back to the sample schedule
      // when there has never been a successful read and the failure is not one
      // the user has to fix. `access` keeps the real reason either way, so the
      // UI can still explain itself.
      if (source !== 'sample' && result.access !== 'authorized') {
        const stale = this.lastGood?.source === source ? this.lastGood.events : null
        if (stale) {
          result = { ...result, events: stale }
        } else if (result.access !== 'error' && result.access !== 'notConfigured') {
          const fallback = await this.sample.listEvents(now)
          result = { ...result, events: fallback.events }
        }
      }

      this.applyEvents(
        result.events,
        result.access,
        now,
        result.access === 'authorized',
        result.detail ?? null
      )
    } catch (error) {
      console.error('[gerdoo] calendar refresh failed:', error)
    } finally {
      this.refreshing = false
    }
  }

  private applyEvents(
    incoming: CalendarEvent[],
    access: CalendarAccess,
    now: number,
    persist: boolean,
    detail: string | null
  ): void {
    const events = [...incoming].sort((a, b) => a.startsAt - b.startsAt)
    const current = events.find((e) => !e.isAllDay && e.startsAt <= now && e.endsAt > now) ?? null
    const next = events.find((e) => !e.isAllDay && e.startsAt > now) ?? null
    const source = this.state.source
    const changed =
      current?.id !== this.state.current?.id ||
      next?.id !== this.state.next?.id ||
      events.length !== this.state.events.length ||
      access !== this.state.access ||
      detail !== this.state.detail

    this.state = { current, next, events, access, source, detail }
    if (persist) {
      this.lastGood = { source, events }
      this.onEvents?.(access, events, source)
    }
    if (changed) this.emit('change')
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
