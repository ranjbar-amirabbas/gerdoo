import { useEffect, useMemo, useRef } from 'react'
import type { SessionRecord } from '@shared/types'

/** Columns in the grid — 53 weeks is a full year plus the current partial week. */
const WEEKS = 53
const DAYS_PER_WEEK = 7
/** Row indices that get a weekday caption, matching GitHub's Mon/Wed/Fri. */
const LABELLED_ROWS = [1, 3, 5]
/** Shades above zero. A day is placed on this scale relative to the best day. */
const LEVELS = 4

interface Day {
  key: string
  date: Date
  focusMs: number
  level: number
  inFuture: boolean
}

interface HeatmapProps {
  sessions: SessionRecord[]
  now: number
}

/**
 * Local calendar key. Bucketing by `YYYY-MM-DD` rather than by epoch arithmetic
 * keeps the grid correct across DST shifts, where a day is 23 or 25 hours long.
 */
function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Total focus milliseconds per local day, keyed by `dayKey`. */
function focusByDay(sessions: SessionRecord[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const session of sessions) {
    if (session.mode !== 'focus') continue
    const key = dayKey(new Date(session.startedAt))
    totals.set(key, (totals.get(key) ?? 0) + session.actualMs)
  }
  return totals
}

/**
 * The grid always starts on a Sunday so every column is a whole week, and ends
 * on the Saturday of the current week — today therefore sits in the last column.
 */
function buildGrid(
  sessions: SessionRecord[],
  dayStart: number
): { days: Day[]; totalMs: number; activeDays: number } {
  const totals = focusByDay(sessions)
  const today = new Date(dayStart)
  const start = addDays(today, -(today.getDay() + (WEEKS - 1) * DAYS_PER_WEEK))

  // Scale to the best day in the window, with a floor so a single short session
  // on an otherwise empty history does not light up as a perfect day.
  const cells: Day[] = []
  let peakMs = 25 * 60_000
  let totalMs = 0
  let activeDays = 0

  for (let i = 0; i < WEEKS * DAYS_PER_WEEK; i++) {
    const date = addDays(start, i)
    const key = dayKey(date)
    const focusMs = totals.get(key) ?? 0
    const inFuture = date.getTime() > dayStart
    if (!inFuture) {
      totalMs += focusMs
      peakMs = Math.max(peakMs, focusMs)
      if (focusMs > 0) activeDays += 1
    }
    cells.push({ key, date, focusMs, level: 0, inFuture })
  }

  for (const cell of cells) {
    cell.level = cell.focusMs === 0 ? 0 : Math.max(1, Math.ceil((cell.focusMs / peakMs) * LEVELS))
  }

  return { days: cells, totalMs, activeDays }
}

function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes === 0) return 'No focus'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Columns a month label needs before the next one starts overlapping it. */
const LABEL_COLUMNS = 3

/** `Jan` above the first column of each month, dropping months too narrow to label. */
function monthLabels(days: Day[]): { column: number; label: string }[] {
  const starts: { column: number; label: string }[] = []
  for (let week = 0; week < WEEKS; week++) {
    const first = days[week * DAYS_PER_WEEK]
    const previous = week === 0 ? null : days[(week - 1) * DAYS_PER_WEEK]
    if (previous && previous.date.getMonth() === first.date.getMonth()) continue
    starts.push({
      column: week + 1,
      label: first.date.toLocaleDateString(undefined, { month: 'short' })
    })
  }
  // The window starts and ends mid-month, so the first and last months own only
  // a sliver of the grid; labelling them would collide with their neighbour.
  return starts.filter((start, i) => {
    const next = starts[i + 1]?.column ?? WEEKS + 1
    return next - start.column >= LABEL_COLUMNS
  })
}

/** A year of focus time as a GitHub-style contribution grid. */
export function Heatmap({ sessions, now }: HeatmapProps): React.ReactElement {
  const scroller = useRef<HTMLDivElement>(null)
  // The grid only changes when the day rolls over, not on every clock tick.
  const dayStart = new Date(now).setHours(0, 0, 0, 0)
  const { days, totalMs, activeDays } = useMemo(
    () => buildGrid(sessions, dayStart),
    [sessions, dayStart]
  )
  const months = useMemo(() => monthLabels(days), [days])

  // On a narrow window the grid overflows; the recent weeks are what matter.
  useEffect(() => {
    const node = scroller.current
    if (node) node.scrollLeft = node.scrollWidth
  }, [])

  const columns = { gridTemplateColumns: `repeat(${WEEKS}, var(--cell))` }

  return (
    <div className="heatmap">
      <div className="heatmap__summary">
        {activeDays === 0 ? (
          'No focus sessions in the last year — the grid fills in as you run them.'
        ) : (
          <>
            {formatMinutes(totalMs)} focused over {activeDays} day{activeDays === 1 ? '' : 's'} in
            the last year
          </>
        )}
      </div>

      <div className="heatmap__scroll" ref={scroller}>
        <div className="heatmap__chart">
          <div className="heatmap__months" style={columns} aria-hidden="true">
            {months.map((month) => (
              <span
                className="heatmap__month"
                key={`${month.label}-${month.column}`}
                style={{ gridColumn: month.column }}
              >
                {month.label}
              </span>
            ))}
          </div>

          <div className="heatmap__weekdays" aria-hidden="true">
            {Array.from({ length: DAYS_PER_WEEK }, (_, row) => (
              <span className="heatmap__weekday" key={row}>
                {LABELLED_ROWS.includes(row)
                  ? new Date(2024, 0, 7 + row).toLocaleDateString(undefined, { weekday: 'short' })
                  : ''}
              </span>
            ))}
          </div>

          <div className="heatmap__cells" style={columns} role="grid" aria-label="Focus per day">
            {days.map((day) =>
              day.inFuture ? (
                <span className="heatmap__cell heatmap__cell--empty" key={day.key} />
              ) : (
                <span
                  className="heatmap__cell"
                  key={day.key}
                  data-level={day.level}
                  role="gridcell"
                  title={`${formatMinutes(day.focusMs)} — ${formatDay(day.date)}`}
                  aria-label={`${formatMinutes(day.focusMs)} on ${formatDay(day.date)}`}
                />
              )
            )}
          </div>
        </div>
      </div>

      <div className="heatmap__legend">
        <span>Less</span>
        {Array.from({ length: LEVELS + 1 }, (_, level) => (
          <span className="heatmap__cell" key={level} data-level={level} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
