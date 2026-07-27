/// What a widget or a complication needs to draw itself.
///
/// Extensions cannot talk to `GerdooModel` — they are separate processes with no
/// timers and no lifecycle. They read the same App Group record the app writes
/// on every publish, which is why `SharedStore` lives in defaults rather than a
/// container file.
import Foundation
import SwiftUI
import WidgetKit

public struct GerdooEntry: TimelineEntry {
  public var date: Date
  public var snapshot: AppSnapshot

  public init(date: Date, snapshot: AppSnapshot) {
    self.date = date
    self.snapshot = snapshot
  }

  public var content: LedContent { widgetContent(snapshot, now: date) }

  public var palette: Palette {
    paletteFor(
      accentColor: snapshot.settings.accentColor, modeColors: snapshot.settings.modeColors)
  }

  public var accent: Color { palette.spec(content.color).accentColor }
}

extension SharedStore {
  /// The app's last published state, as a snapshot.
  public func snapshot() -> AppSnapshot {
    let state = load()
    return AppSnapshot(
      timer: state.timer ?? TimerState(),
      status: state.status,
      calendar: state.calendar,
      settings: state.settings,
      sessions: state.sessions,
      updatedAt: Date())
  }
}

public enum GerdooTimeline {
  /// A stand-in for the widget gallery, which renders before any real state exists.
  public static var placeholder: GerdooEntry {
    var snapshot = AppSnapshot()
    snapshot.timer = TimerState(
      phase: .running, duration: 1500, remaining: 1471,
      endsAt: Date().addingTimeInterval(1471), startedAt: Date(), title: "DEEP WORK")
    return GerdooEntry(date: Date(), snapshot: snapshot)
  }

  /// Entries for the next hour.
  ///
  /// The panel is a dot grid, not a live text field, so it cannot count seconds
  /// on its own the way `Text(_:style: .timer)` can. Instead one entry is
  /// written per minute boundary and the countdown is drawn to the minute — a
  /// widget that claims a precision it cannot keep would just be wrong for 59
  /// seconds out of every 60.
  public static func entries(from now: Date = Date(), store: SharedStore = SharedStore())
    -> [GerdooEntry]
  {
    let snapshot = store.snapshot()
    guard snapshot.timer.phase == .running, let endsAt = snapshot.timer.endsAt else {
      return [GerdooEntry(date: now, snapshot: snapshot)]
    }

    var entries = [GerdooEntry(date: now, snapshot: snapshot)]
    var cursor = now
    // Land on the next whole minute of the remaining time, then every minute.
    let offset = endsAt.timeIntervalSince(now).truncatingRemainder(dividingBy: 60)
    cursor = cursor.addingTimeInterval(offset > 0 ? offset : 60)
    while cursor <= endsAt, entries.count < 60 {
      entries.append(GerdooEntry(date: cursor, snapshot: snapshot))
      cursor = cursor.addingTimeInterval(60)
    }
    if entries.last?.date != endsAt {
      entries.append(GerdooEntry(date: endsAt, snapshot: snapshot))
    }
    return entries
  }

  /// When to come back: the moment the session ends, or in a quarter of an hour
  /// if nothing is running.
  public static func reloadPolicy(_ entries: [GerdooEntry]) -> TimelineReloadPolicy {
    .after(entries.last?.date.addingTimeInterval(1) ?? Date().addingTimeInterval(900))
  }
}

/// The countdown as a widget can honestly show it: whole minutes remaining.
public func widgetCountdown(_ snapshot: AppSnapshot, now: Date) -> String {
  let left = remaining(snapshot.timer, now: now)
  return formatDuration((left / 60).rounded(.down) * 60)
}

/// The panel's own content, with the countdown pulled back to minute resolution.
public func widgetContent(_ snapshot: AppSnapshot, now: Date) -> LedContent {
  var content = deriveLedContent(snapshot, now: now)
  if snapshot.timer.phase == .running {
    content.big = widgetCountdown(snapshot, now: now)
  }
  return content
}
