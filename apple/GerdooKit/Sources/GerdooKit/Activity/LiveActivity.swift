/// The Live Activity: a running session on the Lock Screen and in the Dynamic
/// Island, which is the phone's answer to the menu bar title on the desktop.
import Foundation

#if canImport(ActivityKit) && os(iOS)
  import ActivityKit
#endif

public struct GerdooActivityAttributes: Codable, Hashable, Sendable {
  public var startedAt: Date

  public init(startedAt: Date) {
    self.startedAt = startedAt
  }

  public struct State: Codable, Hashable, Sendable {
    public var mode: TimerMode
    public var phase: TimerPhase
    /// Nil while paused — the countdown is frozen at `remaining`.
    public var endsAt: Date?
    public var remaining: TimeInterval
    public var title: String
    /// The palette is a user setting, so the colour travels with the state.
    public var accentHex: String

    public init(
      mode: TimerMode, phase: TimerPhase, endsAt: Date?, remaining: TimeInterval,
      title: String, accentHex: String
    ) {
      self.mode = mode
      self.phase = phase
      self.endsAt = endsAt
      self.remaining = remaining
      self.title = title
      self.accentHex = accentHex
    }

    public init(snapshot: AppSnapshot) {
      let palette = paletteFor(
        accentColor: snapshot.settings.accentColor, modeColors: snapshot.settings.modeColors)
      let color: SemanticColor =
        snapshot.timer.phase == .paused
        ? .paused : (snapshot.timer.mode == .break ? .break : .focus)
      self.init(
        mode: snapshot.timer.mode,
        phase: snapshot.timer.phase,
        endsAt: snapshot.timer.endsAt,
        remaining: snapshot.timer.remaining,
        title: snapshot.timer.title,
        accentHex: palette.spec(color).active)
    }

    public var label: String {
      switch phase {
      case .paused: "PAUSED"
      case .completed: mode == .break ? "BREAK OVER" : "SESSION DONE"
      default: mode == .break ? "BREAK" : "FOCUS"
      }
    }
  }
}

#if canImport(ActivityKit) && os(iOS)
  extension GerdooActivityAttributes: ActivityAttributes {
    public typealias ContentState = State
  }
#endif

/// Starts, updates and ends the activity as the timer moves. A no-op anywhere
/// ActivityKit does not exist, so callers do not have to care.
public final class LiveActivityController {
  public static let shared = LiveActivityController()

  private init() {}

  #if canImport(ActivityKit) && os(iOS)
    private var activity: Activity<GerdooActivityAttributes>?

    @MainActor
    public func update(with snapshot: AppSnapshot) {
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
      let state = GerdooActivityAttributes.State(snapshot: snapshot)

      guard snapshot.timer.isActive else {
        let ending = activity
        activity = nil
        Task { await ending?.end(nil, dismissalPolicy: .immediate) }
        return
      }

      if let activity {
        Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
        return
      }

      // Starting one needs the app to be in the foreground; failing that, the
      // next publish while it is tries again.
      activity = try? Activity.request(
        attributes: GerdooActivityAttributes(startedAt: snapshot.timer.startedAt ?? Date()),
        content: ActivityContent(state: state, staleDate: nil),
        pushType: nil)
    }
  #else
    @MainActor
    public func update(with snapshot: AppSnapshot) {}
  #endif
}
