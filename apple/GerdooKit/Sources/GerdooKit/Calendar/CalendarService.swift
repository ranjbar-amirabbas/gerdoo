/// Where events come from, behind one interface — the same shape as
/// `CalendarProvider` in `src/main/calendar.ts`, so nothing downstream knows
/// which source answered.
import Foundation

#if canImport(EventKit) && os(iOS)
  import EventKit
#endif

/// The same span the desktop reads.
public let calendarWindowDays = 7

public protocol CalendarProvider {
  func listEvents(now: Date) async -> (access: CalendarAccess, events: [CalendarEvent])
}

/// Sample schedule — useful for a first run, a screenshot, and any device where
/// system access is unavailable.
public struct SampleCalendarProvider: CalendarProvider {
  private struct Template {
    var title: String
    var hour: Int
    var minute: Int
    var minutes: Int
  }

  private let templates = [
    Template(title: "STANDUP", hour: 9, minute: 30, minutes: 15),
    Template(title: "TEAM SYNC", hour: 11, minute: 30, minutes: 30),
    Template(title: "DESIGN REVIEW", hour: 14, minute: 0, minutes: 45),
    Template(title: "1:1 WITH SAM", hour: 16, minute: 30, minutes: 25)
  ]

  public init() {}

  public func listEvents(now: Date) async -> (access: CalendarAccess, events: [CalendarEvent]) {
    let calendar = Calendar.current
    var events: [CalendarEvent] = []
    for dayOffset in 0..<calendarWindowDays {
      guard let day = calendar.date(byAdding: .day, value: dayOffset, to: now) else { continue }
      for template in templates {
        var parts = calendar.dateComponents([.year, .month, .day], from: day)
        parts.hour = template.hour
        parts.minute = template.minute
        guard let startsAt = calendar.date(from: parts) else { continue }
        events.append(
          CalendarEvent(
            id: "sample-\(dayOffset)-\(template.hour)-\(template.minute)",
            title: template.title,
            startsAt: startsAt,
            endsAt: startsAt.addingTimeInterval(TimeInterval(template.minutes) * 60),
            calendar: "Sample"))
      }
    }
    return (.sample, events)
  }
}

#if canImport(EventKit) && os(iOS)
  /// The device's own calendars, through EventKit. A feed the user subscribed to
  /// in Settings is already one of these, which is why there is no separate ICS
  /// reader here the way there is on the desktop.
  public struct SystemCalendarProvider: CalendarProvider {
    private let store = EKEventStore()

    public init() {}

    public static var access: CalendarAccess {
      switch EKEventStore.authorizationStatus(for: .event) {
      case .fullAccess: .authorized
      case .denied: .denied
      case .restricted: .restricted
      case .notDetermined: .notDetermined
      // Write-only is granted for adding events, and cannot read one back.
      case .writeOnly: .denied
      @unknown default: .error
      }
    }

    @discardableResult
    public func requestAccess() async -> CalendarAccess {
      do {
        _ = try await store.requestFullAccessToEvents()
      } catch {
        return .error
      }
      return Self.access
    }

    public func listEvents(now: Date) async -> (access: CalendarAccess, events: [CalendarEvent]) {
      let access = Self.access
      guard access == .authorized else { return (access, []) }
      let end =
        Calendar.current.date(byAdding: .day, value: calendarWindowDays, to: now) ?? now
      let predicate = store.predicateForEvents(withStart: now, end: end, calendars: nil)
      let events = store.events(matching: predicate)
        .compactMap { event -> CalendarEvent? in
          guard let start = event.startDate, let end = event.endDate else { return nil }
          // A declined invitation is not a meeting you are in.
          if event.status == .canceled { return nil }
          return CalendarEvent(
            id: event.eventIdentifier ?? "\(start.timeIntervalSince1970)-\(event.title ?? "")",
            title: event.title ?? "BUSY",
            startsAt: start,
            endsAt: end,
            isAllDay: event.isAllDay,
            calendar: event.calendar?.title,
            location: event.location)
        }
        .sorted { $0.startsAt < $1.startsAt }
      return (.authorized, events)
    }
  }
#endif

public final class CalendarService {
  private let sample = SampleCalendarProvider()
  #if canImport(EventKit) && os(iOS)
    private let system = SystemCalendarProvider()
  #endif

  public init() {}

  /// Where the system source stands right now, without prompting.
  public var systemAccess: CalendarAccess {
    #if canImport(EventKit) && os(iOS)
      return SystemCalendarProvider.access
    #else
      // The watch reads the phone's events over the link rather than asking for
      // calendar access of its own.
      return .unavailable
    #endif
  }

  @discardableResult
  public func requestSystemAccess() async -> CalendarAccess {
    #if canImport(EventKit) && os(iOS)
      return await system.requestAccess()
    #else
      return .unavailable
    #endif
  }

  /// Reads `source`, and falls back to the sample schedule when the system
  /// source cannot answer — stale events beat invented meetings, so a cached
  /// read is preferred over this by the caller.
  public func load(source: CalendarSource, now: Date = Date()) async -> CalendarState {
    var result: (access: CalendarAccess, events: [CalendarEvent])
    switch source {
    case .sample:
      result = await sample.listEvents(now: now)
    case .system:
      #if canImport(EventKit) && os(iOS)
        result = await system.listEvents(now: now)
      #else
        result = (.unavailable, [])
      #endif
    }

    var detail: String?
    if source == .system, result.access != .authorized {
      detail = describe(result.access)
    }

    return state(
      events: result.events, access: result.access, source: source, detail: detail, now: now)
  }

  /// Recomputes `current` and `next` from a set of events — cheap enough to run
  /// on every tick, so a meeting starting does not wait for the next refresh.
  public func state(
    events: [CalendarEvent], access: CalendarAccess, source: CalendarSource,
    detail: String? = nil, now: Date = Date()
  ) -> CalendarState {
    let sorted = events.sorted { $0.startsAt < $1.startsAt }
    // All-day events never count as "now" — see `autoOnCall`.
    let current = sorted.first { !$0.isAllDay && $0.startsAt <= now && $0.endsAt > now }
    let next = sorted.first { $0.startsAt > now }
    return CalendarState(
      current: current, next: next, events: sorted, access: access, source: source,
      detail: detail)
  }

  private func describe(_ access: CalendarAccess) -> String? {
    switch access {
    case .denied: "Calendar access was denied. Allow it in Settings › Privacy › Calendars."
    case .restricted: "Calendar access is restricted on this device."
    case .notDetermined: "Calendar access has not been granted yet."
    case .unavailable: "Calendar events come from your iPhone."
    case .error: "The calendar could not be read."
    case .authorized, .sample: nil
    }
  }
}
