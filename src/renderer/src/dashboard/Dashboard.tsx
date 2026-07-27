import { useMemo } from 'react'
import { describeWhen, formatClock, formatDuration } from '@shared/display'
import { SEMANTIC_COLORS } from '@shared/status'
import type { SessionRecord } from '@shared/types'
import { useNow } from '@/hooks/useNow'
import { useSnapshot } from '@/hooks/useSnapshot'

const DAY_MS = 86_400_000

function startOfDay(epoch: number): number {
  const date = new Date(epoch)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function focusMsOn(sessions: SessionRecord[], dayStart: number): number {
  return sessions
    .filter((s) => s.mode === 'focus' && s.startedAt >= dayStart && s.startedAt < dayStart + DAY_MS)
    .reduce((total, s) => total + s.actualMs, 0)
}

export function Dashboard(): React.ReactElement {
  const snapshot = useSnapshot()
  const now = useNow()

  const stats = useMemo(() => {
    const sessions = snapshot?.sessions ?? []
    const today = startOfDay(now)
    const days = Array.from({ length: 7 }, (_, i) => {
      const dayStart = today - (6 - i) * DAY_MS
      return { dayStart, focusMs: focusMsOn(sessions, dayStart) }
    })
    const todaySessions = sessions.filter((s) => s.mode === 'focus' && s.startedAt >= today)
    // A streak is consecutive days ending today (or yesterday) with focus time.
    let streak = 0
    for (let i = 0; i < 60; i++) {
      const dayStart = today - i * DAY_MS
      const focusMs = focusMsOn(sessions, dayStart)
      if (focusMs > 0) streak += 1
      else if (i > 0) break
    }
    return {
      days,
      todayMs: focusMsOn(sessions, today),
      todayCount: todaySessions.length,
      completed: todaySessions.filter((s) => s.completed).length,
      streak,
      recent: [...sessions].reverse().slice(0, 12)
    }
  }, [snapshot?.sessions, now])

  if (!snapshot) return <div className="app" aria-busy="true" />

  const dayStart = startOfDay(now)
  const todayEvents = snapshot.calendar.events.filter(
    (event) => event.startsAt < dayStart + DAY_MS && event.endsAt > dayStart
  )
  const peak = Math.max(...stats.days.map((d) => d.focusMs), 25 * 60_000)
  const accent = SEMANTIC_COLORS.focus.accent

  return (
    <div className="app" style={{ '--accent': accent } as React.CSSProperties}>
      <header className="app__titlebar">
        <span className="app__title">Dashboard</span>
      </header>

      <div className="app__body">
        <section className="section">
          <h2 className="section__title">Today</h2>
          <div className="stats">
            <div className="stat">
              <div className="stat__value">{Math.round(stats.todayMs / 60_000)}</div>
              <div className="stat__label">Minutes focused</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.todayCount}</div>
              <div className="stat__label">Sessions</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.completed}</div>
              <div className="stat__label">Completed</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.streak}</div>
              <div className="stat__label">Day streak</div>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">Last 7 days</h2>
          <div className="bars">
            {stats.days.map((day) => (
              <div className="bars__item" key={day.dayStart}>
                <div
                  className="bars__bar"
                  style={{ height: `${Math.max(2, (day.focusMs / peak) * 100)}%` }}
                  title={`${Math.round(day.focusMs / 60_000)} min`}
                />
                <span className="bars__label">
                  {new Date(day.dayStart).toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">
            Today&apos;s schedule
            {snapshot.calendar.source === 'sample' ? ' · sample data' : ''}
          </h2>
          {todayEvents.length === 0 ? (
            <p className="empty">
              {snapshot.calendar.access === 'authorized'
                ? 'No events on your calendar today.'
                : 'Calendar access is not granted — open Settings to allow it.'}
            </p>
          ) : (
            <ul className="list">
              {todayEvents.map((event) => (
                <li className="list__row" key={event.id}>
                  <span>{event.isAllDay ? 'All day' : formatClock(event.startsAt)}</span>
                  <strong>{event.title}</strong>
                  <span>{event.calendar}</span>
                  <span className="tag" data-kind={event.endsAt > now ? 'completed' : undefined}>
                    {event.startsAt <= now && event.endsAt > now
                      ? 'Now'
                      : event.endsAt <= now
                        ? 'Done'
                        : formatClock(event.endsAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="section">
          <h2 className="section__title">Next up</h2>
          {snapshot.calendar.next ? (
            <div className="row">
              <div className="row__text">
                <span className="row__title">{snapshot.calendar.next.title}</span>
                <span className="row__hint">
                  {describeWhen(snapshot.calendar.next.startsAt, now)}
                </span>
              </div>
              <div className="control">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void window.stitch.timer.start({})}
                >
                  Start focus
                </button>
              </div>
            </div>
          ) : (
            <p className="empty">Nothing else scheduled today.</p>
          )}
        </section>

        <section className="section">
          <h2 className="section__title">Recent sessions</h2>
          {stats.recent.length === 0 ? (
            <p className="empty">No sessions yet — start one from the Focus Bar.</p>
          ) : (
            <ul className="list">
              {stats.recent.map((session) => (
                <li className="list__row" key={`${session.id}-${session.endedAt}`}>
                  <span>{formatClock(session.startedAt)}</span>
                  <strong>{session.mode === 'break' ? 'Break' : session.title || 'Focus'}</strong>
                  <span>{formatDuration(session.actualMs)}</span>
                  <span className="tag" data-kind={session.completed ? 'completed' : undefined}>
                    {session.completed ? 'Completed' : 'Stopped'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {stats.recent.length > 0 ? (
            <div className="control">
              <button
                type="button"
                className="button button--danger"
                onClick={() => void window.stitch.sessions.clear()}
              >
                Clear history
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
