import Foundation
import Testing

@testable import GerdooKit

@Suite("Calendar-driven status")
struct AutoStatusTests {
  let now = Date(timeIntervalSince1970: 1_772_000_000)

  func event(_ id: String, from: TimeInterval, to: TimeInterval) -> CalendarEvent {
    CalendarEvent(
      id: id, title: "MEETING", startsAt: now.addingTimeInterval(from),
      endsAt: now.addingTimeInterval(to))
  }

  @Test("a running meeting takes the status to ON CALL and remembers what it replaced")
  func takesOver() {
    let decision = resolveAutoStatus(
      AutoStatusInput(
        enabled: true, current: event("a", from: -300, to: 900),
        status: StatusState(id: .available), hold: nil, now: now))
    #expect(decision.status?.id == .oncall)
    #expect(decision.status?.until == now.addingTimeInterval(900))
    #expect(decision.hold?.eventID == "a")
    #expect(decision.hold?.previous.id == .available)
  }

  @Test("the meeting ending hands the previous status back")
  func releases() {
    let hold = AutoStatusHold(eventID: "a", previous: StatusState(id: .dnd))
    let decision = resolveAutoStatus(
      AutoStatusInput(
        enabled: true, current: nil, status: StatusState(id: .oncall), hold: hold, now: now))
    #expect(decision.hold == nil)
    #expect(decision.status?.id == .dnd)
  }

  @Test("a stale BACK AT time is dropped on the way back")
  func dropsStaleUntil() {
    let previous = StatusState(id: .dnd, until: now.addingTimeInterval(-60))
    let hold = AutoStatusHold(eventID: "a", previous: previous)
    let decision = resolveAutoStatus(
      AutoStatusInput(
        enabled: true, current: nil, status: StatusState(id: .oncall), hold: hold, now: now))
    #expect(decision.status?.until == nil)
  }

  @Test("back-to-back meetings hand the hold on without restoring in between")
  func backToBack() {
    let hold = AutoStatusHold(eventID: "a", previous: StatusState(id: .available))
    let decision = resolveAutoStatus(
      AutoStatusInput(
        enabled: true, current: event("b", from: 0, to: 1800),
        status: StatusState(id: .oncall), hold: hold, now: now))
    #expect(decision.hold?.eventID == "b")
    // What comes back at the end is still what preceded the *first* meeting.
    #expect(decision.hold?.previous.id == .available)
  }

  @Test("a meeting extended underneath us drags its end time along")
  func meetingMoved() {
    let hold = AutoStatusHold(eventID: "a", previous: StatusState(id: .available))
    let status = StatusState(id: .oncall, until: now.addingTimeInterval(600))
    let decision = resolveAutoStatus(
      AutoStatusInput(
        enabled: true, current: event("a", from: -300, to: 1800), status: status, hold: hold,
        now: now))
    #expect(decision.status?.until == now.addingTimeInterval(1800))
    #expect(decision.hold?.eventID == "a")
  }

  @Test("turning the setting off mid-meeting gives the status back")
  func disabledMidMeeting() {
    let hold = AutoStatusHold(eventID: "a", previous: StatusState(id: .available))
    let decision = resolveAutoStatus(
      AutoStatusInput(
        enabled: false, current: event("a", from: -300, to: 900),
        status: StatusState(id: .oncall), hold: hold, now: now))
    #expect(decision.hold == nil)
    #expect(decision.status?.id == .available)
  }

  @Test("with nothing on and nothing held, the status is left alone")
  func noOp() {
    let decision = resolveAutoStatus(
      AutoStatusInput(
        enabled: true, current: nil, status: StatusState(id: .dnd), hold: nil, now: now))
    #expect(decision.hold == nil)
    #expect(decision.status == nil)
  }
}
