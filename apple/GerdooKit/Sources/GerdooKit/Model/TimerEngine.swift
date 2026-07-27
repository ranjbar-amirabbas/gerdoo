/// The authoritative timer, ported from `src/main/timer.ts`.
///
/// It stores a wall-clock **deadline**, not a countdown. A suspended app, a
/// dropped tick or a wrist that dropped for an hour cannot make it drift; the
/// deadline is re-checked whenever the app comes back to the foreground. The
/// running session is persisted, so quitting mid-session and reopening resumes it.
import Foundation

public final class TimerEngine {
  public private(set) var state: TimerState

  public var onChange: (() -> Void)?
  public var onTick: (() -> Void)?
  public var onComplete: ((SessionRecord) -> Void)?
  /// Fired when a start switches focus <-> break, so callers can cue the change.
  public var onModeChange: ((TimerMode) -> Void)?

  /// Injectable so tests do not have to wait out a real deadline.
  private let clock: () -> Date
  private var ticker: Timer?
  /// Running time accumulated before the current run segment (excludes pauses).
  private var accumulated: TimeInterval = 0
  private var segmentStartedAt: Date?

  public init(
    restored: TimerState?,
    defaultMinutes: Int,
    defaultTitle: String,
    clock: @escaping () -> Date = Date.init
  ) {
    self.clock = clock
    state =
      restored
      ?? TimerState(
        duration: TimeInterval(defaultMinutes) * 60,
        remaining: TimeInterval(defaultMinutes) * 60,
        title: defaultTitle)

    if state.phase == .running {
      // Restored mid-session: either it finished while we were gone, or it runs on.
      if let endsAt = state.endsAt, endsAt <= clock() {
        state.phase = .completed
        state.remaining = 0
      } else {
        segmentStartedAt = clock()
        startTicker()
      }
    }
  }

  deinit { ticker?.invalidate() }

  /// The state as of right now — while running, `remaining` is derived from the
  /// deadline rather than trusted from the last tick.
  public var currentState: TimerState {
    guard state.phase == .running, let endsAt = state.endsAt else { return state }
    var live = state
    live.remaining = max(0, endsAt.timeIntervalSince(clock()))
    return live
  }

  public func start(mode: TimerMode = .focus, minutes: Int? = nil, title: String? = nil) {
    let previousMode = state.mode
    let duration = minutes.map { TimeInterval($0) * 60 } ?? state.duration
    let now = clock()
    accumulated = 0
    segmentStartedAt = now
    state = TimerState(
      mode: mode,
      phase: .running,
      duration: duration,
      remaining: duration,
      endsAt: now.addingTimeInterval(duration),
      startedAt: now,
      title: title ?? state.title)
    startTicker()
    if mode != previousMode { onModeChange?(mode) }
    onChange?()
  }

  public func pause() {
    guard state.phase == .running else { return }
    let now = clock()
    closeSegment(at: now)
    state.remaining = max(0, (state.endsAt ?? now).timeIntervalSince(now))
    state.phase = .paused
    state.endsAt = nil
    stopTicker()
    onChange?()
  }

  public func resume() {
    guard state.phase == .paused else { return }
    let now = clock()
    segmentStartedAt = now
    state.phase = .running
    state.endsAt = now.addingTimeInterval(state.remaining)
    startTicker()
    onChange?()
  }

  public func toggle() {
    switch state.phase {
    case .running: pause()
    case .paused: resume()
    case .idle, .completed: start(mode: state.mode)
    }
  }

  /// Ends the session early. Returns the record if one was in flight.
  @discardableResult
  public func stop() -> SessionRecord? {
    guard state.phase != .idle else { return nil }
    let now = clock()
    closeSegment(at: now)
    let record = state.startedAt != nil ? buildRecord(endedAt: now, completed: false) : nil
    stopTicker()
    state.phase = .idle
    state.remaining = state.duration
    state.endsAt = nil
    state.startedAt = nil
    accumulated = 0
    onChange?()
    return record
  }

  /// Clears a `completed` phase without recording anything new.
  public func acknowledgeCompletion() {
    guard state.phase == .completed else { return }
    state.phase = .idle
    state.remaining = state.duration
    state.endsAt = nil
    state.startedAt = nil
    onChange?()
  }

  public func setTitle(_ title: String) {
    state.title = title
    onChange?()
  }

  public func setDuration(minutes: Int) {
    guard state.phase == .idle else { return }
    state.duration = TimeInterval(minutes) * 60
    state.remaining = state.duration
    onChange?()
  }

  /// Re-checks the deadline — called when the app returns to the foreground.
  public func sync() {
    guard state.phase == .running else { return }
    checkDeadline()
    onTick?()
  }

  public func dispose() { stopTicker() }

  // ------------------------------------------------------------------ internals

  private func buildRecord(endedAt: Date, completed: Bool) -> SessionRecord {
    let startedAt = state.startedAt ?? endedAt
    return SessionRecord(
      id: "\(Int(startedAt.timeIntervalSince1970))-\(state.mode.rawValue)",
      mode: state.mode,
      title: state.title,
      startedAt: startedAt,
      endedAt: endedAt,
      planned: state.duration,
      actual: accumulated,
      completed: completed)
  }

  private func closeSegment(at now: Date) {
    guard let started = segmentStartedAt else { return }
    accumulated += now.timeIntervalSince(started)
    segmentStartedAt = nil
  }

  private func startTicker() {
    stopTicker()
    // Half a second keeps the second boundary tight without busy-waiting.
    let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
      guard let self else { return }
      self.checkDeadline()
      if self.state.phase == .running { self.onTick?() }
    }
    // The default mode stalls while a list is being scrolled; the countdown must not.
    RunLoop.main.add(timer, forMode: .common)
    ticker = timer
  }

  private func stopTicker() {
    ticker?.invalidate()
    ticker = nil
  }

  /// Exposed so tests can drive the deadline with an injected clock.
  public func checkDeadline() {
    guard state.phase == .running, let endsAt = state.endsAt else { return }
    guard clock() >= endsAt else { return }
    closeSegment(at: endsAt)
    let record = buildRecord(endedAt: endsAt, completed: true)
    stopTicker()
    state.phase = .completed
    state.remaining = 0
    state.endsAt = nil
    onComplete?(record)
    onChange?()
  }
}
