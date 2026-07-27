import Foundation
import Testing

@testable import GerdooKit

/// A clock the test moves by hand, so a 25 minute session takes no time at all.
final class TestClock {
  var now = Date(timeIntervalSince1970: 1_772_000_000)
  func advance(_ seconds: TimeInterval) { now += seconds }
  var read: () -> Date { { [self] in now } }
}

@Suite("Timer deadlines")
struct TimerTests {
  @Test("remaining time comes from the deadline, not from counting ticks")
  func deadlineDriven() {
    let clock = TestClock()
    let engine = TimerEngine(
      restored: nil, defaultMinutes: 25, defaultTitle: "DEEP WORK", clock: clock.read)
    engine.start(mode: .focus, minutes: 25)
    // No ticks fire at all — the app was suspended for the whole stretch.
    clock.advance(10 * 60)
    #expect(engine.currentState.remaining == 15 * 60)
  }

  @Test("a session that ended while the app was away completes on the next check")
  func completesWhileAway() {
    let clock = TestClock()
    let engine = TimerEngine(
      restored: nil, defaultMinutes: 25, defaultTitle: "DEEP WORK", clock: clock.read)
    var completed: SessionRecord?
    engine.onComplete = { completed = $0 }
    engine.start(mode: .focus, minutes: 25)
    let startedAt = clock.now
    clock.advance(40 * 60)
    engine.sync()

    #expect(engine.state.phase == .completed)
    #expect(engine.currentState.remaining == 0)
    // The record ends at the deadline, not at the moment we noticed.
    #expect(completed?.endedAt == startedAt.addingTimeInterval(25 * 60))
    // Spelled as a Double: inside `#expect`, an integer literal against an
    // optional Double compares as a boxed `Int` and never matches.
    #expect(completed?.actual == 1500.0)
    #expect(completed?.completed == true)
  }

  @Test("paused time is excluded from the recorded session")
  func pausedTimeExcluded() {
    let clock = TestClock()
    let engine = TimerEngine(
      restored: nil, defaultMinutes: 25, defaultTitle: "DEEP WORK", clock: clock.read)
    engine.start(mode: .focus, minutes: 25)
    clock.advance(5 * 60)
    engine.pause()
    #expect(engine.state.remaining == 20 * 60)
    clock.advance(30 * 60)  // a long interruption
    engine.resume()
    clock.advance(3 * 60)
    let record = engine.stop()

    #expect(record?.actual == 480.0)
    #expect(record?.completed == false)
    #expect(engine.state.phase == .idle)
    #expect(engine.state.remaining == 25 * 60)
  }

  @Test("resuming pushes the deadline out by exactly what was left")
  func resumeExtendsDeadline() {
    let clock = TestClock()
    let engine = TimerEngine(
      restored: nil, defaultMinutes: 25, defaultTitle: "DEEP WORK", clock: clock.read)
    engine.start(mode: .focus, minutes: 25)
    clock.advance(60)
    engine.pause()
    clock.advance(3600)
    engine.resume()
    #expect(engine.state.endsAt == clock.now.addingTimeInterval(24 * 60))
  }

  @Test("a restored session whose deadline has passed reopens as completed")
  func restoredPastDeadline() {
    let clock = TestClock()
    let stale = TimerState(
      phase: .running, duration: 1500, remaining: 1500,
      endsAt: clock.now.addingTimeInterval(-60), startedAt: clock.now.addingTimeInterval(-1560),
      title: "DEEP WORK")
    let engine = TimerEngine(
      restored: stale, defaultMinutes: 25, defaultTitle: "DEEP WORK", clock: clock.read)
    #expect(engine.state.phase == .completed)
  }

  @Test("switching focus to break announces the mode change once")
  func modeChange() {
    let clock = TestClock()
    let engine = TimerEngine(
      restored: nil, defaultMinutes: 25, defaultTitle: "DEEP WORK", clock: clock.read)
    var modes: [TimerMode] = []
    engine.onModeChange = { modes.append($0) }
    engine.start(mode: .focus, minutes: 25)
    engine.start(mode: .break, minutes: 5)
    engine.start(mode: .break, minutes: 5)
    #expect(modes == [.break])
  }
}
