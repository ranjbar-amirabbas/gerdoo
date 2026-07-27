/// Persistence, ported in spirit from `src/main/store.ts`.
///
/// The desktop app writes an atomic JSON file in `userData`. Here the same
/// record goes into the App Group's `UserDefaults`, because the widgets and the
/// complications have to read it without launching the app — a container file
/// would need a coordinated read from every extension.
import Foundation
import os

public enum GerdooDefaults {
  /// Keep in step with the App Group in every target's entitlements.
  public static let appGroup = "group.com.amirabbasranjbar.gerdoo"

  /// The shared suite, or the target's own defaults when the group is not
  /// provisioned — an unsigned local build still has to run.
  public static let shared: UserDefaults =
    UserDefaults(suiteName: appGroup) ?? .standard

  static let stateKey = "gerdoo.state"
}

/// Everything that survives a relaunch.
public struct PersistedState: Codable, Sendable {
  public var version = 1
  public var settings = Settings.default
  public var status = StatusState()
  /// Set while a calendar event is holding the status at ON CALL — see
  /// `AutoStatus.swift`. Persisted so a relaunch mid-meeting still knows to
  /// hand the status back afterwards.
  public var autoStatus: AutoStatusHold?
  /// Saved so an interrupted session survives being killed in the app switcher.
  public var timer: TimerState?
  public var sessions: [SessionRecord] = []
  /// Last successful calendar read, so the panel has data before the first refresh.
  public var calendar = CalendarState()

  public init() {}
}

public struct SharedStore {
  private let defaults: UserDefaults
  private static let log = Logger(subsystem: "com.amirabbasranjbar.gerdoo", category: "store")

  public init(defaults: UserDefaults = GerdooDefaults.shared) {
    self.defaults = defaults
  }

  public func load() -> PersistedState {
    guard let data = defaults.data(forKey: GerdooDefaults.stateKey) else { return PersistedState() }
    do {
      return try JSONDecoder().decode(PersistedState.self, from: data)
    } catch {
      // A state file we cannot read is worth losing, not worth crashing over.
      Self.log.error("discarding unreadable state: \(String(describing: error))")
      return PersistedState()
    }
  }

  public func save(_ state: PersistedState) {
    var trimmed = state
    if trimmed.sessions.count > maxStoredSessions {
      trimmed.sessions = Array(trimmed.sessions.suffix(maxStoredSessions))
    }
    // The calendar cache is for showing something before the first refresh; the
    // whole week would be a megabyte of defaults for no gain.
    trimmed.calendar.events = Array(trimmed.calendar.events.prefix(64))
    guard let data = try? JSONEncoder().encode(trimmed) else { return }
    defaults.set(data, forKey: GerdooDefaults.stateKey)
  }
}
