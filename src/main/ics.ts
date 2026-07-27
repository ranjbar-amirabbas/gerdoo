/**
 * A small iCalendar (RFC 5545) reader.
 *
 * Enough of the format to answer "what is on my calendar this week": events,
 * their times, and the recurrence rules that generate most of them. It is not a
 * general iCalendar library — VTODO, VJOURNAL, VALARM and VFREEBUSY are ignored,
 * and so are VTIMEZONE definitions: a `TZID` is looked up as an IANA zone name
 * through `Intl` instead, which is what every feed worth subscribing to emits.
 * A zone name the runtime does not know (Outlook's older "W. Europe Standard
 * Time" spelling, say) degrades to the local clock rather than failing the read.
 *
 * Parsing and expansion are separate on purpose. `parseIcs` turns the text into
 * event *definitions*, which the provider caches; `expandIcs` turns those into
 * the concrete occurrences inside a window, which has to be redone as the window
 * slides forward but costs nothing.
 */

// -------------------------------------------------------------- content lines

interface ContentLine {
  name: string
  params: Map<string, string>
  value: string
}

/** Splits on `separator`, ignoring separators inside a quoted parameter value. */
function splitUnquoted(text: string, separator: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    else if (char === separator && !quoted) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/**
 * Undoes RFC 5545 line folding: a line beginning with a space or a tab is the
 * continuation of the one before it, with that first character dropped.
 */
function unfold(text: string): string[] {
  const lines: string[] = []
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if (lines.length > 0 && (raw.startsWith(' ') || raw.startsWith('\t'))) {
      lines[lines.length - 1] += raw.slice(1)
    } else {
      lines.push(raw)
    }
  }
  return lines
}

function parseLine(line: string): ContentLine | null {
  let colon = -1
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') quoted = !quoted
    else if (char === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon < 0) return null

  const segments = splitUnquoted(line.slice(0, colon), ';')
  const params = new Map<string, string>()
  for (const segment of segments.slice(1)) {
    const equals = segment.indexOf('=')
    if (equals < 0) continue
    const key = segment.slice(0, equals).toUpperCase()
    const value = segment.slice(equals + 1).replace(/^"|"$/g, '')
    params.set(key, value)
  }
  return { name: segments[0].toUpperCase(), params, value: line.slice(colon + 1) }
}

/** `\n` is a newline; `\\`, `\,` and `\;` are the escaped characters themselves. */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, char: string) =>
    char === 'n' || char === 'N' ? '\n' : char
  )
}

// --------------------------------------------------------------- civil dates

/** A wall-clock reading, with no timezone attached to it yet. */
interface Civil {
  y: number
  /** 1-12. */
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

/**
 * `Date.UTC` used purely as calendar arithmetic — no timezone is implied. Doing
 * the day and month maths in UTC is what keeps a 9 am event at 9 am across a
 * daylight-saving change: the zone is applied once, at the very end.
 */
function civilToUtcMs(c: Civil): number {
  return Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s)
}

function utcMsToCivil(ms: number): Civil {
  const date = new Date(ms)
  return {
    y: date.getUTCFullYear(),
    mo: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    h: date.getUTCHours(),
    mi: date.getUTCMinutes(),
    s: date.getUTCSeconds()
  }
}

const DAY_MS = 86_400_000

function addDays(c: Civil, days: number): Civil {
  return utcMsToCivil(civilToUtcMs(c) + days * DAY_MS)
}

function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

function addMonths(c: Civil, months: number): Civil {
  const total = c.y * 12 + (c.mo - 1) + months
  const y = Math.floor(total / 12)
  const mo = total - y * 12 + 1
  return { ...c, y, mo, d: Math.min(c.d, daysInMonth(y, mo)) }
}

/** 0 = Sunday, matching `Date.prototype.getUTCDay`. */
function weekdayOf(c: Civil): number {
  return new Date(civilToUtcMs(c)).getUTCDay()
}

// ----------------------------------------------------------------- timezones

const formatters = new Map<string, Intl.DateTimeFormat | null>()

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(zone)
  if (cached !== undefined) return cached
  let formatter: Intl.DateTimeFormat | null = null
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    // Not a zone this runtime knows — fall back to the local clock.
  }
  formatters.set(zone, formatter)
  return formatter
}

/** How far `zone` is ahead of UTC at that instant, in ms. */
function zoneOffsetMs(utcMs: number, zone: string): number | null {
  const formatter = formatterFor(zone)
  if (!formatter) return null
  const parts = formatter.formatToParts(new Date(utcMs))
  const field = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? NaN)
  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second')
  )
  return Number.isNaN(asUtc) ? null : asUtc - utcMs
}

/**
 * The instant at which `zone`'s clocks read `c`. Two passes: the first offset is
 * looked up at the wrong instant (off by the offset itself), and the second
 * corrects it — which is what gets the hour on either side of a DST switch right.
 */
function zonedToEpoch(c: Civil, zone: string): number | null {
  const target = civilToUtcMs(c)
  const guess = zoneOffsetMs(target, zone)
  if (guess === null) return null
  const corrected = zoneOffsetMs(target - guess, zone)
  return target - (corrected ?? guess)
}

// ---------------------------------------------------------------- ics values

type IcsDateKind =
  /** A whole day, with no time of day at all. */
  | 'date'
  | 'utc'
  | 'zoned'
  /** No zone given: whatever the clock in front of the reader says. */
  | 'floating'

interface IcsDate {
  civil: Civil
  kind: IcsDateKind
  zone: string | null
}

const DATE_TIME = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/

function parseDateValue(value: string, params: Map<string, string>): IcsDate | null {
  const match = DATE_TIME.exec(value.trim())
  if (!match) return null
  const civil: Civil = {
    y: Number(match[1]),
    mo: Number(match[2]),
    d: Number(match[3]),
    h: Number(match[4] ?? 0),
    mi: Number(match[5] ?? 0),
    s: Number(match[6] ?? 0)
  }
  if (match[4] === undefined || params.get('VALUE') === 'DATE') {
    return { civil: { ...civil, h: 0, mi: 0, s: 0 }, kind: 'date', zone: null }
  }
  if (match[7] === 'Z') return { civil, kind: 'utc', zone: null }
  const zone = params.get('TZID')
  return zone ? { civil, kind: 'zoned', zone } : { civil, kind: 'floating', zone: null }
}

/** Resolves a wall-clock reading to an instant, using whichever zone applies. */
function toEpoch(civil: Civil, kind: IcsDateKind, zone: string | null): number {
  if (kind === 'utc') return civilToUtcMs(civil)
  if (kind === 'zoned' && zone) {
    const epoch = zonedToEpoch(civil, zone)
    if (epoch !== null) return epoch
  }
  // Whole days and floating times both mean "the local clock", and so does a
  // zone this runtime could not resolve.
  return new Date(civil.y, civil.mo - 1, civil.d, civil.h, civil.mi, civil.s).getTime()
}

function icsDateToEpoch(date: IcsDate): number {
  return toEpoch(date.civil, date.kind, date.zone)
}

const DURATION = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

function parseDuration(value: string): number | null {
  const match = DURATION.exec(value.trim())
  if (!match) return null
  const weeks = Number(match[2] ?? 0)
  const days = Number(match[3] ?? 0)
  const hours = Number(match[4] ?? 0)
  const minutes = Number(match[5] ?? 0)
  const seconds = Number(match[6] ?? 0)
  const total =
    ((weeks * 7 + days) * 24 * 3600 + hours * 3600 + minutes * 60 + seconds) * 1000
  return match[1] === '-' ? -total : total
}

// ---------------------------------------------------------------- recurrence

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

interface ByDay {
  weekday: number
  /** `2` in `2TU`, `-1` in `-1FR`; null when the entry is a bare weekday. */
  ordinal: number | null
}

type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

interface Rrule {
  freq: Frequency
  interval: number
  count: number | null
  /** Epoch ms, inclusive. */
  until: number | null
  byDay: ByDay[]
  byMonthDay: number[]
  byMonth: number[]
  bySetPos: number[]
  weekStart: number
}

function parseNumberList(value: string): number[] {
  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0)
}

function parseRrule(value: string): Rrule | null {
  const parts = new Map<string, string>()
  for (const pair of value.split(';')) {
    const equals = pair.indexOf('=')
    if (equals < 0) continue
    parts.set(pair.slice(0, equals).trim().toUpperCase(), pair.slice(equals + 1).trim())
  }

  const freq = parts.get('FREQ')?.toUpperCase()
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    // SECONDLY, MINUTELY and HOURLY exist but never appear in a human calendar,
    // and expanding one over a week would produce thousands of occurrences.
    return null
  }

  const byDay: ByDay[] = []
  for (const entry of parts.get('BYDAY')?.split(',') ?? []) {
    const match = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(entry.trim().toUpperCase())
    if (!match) continue
    byDay.push({
      weekday: WEEKDAY_CODES.indexOf(match[2]),
      ordinal: match[1] ? Number(match[1]) : null
    })
  }

  const untilRaw = parts.get('UNTIL')
  const until = untilRaw ? parseDateValue(untilRaw, new Map()) : null
  const count = Number(parts.get('COUNT'))
  const interval = Number(parts.get('INTERVAL'))
  const weekStart = WEEKDAY_CODES.indexOf(parts.get('WKST')?.toUpperCase() ?? 'MO')

  return {
    freq,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    count: Number.isFinite(count) && count > 0 ? count : null,
    until: until ? icsDateToEpoch(until) : null,
    byDay,
    byMonthDay: parseNumberList(parts.get('BYMONTHDAY') ?? ''),
    byMonth: parseNumberList(parts.get('BYMONTH') ?? ''),
    bySetPos: parseNumberList(parts.get('BYSETPOS') ?? ''),
    weekStart: weekStart < 0 ? 1 : weekStart
  }
}

/** The day the period containing `start` begins on, keeping the time of day. */
function periodStart(start: Civil, rule: Rrule): Civil {
  switch (rule.freq) {
    case 'DAILY':
      return start
    case 'WEEKLY': {
      const back = (weekdayOf(start) - rule.weekStart + 7) % 7
      return addDays(start, -back)
    }
    case 'MONTHLY':
      return { ...start, d: 1 }
    case 'YEARLY':
      return { ...start, mo: 1, d: 1 }
  }
}

function advancePeriod(period: Civil, rule: Rrule, periods: number): Civil {
  switch (rule.freq) {
    case 'DAILY':
      return addDays(period, periods * rule.interval)
    case 'WEEKLY':
      return addDays(period, periods * rule.interval * 7)
    case 'MONTHLY':
      return addMonths(period, periods * rule.interval)
    case 'YEARLY':
      return addMonths(period, periods * rule.interval * 12)
  }
}

/** Every day in `[y, mo]` matching a BYDAY entry, ordinals included. */
function monthDaysForByDay(y: number, mo: number, byDay: ByDay[], time: Civil): Civil[] {
  const days: Civil[] = []
  const length = daysInMonth(y, mo)
  for (const { weekday, ordinal } of byDay) {
    const matching: number[] = []
    for (let d = 1; d <= length; d++) {
      if (weekdayOf({ ...time, y, mo, d }) === weekday) matching.push(d)
    }
    if (ordinal === null) {
      for (const d of matching) days.push({ ...time, y, mo, d })
      continue
    }
    const index = ordinal > 0 ? ordinal - 1 : matching.length + ordinal
    const day = matching[index]
    if (day !== undefined) days.push({ ...time, y, mo, d: day })
  }
  return days
}

/** BYMONTHDAY, with negatives counted back from the end of the month. */
function monthDaysForByMonthDay(y: number, mo: number, byMonthDay: number[], time: Civil): Civil[] {
  const length = daysInMonth(y, mo)
  const days: Civil[] = []
  for (const entry of byMonthDay) {
    const d = entry > 0 ? entry : length + entry + 1
    // A rule can name a day the month does not have — the 31st of February is
    // skipped, not clamped.
    if (d >= 1 && d <= length) days.push({ ...time, y, mo, d })
  }
  return days
}

function daysInPeriodMonth(y: number, mo: number, rule: Rrule, start: Civil): Civil[] {
  if (rule.byDay.length > 0) return monthDaysForByDay(y, mo, rule.byDay, start)
  if (rule.byMonthDay.length > 0) return monthDaysForByMonthDay(y, mo, rule.byMonthDay, start)
  return monthDaysForByMonthDay(y, mo, [start.d], start)
}

/** The candidate start days inside one period, in order and deduplicated. */
function candidatesIn(period: Civil, rule: Rrule, start: Civil): Civil[] {
  let days: Civil[]
  switch (rule.freq) {
    case 'DAILY':
      days = [period]
      break
    case 'WEEKLY': {
      const weekdays = rule.byDay.length > 0 ? rule.byDay.map((d) => d.weekday) : [weekdayOf(start)]
      days = weekdays.map((weekday) => addDays(period, (weekday - rule.weekStart + 7) % 7))
      break
    }
    case 'MONTHLY':
      days = daysInPeriodMonth(period.y, period.mo, rule, start)
      break
    case 'YEARLY': {
      const months = rule.byMonth.length > 0 ? rule.byMonth : [start.mo]
      days = months.flatMap((mo) => daysInPeriodMonth(period.y, mo, rule, start))
      break
    }
  }

  // BYDAY and BYMONTH act as filters on the frequencies that do not expand them.
  if (rule.byMonth.length > 0 && rule.freq !== 'YEARLY') {
    days = days.filter((day) => rule.byMonth.includes(day.mo))
  }
  if (rule.byDay.length > 0 && rule.freq === 'DAILY') {
    days = days.filter((day) => rule.byDay.some((entry) => entry.weekday === weekdayOf(day)))
  }

  const seen = new Set<number>()
  days = days
    .sort((a, b) => civilToUtcMs(a) - civilToUtcMs(b))
    .filter((day) => {
      const key = civilToUtcMs(day)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  if (rule.bySetPos.length === 0) return days
  const picked = rule.bySetPos
    .map((pos) => days[pos > 0 ? pos - 1 : days.length + pos])
    .filter((day): day is Civil => day !== undefined)
  return picked.sort((a, b) => civilToUtcMs(a) - civilToUtcMs(b))
}

/**
 * A rule with no COUNT and no end in sight would otherwise be walked one period
 * at a time from its first occurrence, which for a daily event set up years ago
 * is thousands of wasted steps on every refresh.
 */
function periodsToSkip(period: Civil, rule: Rrule, windowStart: number, durationMs: number): number {
  const from = civilToUtcMs(period)
  if (from >= windowStart) return 0
  const gap = windowStart - from
  const perPeriod =
    rule.freq === 'DAILY'
      ? DAY_MS * rule.interval
      : rule.freq === 'WEEKLY'
        ? 7 * DAY_MS * rule.interval
        : rule.freq === 'MONTHLY'
          ? 28 * DAY_MS * rule.interval
          : 365 * DAY_MS * rule.interval
  // Stay a period behind, plus however many periods the event's own length
  // spans, so an occurrence that started before the window but runs into it is
  // not skipped over.
  const slack = Math.ceil(durationMs / perPeriod) + 1
  return Math.max(0, Math.floor(gap / perPeriod) - slack)
}

/** Runaway guard: a malformed rule must not spin forever. */
const MAX_PERIODS = 20_000

// ------------------------------------------------------------------- events

export interface IcsEventDef {
  uid: string
  title: string
  location: string | null
  start: IcsDate
  durationMs: number
  isCancelled: boolean
  rrule: Rrule | null
  /** Instants this rule explicitly skips. */
  exdates: number[]
  /** Set on a VEVENT that replaces one instance of a recurring series. */
  recurrenceId: number | null
}

export interface IcsCalendar {
  /** `X-WR-CALNAME`, when the feed bothers to say. */
  name: string | null
  events: IcsEventDef[]
}

export interface IcsOccurrence {
  id: string
  title: string
  startsAt: number
  endsAt: number
  isAllDay: boolean
  location: string | null
  isCancelled: boolean
}

export function parseIcs(text: string): IcsCalendar {
  const calendar: IcsCalendar = { name: null, events: [] }
  /** BEGIN/END nesting, so a VALARM inside a VEVENT is not mistaken for one. */
  const stack: string[] = []
  let current: Partial<IcsEventDef> & { exdates: number[] } = { exdates: [] }
  let dtend: IcsDate | null = null
  let duration: number | null = null

  const reset = (): void => {
    current = { exdates: [] }
    dtend = null
    duration = null
  }

  for (const raw of unfold(text)) {
    const line = parseLine(raw)
    if (!line) continue

    if (line.name === 'BEGIN') {
      stack.push(line.value.trim().toUpperCase())
      if (stack[stack.length - 1] === 'VEVENT') reset()
      continue
    }

    if (line.name === 'END') {
      const ended = stack.pop()
      if (ended === 'VEVENT' && current.uid && current.start) {
        const startsAt = icsDateToEpoch(current.start)
        const fallback = current.start.kind === 'date' ? DAY_MS : 0
        calendar.events.push({
          uid: current.uid,
          title: current.title || 'Busy',
          location: current.location ?? null,
          start: current.start,
          durationMs: dtend
            ? Math.max(0, icsDateToEpoch(dtend) - startsAt)
            : (duration ?? fallback),
          isCancelled: current.isCancelled ?? false,
          rrule: current.rrule ?? null,
          exdates: current.exdates,
          recurrenceId: current.recurrenceId ?? null
        })
      }
      continue
    }

    if (stack[stack.length - 1] !== 'VEVENT') {
      if (line.name === 'X-WR-CALNAME' && stack[stack.length - 1] === 'VCALENDAR') {
        calendar.name = unescapeText(line.value).trim() || null
      }
      continue
    }

    switch (line.name) {
      case 'UID':
        current.uid = line.value.trim()
        break
      case 'SUMMARY':
        current.title = unescapeText(line.value).trim()
        break
      case 'LOCATION': {
        const location = unescapeText(line.value).trim()
        current.location = location || null
        break
      }
      case 'DTSTART':
        current.start = parseDateValue(line.value, line.params) ?? undefined
        break
      case 'DTEND':
        dtend = parseDateValue(line.value, line.params)
        break
      case 'DURATION':
        duration = parseDuration(line.value)
        break
      case 'STATUS':
        current.isCancelled = line.value.trim().toUpperCase() === 'CANCELLED'
        break
      case 'RRULE':
        current.rrule = parseRrule(line.value)
        break
      case 'RECURRENCE-ID': {
        const at = parseDateValue(line.value, line.params)
        current.recurrenceId = at ? icsDateToEpoch(at) : null
        break
      }
      case 'EXDATE':
        for (const part of line.value.split(',')) {
          const at = parseDateValue(part, line.params)
          if (at) current.exdates.push(icsDateToEpoch(at))
        }
        break
    }
  }

  return calendar
}

/**
 * Every occurrence overlapping `[windowStart, windowEnd)`.
 *
 * A VEVENT carrying a RECURRENCE-ID is a single instance of a series that was
 * moved or renamed; it replaces the instance the rule would otherwise generate,
 * so those instants are held out of the expansion and the override is emitted in
 * its place.
 */
export function expandIcs(
  calendar: IcsCalendar,
  windowStart: number,
  windowEnd: number
): IcsOccurrence[] {
  const overrides = calendar.events.filter((event) => event.recurrenceId !== null)
  const replaced = new Set(overrides.map((event) => `${event.uid}|${event.recurrenceId}`))
  const results: IcsOccurrence[] = []

  const emit = (event: IcsEventDef, startsAt: number): void => {
    const endsAt = startsAt + event.durationMs
    if (endsAt <= windowStart || startsAt >= windowEnd) return
    results.push({
      id: `${event.uid}|${startsAt}`,
      title: event.title,
      startsAt,
      endsAt,
      isAllDay: event.start.kind === 'date',
      location: event.location,
      isCancelled: event.isCancelled
    })
  }

  for (const event of calendar.events) {
    if (event.recurrenceId !== null) {
      emit(event, icsDateToEpoch(event.start))
      continue
    }

    const rule = event.rrule
    if (!rule) {
      emit(event, icsDateToEpoch(event.start))
      continue
    }

    const start = event.start.civil
    const startsAt = icsDateToEpoch(event.start)
    const exdates = new Set(event.exdates)
    let period = periodStart(start, rule)
    let emitted = 0

    // Only safe to jump ahead when nothing depends on the running total.
    if (rule.count === null) {
      const skip = periodsToSkip(period, rule, windowStart, event.durationMs)
      if (skip > 0) period = advancePeriod(period, rule, skip)
    }

    for (let step = 0; step < MAX_PERIODS; step++) {
      let exhausted = false
      for (const candidate of candidatesIn(period, rule, start)) {
        const at = toEpoch(candidate, event.start.kind, event.start.zone)
        if (at < startsAt) continue
        if (rule.until !== null && at > rule.until) {
          exhausted = true
          break
        }
        emitted++
        if (rule.count !== null && emitted > rule.count) {
          exhausted = true
          break
        }
        if (exdates.has(at) || replaced.has(`${event.uid}|${at}`)) continue
        emit(event, at)
      }
      if (exhausted) break
      if (civilToUtcMs(period) > windowEnd + DAY_MS) break
      period = advancePeriod(period, rule, 1)
    }
  }

  return results.sort((a, b) => a.startsAt - b.startsAt)
}
