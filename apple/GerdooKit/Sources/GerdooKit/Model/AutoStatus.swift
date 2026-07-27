/// ON CALL for the length of a meeting, and back afterwards. Ported from
/// `src/main/auto-status.ts` — pure, for exactly the same reason: it is the one
/// piece of status handling worth testing on its own.
import Foundation

/// What Gerdoo has to remember while it is driving the status itself: which
/// event put it On Call, and the status to hand back when that event ends.
///
/// It is persisted, so a relaunch in the middle of a meeting still knows the
/// status is on loan rather than something the user chose.
public struct AutoStatusHold: Codable, Equatable, Sendable {
  public var eventID: String
  /// The status in force before the event started.
  public var previous: StatusState

  public init(eventID: String, previous: StatusState) {
    self.eventID = eventID
    self.previous = previous
  }
}

public struct AutoStatusInput {
  /// The `autoOnCall` setting.
  public var enabled: Bool
  /// The event happening right now, from `CalendarState.current`.
  public var current: CalendarEvent?
  /// The status as it stands.
  public var status: StatusState
  /// The hold in force, or nil when the status is the user's own.
  public var hold: AutoStatusHold?
  public var now: Date

  public init(
    enabled: Bool, current: CalendarEvent?, status: StatusState, hold: AutoStatusHold?,
    now: Date
  ) {
    self.enabled = enabled
    self.current = current
    self.status = status
    self.hold = hold
    self.now = now
  }
}

public struct AutoStatusDecision: Equatable {
  /// The hold to persist — nil gives the status back to the user.
  public var hold: AutoStatusHold?
  /// The status to apply, or nil to leave it exactly as it is.
  public var status: StatusState?
}

/// Decides what the status should be for the calendar as it stands right now.
///
/// The rule is short: while an event is running the status is ON CALL, and when
/// it ends the previous status comes back. Everything else is bookkeeping around
/// that — back-to-back meetings hand the hold straight on rather than restoring
/// in between, and a meeting that is moved while it runs drags its `until` with
/// it.
///
/// A manual status change drops the hold at the call site, so a hold reaching
/// this function always describes a status Gerdoo set itself; the user's own
/// choice is never overwritten mid-meeting.
public func resolveAutoStatus(_ input: AutoStatusInput) -> AutoStatusDecision {
  // Turned off mid-meeting: give the status back rather than stranding it.
  guard input.enabled, let current = input.current else {
    if let hold = input.hold { return release(hold, now: input.now) }
    return AutoStatusDecision(hold: nil, status: nil)
  }

  if let hold = input.hold, hold.eventID == current.id {
    // Same meeting, but it may have been shortened or extended underneath us.
    if input.status.id == .oncall, input.status.until != current.endsAt {
      var status = input.status
      status.until = current.endsAt
      return AutoStatusDecision(hold: hold, status: status)
    }
    return AutoStatusDecision(hold: hold, status: nil)
  }

  // A new event takes over. Straight from another meeting, what comes back at
  // the end is still whatever preceded the *first* one.
  let previous = input.hold?.previous ?? input.status
  return AutoStatusDecision(
    hold: AutoStatusHold(eventID: current.id, previous: previous),
    status: StatusState(
      id: .oncall, customLabel: input.status.customLabel, until: current.endsAt))
}

private func release(_ hold: AutoStatusHold, now: Date) -> AutoStatusDecision {
  var status = hold.previous
  // An "until" from before the meeting has usually gone stale by now — a
  // BACK AT time in the past reads worse than none at all.
  if let until = status.until, until <= now { status.until = nil }
  return AutoStatusDecision(hold: nil, status: status)
}
