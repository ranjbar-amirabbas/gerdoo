/// The domain, ported from `src/shared/types.ts`.
///
/// One difference runs through the whole file: the desktop app passes epoch
/// milliseconds as plain numbers, and this one uses `Date` and `TimeInterval`.
/// That is not taste — watchOS builds for `arm64_32`, where `Int` is 32 bits and
/// an epoch in milliseconds overflows it. Serialisation still crosses the wire
/// as seconds, so nothing has to carry a 64-bit integer.
import Foundation

public enum StatusID: String, Codable, CaseIterable, Sendable {
  case available
  case oncall
  case meeting
  case dnd
  case custom
}

public enum TimerMode: String, Codable, Sendable {
  case focus
  case `break`
}

/// The device's modes, as the colour system sees them: the two timer modes, the
/// paused state, and one per status. `Status.swift` gives each a colour spec.
public enum SemanticColor: String, Codable, CaseIterable, Sendable {
  case focus
  case `break`
  case paused
  case oncall
  case meeting
  case available
  case dnd
}

/// Without this a `[SemanticColor: String]` encodes as a flat array of
/// alternating keys and values, which is legal but unreadable on the wire.
extension SemanticColor: CodingKeyRepresentable {
  private struct Key: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }

  public var codingKey: CodingKey { Key(stringValue: rawValue) }

  public init?<T: CodingKey>(codingKey: T) {
    self.init(rawValue: codingKey.stringValue)
  }
}

/// Per-mode `#rrggbb` overrides. A mode with no entry follows the accent.
public typealias ModeColors = [SemanticColor: String]

public enum TimerPhase: String, Codable, Sendable {
  case idle
  case running
  case paused
  case completed
}

public struct TimerState: Codable, Equatable, Sendable {
  public var mode: TimerMode
  public var phase: TimerPhase
  /// Planned duration of the current session.
  public var duration: TimeInterval
  /// Time left. Authoritative while paused/idle.
  public var remaining: TimeInterval
  /// Wall-clock deadline while running, nil otherwise.
  public var endsAt: Date?
  /// When the current session started, nil when idle.
  public var startedAt: Date?
  public var title: String

  public init(
    mode: TimerMode = .focus,
    phase: TimerPhase = .idle,
    duration: TimeInterval = 25 * 60,
    remaining: TimeInterval = 25 * 60,
    endsAt: Date? = nil,
    startedAt: Date? = nil,
    title: String = "DEEP WORK"
  ) {
    self.mode = mode
    self.phase = phase
    self.duration = duration
    self.remaining = remaining
    self.endsAt = endsAt
    self.startedAt = startedAt
    self.title = title
  }

  /// True while a session exists at all — running or held.
  public var isActive: Bool { phase == .running || phase == .paused }
}

public struct StatusState: Codable, Equatable, Sendable {
  public var id: StatusID
  /// Free-form label used when `id == .custom`.
  public var customLabel: String
  /// Optional "until" hint — drives BACK AT / UNTIL sub-labels.
  public var until: Date?

  public init(id: StatusID = .available, customLabel: String = "", until: Date? = nil) {
    self.id = id
    self.customLabel = customLabel
    self.until = until
  }
}

public struct CalendarEvent: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  public var title: String
  public var startsAt: Date
  public var endsAt: Date
  public var isAllDay: Bool
  /// Name of the calendar the event belongs to.
  public var calendar: String?
  public var location: String?

  public init(
    id: String,
    title: String,
    startsAt: Date,
    endsAt: Date,
    isAllDay: Bool = false,
    calendar: String? = nil,
    location: String? = nil
  ) {
    self.id = id
    self.title = title
    self.startsAt = startsAt
    self.endsAt = endsAt
    self.isAllDay = isAllDay
    self.calendar = calendar
    self.location = location
  }
}

/// Where events come from.
///
/// The desktop app also offers a subscribed `.ics` feed, because it has nowhere
/// else to get events on Windows. iOS subscribes to feeds at the system level,
/// so a feed the user cares about is already in EventKit — reading it twice
/// would only be a second, worse iCalendar parser.
public enum CalendarSource: String, Codable, CaseIterable, Sendable {
  case system
  case sample
}

public enum CalendarAccess: String, Codable, Sendable {
  case authorized
  case denied
  case restricted
  case notDetermined
  /// EventKit is not reachable from this process (the watch, in practice).
  case unavailable
  case error
  /// Not a permission state — the sample source needs none.
  case sample
}

public struct CalendarState: Codable, Equatable, Sendable {
  /// The event happening right now, if any.
  public var current: CalendarEvent?
  /// The next upcoming event, if any.
  public var next: CalendarEvent?
  public var events: [CalendarEvent]
  public var access: CalendarAccess
  public var source: CalendarSource
  /// Why the last read failed, when there is something worth saying.
  public var detail: String?

  public init(
    current: CalendarEvent? = nil,
    next: CalendarEvent? = nil,
    events: [CalendarEvent] = [],
    access: CalendarAccess = .notDetermined,
    source: CalendarSource = .system,
    detail: String? = nil
  ) {
    self.current = current
    self.next = next
    self.events = events
    self.access = access
    self.source = source
    self.detail = detail
  }
}

public struct SessionRecord: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  public var mode: TimerMode
  public var title: String
  public var startedAt: Date
  public var endedAt: Date
  public var planned: TimeInterval
  /// Time actually spent running (excludes paused time).
  public var actual: TimeInterval
  public var completed: Bool

  public init(
    id: String,
    mode: TimerMode,
    title: String,
    startedAt: Date,
    endedAt: Date,
    planned: TimeInterval,
    actual: TimeInterval,
    completed: Bool
  ) {
    self.id = id
    self.mode = mode
    self.title = title
    self.startedAt = startedAt
    self.endedAt = endedAt
    self.planned = planned
    self.actual = actual
    self.completed = completed
  }
}

public struct Settings: Codable, Equatable, Sendable {
  /// Focus presets in minutes, shown in the preset selector.
  public var presets: [Int]
  public var selectedPresetIndex: Int
  public var breakMinutes: Int
  public var soundEnabled: Bool
  public var hapticsEnabled: Bool
  /// 0.35 – 1. Scales LED pixel intensity.
  public var brightness: Double
  /// `#rrggbb` the whole palette is derived from, or nil for the built-in
  /// multi-hue one. See `Palette.swift`.
  public var accentColor: String?
  /// Modes given a colour of their own, which wins over `accentColor`.
  public var modeColors: ModeColors
  /// nil = follow the system reduced-motion setting.
  public var reduceMotion: Bool?
  public var autoStartBreak: Bool
  /// Start the next focus session as soon as a break ends.
  public var autoStartFocus: Bool
  public var defaultTitle: String
  public var calendarSource: CalendarSource
  /// Switch to ON CALL for the length of a calendar event, then put the previous
  /// status back. All-day events never count as "now", so they never trigger it.
  public var autoOnCall: Bool
  /// Keep the screen lit while a session runs (iPhone only).
  public var keepAwake: Bool
  /// Notify when a session ends. The app is usually in the user's pocket, so
  /// this defaults on where the desktop app relies on a visible window.
  public var notifyOnComplete: Bool

  public static let `default` = Settings(
    presets: [15, 25, 35, 50],
    selectedPresetIndex: 1,
    breakMinutes: 5,
    soundEnabled: true,
    hapticsEnabled: true,
    brightness: 0.85,
    accentColor: nil,
    modeColors: [:],
    reduceMotion: nil,
    autoStartBreak: false,
    autoStartFocus: false,
    defaultTitle: "DEEP WORK",
    calendarSource: .system,
    autoOnCall: true,
    keepAwake: false,
    notifyOnComplete: true
  )

  public init(
    presets: [Int],
    selectedPresetIndex: Int,
    breakMinutes: Int,
    soundEnabled: Bool,
    hapticsEnabled: Bool,
    brightness: Double,
    accentColor: String?,
    modeColors: ModeColors,
    reduceMotion: Bool?,
    autoStartBreak: Bool,
    autoStartFocus: Bool,
    defaultTitle: String,
    calendarSource: CalendarSource,
    autoOnCall: Bool,
    keepAwake: Bool,
    notifyOnComplete: Bool
  ) {
    self.presets = presets
    self.selectedPresetIndex = selectedPresetIndex
    self.breakMinutes = breakMinutes
    self.soundEnabled = soundEnabled
    self.hapticsEnabled = hapticsEnabled
    self.brightness = brightness
    self.accentColor = accentColor
    self.modeColors = modeColors
    self.reduceMotion = reduceMotion
    self.autoStartBreak = autoStartBreak
    self.autoStartFocus = autoStartFocus
    self.defaultTitle = defaultTitle
    self.calendarSource = calendarSource
    self.autoOnCall = autoOnCall
    self.keepAwake = keepAwake
    self.notifyOnComplete = notifyOnComplete
  }

  /// The preset currently selected, clamped — a state file can carry anything.
  public var selectedMinutes: Int {
    guard !presets.isEmpty else { return 25 }
    let index = min(max(0, selectedPresetIndex), presets.count - 1)
    return presets[index]
  }
}

/// A `Settings` decoded from an older or newer build is missing keys rather than
/// invalid, so every field falls back to the default instead of failing the load.
extension Settings {
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let fallback = Settings.default
    func value<T: Decodable>(_ key: CodingKeys, _ fallback: T) -> T {
      ((try? container.decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback
    }
    presets = value(.presets, fallback.presets)
    selectedPresetIndex = value(.selectedPresetIndex, fallback.selectedPresetIndex)
    breakMinutes = value(.breakMinutes, fallback.breakMinutes)
    soundEnabled = value(.soundEnabled, fallback.soundEnabled)
    hapticsEnabled = value(.hapticsEnabled, fallback.hapticsEnabled)
    brightness = value(.brightness, fallback.brightness)
    accentColor = try? container.decodeIfPresent(String.self, forKey: .accentColor)
    modeColors = value(.modeColors, fallback.modeColors)
    reduceMotion = try? container.decodeIfPresent(Bool.self, forKey: .reduceMotion)
    autoStartBreak = value(.autoStartBreak, fallback.autoStartBreak)
    autoStartFocus = value(.autoStartFocus, fallback.autoStartFocus)
    defaultTitle = value(.defaultTitle, fallback.defaultTitle)
    calendarSource = value(.calendarSource, fallback.calendarSource)
    autoOnCall = value(.autoOnCall, fallback.autoOnCall)
    keepAwake = value(.keepAwake, fallback.keepAwake)
    notifyOnComplete = value(.notifyOnComplete, fallback.notifyOnComplete)
  }
}

/// Everything a view — or a widget, or the other wrist — needs to render.
public struct AppSnapshot: Codable, Equatable, Sendable {
  public var timer: TimerState
  public var status: StatusState
  public var calendar: CalendarState
  public var settings: Settings
  public var sessions: [SessionRecord]
  /// When the snapshot was produced. Sync uses it to settle a race.
  public var updatedAt: Date

  public init(
    timer: TimerState = TimerState(),
    status: StatusState = StatusState(),
    calendar: CalendarState = CalendarState(),
    settings: Settings = .default,
    sessions: [SessionRecord] = [],
    updatedAt: Date = Date()
  ) {
    self.timer = timer
    self.status = status
    self.calendar = calendar
    self.settings = settings
    self.sessions = sessions
    self.updatedAt = updatedAt
  }
}

/// Session records kept on device. The heatmap looks back a full year, so the
/// cap has to outlast that.
public let maxStoredSessions = 2000
