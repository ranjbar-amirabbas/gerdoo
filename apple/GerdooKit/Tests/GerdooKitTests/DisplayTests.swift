import Foundation
import Testing

@testable import GerdooKit

/// What is covered is the part with somewhere to hide: the derivation that every
/// surface reads, the colour maths, the deadline arithmetic and the calendar
/// status hand-off. The SwiftUI views are not covered.
@Suite("LED content derivation")
struct DisplayTests {
  /// A fixed clock: 2026-03-04 10:42 local time.
  let now = Calendar.current.date(
    from: DateComponents(year: 2026, month: 3, day: 4, hour: 10, minute: 42))!

  func snapshot(
    timer: TimerState = TimerState(),
    status: StatusState = StatusState(),
    calendar: CalendarState = CalendarState()
  ) -> AppSnapshot {
    AppSnapshot(timer: timer, status: status, calendar: calendar, updatedAt: now)
  }

  @Test("a running session shows the countdown and its title")
  func runningSession() {
    let timer = TimerState(
      mode: .focus, phase: .running, duration: 1500, remaining: 1500,
      endsAt: now.addingTimeInterval(1471), startedAt: now, title: "Ship the watch app")
    let content = deriveLedContent(snapshot(timer: timer), now: now)
    #expect(content.label == "FOCUS")
    #expect(content.big == "24:31")
    #expect(content.sub == "SHIP THE WATCH APP")
    #expect(content.color == .focus)
  }

  @Test("pausing recolours the panel and freezes the deadline")
  func pausedSession() {
    let timer = TimerState(phase: .paused, duration: 1500, remaining: 600, title: "Deep work")
    let content = deriveLedContent(snapshot(timer: timer), now: now)
    #expect(content.label == "PAUSED")
    #expect(content.big == "10:00")
    #expect(content.color == .paused)
  }

  @Test("past an hour the countdown grows a third field")
  func longDuration() {
    #expect(formatDuration(3661) == "1:01:01")
    #expect(formatDuration(59) == "00:59")
    #expect(formatDuration(-5) == "00:00")
  }

  @Test("an idle status shows the wall clock when it has one")
  func idleStatus() {
    let content = deriveLedContent(snapshot(status: StatusState(id: .available)), now: now)
    #expect(content.label == "AVAILABLE")
    #expect(content.big == "10:42")
    #expect(content.sub == "READY TO FOCUS")
  }

  @Test("ON CALL borrows the running meeting's end time")
  func onCallUntil() {
    let event = CalendarEvent(
      id: "1", title: "TEAM SYNC", startsAt: now.addingTimeInterval(-600),
      endsAt: now.addingTimeInterval(1200))
    let content = deriveLedContent(
      snapshot(
        status: StatusState(id: .oncall),
        calendar: CalendarState(current: event)),
      now: now)
    #expect(content.big == "")
    #expect(content.sub == "UNTIL 11:02")
  }

  @Test("a gap before the next meeting is offered as a session")
  func focusSuggestion() {
    let next = CalendarEvent(
      id: "2", title: "DESIGN REVIEW", startsAt: now.addingTimeInterval(35 * 60),
      endsAt: now.addingTimeInterval(70 * 60))
    let content = deriveLedContent(
      snapshot(calendar: CalendarState(next: next)), now: now)
    // Clipped at 22 characters, exactly as the desktop panel clips it — the two
    // apps agreeing matters more here than the sentence finishing.
    #expect(content.sub == "35 MIN FREE - START 2.")
    #expect(
      suggestFocus(next: next, now: now, presets: [15, 25, 35, 50])?.suggestMinutes == 25)
  }

  @Test("a gap too small for the shortest preset suggests nothing")
  func noSuggestion() {
    let next = CalendarEvent(
      id: "3", title: "STANDUP", startsAt: now.addingTimeInterval(12 * 60),
      endsAt: now.addingTimeInterval(27 * 60))
    let suggestion = suggestFocus(next: next, now: now, presets: [15, 25, 35, 50])
    #expect(suggestion == nil)
  }

  @Test("labels are shouted, trimmed and stripped of what the panel cannot draw")
  func labelFitting() {
    #expect(fitLabel("café ☕ break", max: 22) == "CAF BREAK")
    #expect(fitLabel("a very long session title indeed", max: 12) == "A VERY LONG.")
  }

  @Test("the short title title-cases the panel's own label")
  func shortTitle() {
    let one = deriveShortTitle(snapshot(status: StatusState(id: .oncall)), now: now)
    #expect(one == "On Call")
    let timer = TimerState(
      phase: .running, duration: 1500, remaining: 1500,
      endsAt: now.addingTimeInterval(90), startedAt: now, title: "Deep work")
    #expect(deriveShortTitle(snapshot(timer: timer), now: now) == "Focus 01:30")
  }

  @Test("a custom status keeps the user's own capitalisation")
  func customStatus() {
    let status = StatusState(id: .custom, customLabel: "Writing docs")
    #expect(deriveShortTitle(snapshot(status: status), now: now) == "Writing docs")
    #expect(deriveLedContent(snapshot(status: status), now: now).label == "WRITING DOCS")
  }
}
