/// The one place that owns state, on both devices.
///
/// The desktop app keeps its state in the main process and pushes a full
/// `AppSnapshot` to every window; renderers never hold authoritative state. Here
/// there is no second process, so this object plays that part: the views read
/// `snapshot`, call back into these methods, and never mutate anything
/// themselves. Everything that changes state goes through `publish()`, which is
/// the single place that persists, reloads widgets and tells the other wrist.
import Combine
import Foundation
import SwiftUI

#if canImport(WidgetKit)
  import WidgetKit
#endif

@MainActor
public final class GerdooModel: ObservableObject {
  @Published public private(set) var snapshot: AppSnapshot

  private let store: SharedStore
  private let calendarService = CalendarService()
  private let link = WatchLink()
  private var timer: TimerEngine!
  private var autoStatusHold: AutoStatusHold?
  private var calendarTicker: Timer?
  /// Set while adopting the other device's state, so replication does not echo.
  private var adopting = false

  public init(store: SharedStore = SharedStore()) {
    self.store = store
    let persisted = store.load()
    snapshot = AppSnapshot(
      timer: persisted.timer ?? TimerState(
        duration: TimeInterval(persisted.settings.selectedMinutes) * 60,
        remaining: TimeInterval(persisted.settings.selectedMinutes) * 60,
        title: persisted.settings.defaultTitle),
      status: persisted.status,
      calendar: persisted.calendar,
      settings: persisted.settings,
      sessions: persisted.sessions,
      updatedAt: Date())
    autoStatusHold = persisted.autoStatus

    timer = TimerEngine(
      restored: persisted.timer,
      defaultMinutes: persisted.settings.selectedMinutes,
      defaultTitle: persisted.settings.defaultTitle)
    timer.onChange = { [weak self] in self?.publish() }
    timer.onTick = { [weak self] in self?.tick() }
    timer.onComplete = { [weak self] record in self?.sessionCompleted(record) }
    timer.onModeChange = { [weak self] _ in
      guard let self else { return }
      Feedback.play(
        .mode, sound: snapshot.settings.soundEnabled,
        haptics: snapshot.settings.hapticsEnabled)
    }

    link.onState = { [weak self] state in self?.adopt(state) }
    link.onCommand = { [weak self] command in self?.apply(command) }
    link.provideState = { [weak self] in self?.snapshot ?? AppSnapshot() }
    link.activate()

    startCalendarTicker()
    Task { await refreshCalendar() }
  }

  // ----------------------------------------------------------------- commands

  public func start(minutes: Int? = nil, title: String? = nil) {
    Feedback.play(
      .press, sound: false, haptics: snapshot.settings.hapticsEnabled)
    timer.start(
      mode: .focus, minutes: minutes ?? snapshot.settings.selectedMinutes,
      title: title ?? snapshot.timer.title)
  }

  public func startBreak() {
    Feedback.play(.press, sound: false, haptics: snapshot.settings.hapticsEnabled)
    timer.start(mode: .break, minutes: snapshot.settings.breakMinutes)
  }

  public func toggle() {
    Feedback.play(.press, sound: false, haptics: snapshot.settings.hapticsEnabled)
    if snapshot.timer.phase == .completed {
      timer.acknowledgeCompletion()
      return
    }
    if snapshot.timer.phase == .idle {
      timer.start(mode: .focus, minutes: snapshot.settings.selectedMinutes)
      return
    }
    timer.toggle()
  }

  public func stop() {
    Feedback.play(.press, sound: false, haptics: snapshot.settings.hapticsEnabled)
    if let session = timer.stop() { record(session) }
  }

  public func acknowledgeCompletion() {
    timer.acknowledgeCompletion()
  }

  public func setTitle(_ title: String) {
    timer.setTitle(title)
  }

  public func selectPreset(_ index: Int) {
    var settings = snapshot.settings
    settings.selectedPresetIndex = index
    update(settings: settings)
    if snapshot.timer.phase == .idle {
      timer.setDuration(minutes: settings.selectedMinutes)
    }
  }

  /// The crown, and the phone's stepper: a duration that is not one of the presets.
  public func setDuration(minutes: Int) {
    timer.setDuration(minutes: max(1, min(180, minutes)))
  }

  public func setStatus(_ id: StatusID, customLabel: String? = nil, until: Date? = nil) {
    // The user choosing a status ends any hold the calendar had on it, so a
    // meeting still running does not immediately overwrite the choice.
    autoStatusHold = nil
    var status = snapshot.status
    status.id = id
    if let customLabel { status.customLabel = customLabel }
    status.until = until
    snapshot.status = status
    publish()
  }

  public func update(settings: Settings) {
    let previous = snapshot.settings
    snapshot.settings = settings
    publish()
    if settings.calendarSource != previous.calendarSource {
      Task { await refreshCalendar() }
    }
    if settings.autoOnCall != previous.autoOnCall {
      applyAutoStatus()
    }
  }

  public func requestCalendarAccess() async {
    await calendarService.requestSystemAccess()
    await refreshCalendar()
  }

  /// Called when the app comes back to the foreground: the deadline may have
  /// passed, the calendar may have moved on, and the other device may have won.
  public func resume() {
    timer.sync()
    recomputeCalendar()
    link.send(command: .requestState)
    Task { await refreshCalendar() }
  }

  // ----------------------------------------------------------------- calendar

  public func refreshCalendar() async {
    let source = snapshot.settings.calendarSource
    var state = await calendarService.load(source: source, now: Date())
    // Stale events beat invented ones: keep what we had rather than dropping to
    // the sample schedule the moment a read fails.
    if source == .system, state.access != .authorized, !snapshot.calendar.events.isEmpty,
      snapshot.calendar.source == .system
    {
      state.events = snapshot.calendar.events
      state = calendarService.state(
        events: state.events, access: state.access, source: source, detail: state.detail)
    }
    snapshot.calendar = state
    applyAutoStatus()
    publish()
  }

  private func startCalendarTicker() {
    // A meeting starting has to move the status without waiting for a refresh,
    // so `current`/`next` are recomputed on the minute from what we already have.
    let ticker = Timer(timeInterval: 30, repeats: true) { [weak self] _ in
      Task { @MainActor in self?.recomputeCalendar() }
    }
    RunLoop.main.add(ticker, forMode: .common)
    calendarTicker = ticker
  }

  private func recomputeCalendar() {
    let state = calendarService.state(
      events: snapshot.calendar.events, access: snapshot.calendar.access,
      source: snapshot.calendar.source, detail: snapshot.calendar.detail)
    let changed = state.current != snapshot.calendar.current || state.next != snapshot.calendar.next
    snapshot.calendar = state
    if changed {
      applyAutoStatus()
      publish()
    }
  }

  private func applyAutoStatus() {
    let decision = resolveAutoStatus(
      AutoStatusInput(
        enabled: snapshot.settings.autoOnCall,
        current: snapshot.calendar.current,
        status: snapshot.status,
        hold: autoStatusHold,
        now: Date()))
    autoStatusHold = decision.hold
    if let status = decision.status { snapshot.status = status }
  }

  // -------------------------------------------------------------- transitions

  private func tick() {
    // The countdown itself is derived from the deadline by whoever draws it, so
    // a tick only has to keep the widgets honest.
    objectWillChange.send()
  }

  private func sessionCompleted(_ finished: SessionRecord) {
    record(finished)
    Feedback.play(
      .complete, sound: snapshot.settings.soundEnabled,
      haptics: snapshot.settings.hapticsEnabled)

    // Auto-start hands straight over: a finished focus session becomes a break,
    // and a finished break becomes the next focus session.
    if finished.mode == .focus, snapshot.settings.autoStartBreak {
      timer.start(mode: .break, minutes: snapshot.settings.breakMinutes)
    } else if finished.mode == .break, snapshot.settings.autoStartFocus {
      timer.start(mode: .focus, minutes: snapshot.settings.selectedMinutes)
    }
  }

  private func record(_ session: SessionRecord) {
    // A session shorter than a minute is a mis-tap, not a record.
    guard session.actual >= 60 else { return }
    var sessions = snapshot.sessions
    sessions.removeAll { $0.id == session.id }
    sessions.append(session)
    if sessions.count > maxStoredSessions {
      sessions = Array(sessions.suffix(maxStoredSessions))
    }
    snapshot.sessions = sessions
  }

  // ------------------------------------------------------------------ publish

  /// The single place state leaves this object.
  private func publish() {
    snapshot.timer = timer.currentState
    snapshot.updatedAt = Date()

    var persisted = PersistedState()
    persisted.settings = snapshot.settings
    persisted.status = snapshot.status
    persisted.autoStatus = autoStatusHold
    persisted.timer = snapshot.timer
    persisted.sessions = snapshot.sessions
    persisted.calendar = snapshot.calendar
    store.save(persisted)

    if snapshot.settings.notifyOnComplete {
      SessionAlert.schedule(for: snapshot.timer, sound: snapshot.settings.soundEnabled)
    } else {
      SessionAlert.cancel()
    }

    #if canImport(WidgetKit)
      WidgetCenter.shared.reloadAllTimelines()
    #endif

    LiveActivityController.shared.update(with: snapshot)

    if !adopting { link.send(state: snapshot) }
  }

  // --------------------------------------------------------------------- sync

  /// The other device's state. Newer wins; equal or older is ignored, so two
  /// devices cannot ping-pong an old snapshot back and forth.
  private func adopt(_ incoming: AppSnapshot) {
    guard incoming.updatedAt > snapshot.updatedAt else { return }
    adopting = true
    defer { adopting = false }

    snapshot.settings = incoming.settings
    snapshot.status = incoming.status
    snapshot.sessions = incoming.sessions
    // The watch has no calendar of its own; the phone's read is the only one.
    if !incoming.calendar.events.isEmpty || snapshot.calendar.events.isEmpty {
      snapshot.calendar = incoming.calendar
    }

    if incoming.timer != snapshot.timer {
      timer.dispose()
      timer = TimerEngine(
        restored: incoming.timer,
        defaultMinutes: incoming.settings.selectedMinutes,
        defaultTitle: incoming.settings.defaultTitle)
      timer.onChange = { [weak self] in self?.publish() }
      timer.onTick = { [weak self] in self?.tick() }
      timer.onComplete = { [weak self] record in self?.sessionCompleted(record) }
    }
    publish()
    snapshot.updatedAt = incoming.updatedAt
  }

  private func apply(_ command: SyncCommand) {
    switch command {
    case let .start(minutes, mode, title):
      timer.start(mode: mode, minutes: minutes, title: title ?? snapshot.timer.title)
    case .toggle:
      timer.toggle()
    case .stop:
      if let session = timer.stop() { record(session) }
    case .acknowledge:
      timer.acknowledgeCompletion()
    case let .setStatus(id, customLabel, until):
      setStatus(id, customLabel: customLabel, until: until)
    case .requestState:
      link.send(state: snapshot)
    }
  }
}

extension GerdooModel {
  /// The palette every view renders with.
  public var palette: Palette {
    paletteFor(
      accentColor: snapshot.settings.accentColor, modeColors: snapshot.settings.modeColors)
  }

  public func content(at now: Date) -> LedContent {
    deriveLedContent(snapshot, now: now)
  }

  public var accent: Color {
    let content = deriveLedContent(snapshot, now: Date())
    return palette.spec(content.color).accentColor
  }
}
