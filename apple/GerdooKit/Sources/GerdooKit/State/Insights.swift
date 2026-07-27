/// The numbers the Dashboard shows, ported from
/// `src/renderer/src/dashboard/Dashboard.tsx` so the phone and the desktop count
/// a day, a session and a streak the same way.
import Foundation

public struct DayFocus: Identifiable, Equatable, Sendable {
  public var dayStart: Date
  public var focus: TimeInterval
  public var id: Date { dayStart }
}

public struct FocusStats: Equatable, Sendable {
  public var days: [DayFocus]
  public var today: TimeInterval
  public var todayCount: Int
  public var completed: Int
  public var streak: Int
}

/// Focus time started on a given day. Breaks do not count, and a session belongs
/// to the day it *started* — a session that runs past midnight is not split.
public func focusTime(
  _ sessions: [SessionRecord], on dayStart: Date, calendar: Calendar = .current
) -> TimeInterval {
  let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart
  return sessions
    .filter { $0.mode == .focus && $0.startedAt >= dayStart && $0.startedAt < dayEnd }
    .reduce(0) { $0 + $1.actual }
}

public func focusStats(
  _ sessions: [SessionRecord], now: Date, calendar: Calendar = .current, days dayCount: Int = 7
) -> FocusStats {
  let today = calendar.startOfDay(for: now)
  let days: [DayFocus] = (0..<dayCount).reversed().map { offset in
    let dayStart = calendar.date(byAdding: .day, value: -offset, to: today) ?? today
    return DayFocus(dayStart: dayStart, focus: focusTime(sessions, on: dayStart, calendar: calendar))
  }
  let todaySessions = sessions.filter { $0.mode == .focus && $0.startedAt >= today }

  // A streak is consecutive days ending today — or yesterday, so a day that has
  // not been used yet does not read as a broken one.
  var streak = 0
  for offset in 0..<60 {
    let dayStart = calendar.date(byAdding: .day, value: -offset, to: today) ?? today
    if focusTime(sessions, on: dayStart, calendar: calendar) > 0 {
      streak += 1
    } else if offset > 0 {
      break
    }
  }

  return FocusStats(
    days: days,
    today: focusTime(sessions, on: today, calendar: calendar),
    todayCount: todaySessions.count,
    completed: todaySessions.filter(\.completed).count,
    streak: streak)
}

/// `2h 05m` past an hour, `45m` under it — the desktop's `formatBooked`.
public func formatBooked(_ interval: TimeInterval) -> String {
  let minutes = Int((interval / 60).rounded())
  let hours = minutes / 60
  let rest = minutes % 60
  if hours > 0 { return "\(hours)h \(pad2(rest))m" }
  return "\(rest)m"
}

public struct CalendarDay: Identifiable, Equatable, Sendable {
  public var dayStart: Date
  public var label: String
  public var events: [CalendarEvent]
  public var booked: TimeInterval
  public var id: Date { dayStart }
}

/// Upcoming events grouped by day, skipping what has already finished.
public func groupByDay(
  _ events: [CalendarEvent], now: Date, calendar: Calendar = .current
) -> [CalendarDay] {
  var buckets: [Date: [CalendarEvent]] = [:]
  for event in events where event.endsAt >= now {
    buckets[calendar.startOfDay(for: event.startsAt), default: []].append(event)
  }
  let today = calendar.startOfDay(for: now)
  return buckets.keys.sorted().map { dayStart in
    let day = (buckets[dayStart] ?? []).sorted { $0.startsAt < $1.startsAt }
    let booked = day.filter { !$0.isAllDay }
      .reduce(0) { $0 + $1.endsAt.timeIntervalSince($1.startsAt) }
    return CalendarDay(
      dayStart: dayStart, label: dayLabel(dayStart, today: today, calendar: calendar),
      events: day, booked: booked)
  }
}

func dayLabel(_ dayStart: Date, today: Date, calendar: Calendar = .current) -> String {
  let days = calendar.dateComponents([.day], from: today, to: dayStart).day ?? 0
  if days == 0 { return "Today" }
  if days == 1 { return "Tomorrow" }
  return dayStart.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
}
