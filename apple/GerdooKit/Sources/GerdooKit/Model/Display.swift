/// The single source of truth for what the LED panel shows, ported from
/// `src/shared/display.ts`. The panel, the complications, the Live Activity and
/// the watch all read this, so they cannot disagree about the device's state.
import Foundation

public struct LedContent: Equatable, Sendable {
  public var label: String
  /// Big countdown / clock line. Empty means "no big line".
  public var big: String
  public var sub: String
  public var color: SemanticColor
  /// A key that changes whenever the panel should play a mode transition.
  public var transitionKey: String

  public init(
    label: String, big: String, sub: String, color: SemanticColor, transitionKey: String
  ) {
    self.label = label
    self.big = big
    self.sub = sub
    self.color = color
    self.transitionKey = transitionKey
  }
}

public func pad2(_ value: Int) -> String {
  value < 10 ? "0\(value)" : String(value)
}

/// `MM:SS`, or `H:MM:SS` past an hour.
public func formatDuration(_ interval: TimeInterval) -> String {
  let total = max(0, Int(interval.rounded()))
  let hours = total / 3600
  let minutes = (total % 3600) / 60
  let seconds = total % 60
  if hours > 0 { return "\(hours):\(pad2(minutes)):\(pad2(seconds))" }
  return "\(pad2(minutes)):\(pad2(seconds))"
}

/// 12-hour clock without a meridiem — `10:42`, `2:30`.
public func formatClock(_ date: Date, calendar: Calendar = .current) -> String {
  let parts = calendar.dateComponents([.hour, .minute], from: date)
  let hour = (parts.hour ?? 0) % 12
  return "\(hour == 0 ? 12 : hour):\(pad2(parts.minute ?? 0))"
}

public func formatMinutes(_ interval: TimeInterval) -> String {
  "\(max(0, Int((interval / 60).rounded()))) MIN"
}

/// "10:42 · 24 min away" nearby, an absolute weekday/time once it is hours out.
public func describeWhen(_ startsAt: Date, now: Date) -> String {
  let minutesAway = Int((startsAt.timeIntervalSince(now) / 60).rounded())
  if minutesAway <= 90 {
    return "\(formatClock(startsAt)) · \(minutesAway) min away"
  }
  return startsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute())
}

/// Time left on the timer, computed from the deadline while running.
public func remaining(_ timer: TimerState, now: Date) -> TimeInterval {
  if timer.phase == .running, let endsAt = timer.endsAt {
    return max(0, endsAt.timeIntervalSince(now))
  }
  return max(0, timer.remaining)
}

/// What the panel can actually draw — anything else becomes a space.
private let ledAlphabet = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 :.,-+/'!?%()=<>*\"&#~_•")

private func sanitize(_ text: String) -> String {
  let upper = text.uppercased().map { ledAlphabet.contains($0) ? $0 : " " }
  return String(upper)
    .split(separator: " ", omittingEmptySubsequences: true)
    .joined(separator: " ")
}

/// Trim to `max` characters so long titles never overflow the panel.
public func fitLabel(_ text: String, max limit: Int) -> String {
  let clean = sanitize(text)
  if clean.count <= limit { return clean }
  let cut = clean.prefix(Swift.max(1, limit - 1)).trimmingCharacters(in: .whitespaces)
  return "\(cut)."
}

public struct FocusSuggestion: Equatable, Sendable {
  public var free: TimeInterval
  public var suggestMinutes: Int
}

/// A focus block that fits before the next event, leaving a 5 minute buffer.
public func suggestFocus(
  next: CalendarEvent?, now: Date, presets: [Int]
) -> FocusSuggestion? {
  guard let next else { return nil }
  let free = next.startsAt.timeIntervalSince(now)
  // Only suggest when the gap is short enough that fitting a session is a real
  // decision — with hours to spare the nudge is noise.
  if free > 2 * 3600 { return nil }
  let usableMinutes = Int(free / 60) - 5
  if usableMinutes < 10 { return nil }
  guard let suggestMinutes = presets.sorted().last(where: { $0 <= usableMinutes }) else {
    return nil
  }
  return FocusSuggestion(free: free, suggestMinutes: suggestMinutes)
}

private func statusSub(_ snapshot: AppSnapshot, now: Date) -> String {
  let status = snapshot.status
  let calendar = snapshot.calendar
  let meta = status.id.meta

  switch status.id {
  case .meeting:
    let until = calendar.current?.endsAt ?? status.until
    return until.map { "UNTIL \(formatClock($0))" } ?? "HEADS DOWN"
  case .dnd:
    return status.until.map { "BACK AT \(formatClock($0))" } ?? "STAY IN THE ZONE"
  case .oncall:
    // A meeting that put the status here leaves its end time behind, which says
    // more than the static sub-label does.
    let until = calendar.current?.endsAt ?? status.until
    return until.map { "UNTIL \(formatClock($0))" } ?? meta.sub
  case .available, .custom:
    break
  }

  // Available / custom: prefer calendar awareness, then a focus suggestion.
  if let current = calendar.current {
    return fitLabel("NOW: \(current.title) TIL \(formatClock(current.endsAt))", max: 22)
  }
  if let next = calendar.next {
    let suggestion = suggestFocus(next: next, now: now, presets: snapshot.settings.presets)
    if let suggestion, suggestion.free < 90 * 60 {
      return fitLabel(
        "\(formatMinutes(suggestion.free)) FREE - START \(suggestion.suggestMinutes) MIN",
        max: 22)
    }
    return fitLabel("NEXT: \(next.title) \(formatClock(next.startsAt))", max: 22)
  }
  return status.id == .custom ? "READY TO FOCUS" : meta.sub
}

/// Single source of truth for what the LED panel shows.
public func deriveLedContent(_ snapshot: AppSnapshot, now: Date) -> LedContent {
  let timer = snapshot.timer
  let status = snapshot.status

  if timer.phase == .running || timer.phase == .paused {
    let paused = timer.phase == .paused
    let isBreak = timer.mode == .break
    let color: SemanticColor = paused ? .paused : (isBreak ? .break : .focus)
    return LedContent(
      label: paused ? "PAUSED" : (isBreak ? "BREAK" : "FOCUS"),
      big: formatDuration(remaining(timer, now: now)),
      sub: isBreak ? "BREATHE & RESET"
        : fitLabel(timer.title.isEmpty ? "DEEP WORK" : timer.title, max: 22),
      color: color,
      transitionKey: "\(timer.mode.rawValue):\(timer.phase.rawValue)")
  }

  if timer.phase == .completed {
    let isBreak = timer.mode == .break
    return LedContent(
      label: isBreak ? "BREAK OVER" : "SESSION DONE",
      big: "00:00",
      sub: isBreak ? "BACK TO WORK" : "TAKE A BREAK",
      color: isBreak ? .focus : .break,
      transitionKey: "completed:\(timer.mode.rawValue)")
  }

  let meta = status.id.meta
  let label: String =
    status.id == .custom
    ? fitLabel(status.customLabel.isEmpty ? "FOCUS MODE" : status.customLabel, max: 18)
    : meta.label
  return LedContent(
    label: label,
    big: meta.showsClock ? formatClock(now) : "",
    sub: statusSub(snapshot, now: now),
    color: meta.color,
    transitionKey: "status:\(status.id.rawValue)")
}

/// LED labels are shouty by design; a widget or a notification is not.
/// `ON CALL` → `On Call`.
public func titleCase(_ text: String) -> String {
  var result = ""
  var atWordStart = true
  for char in text.lowercased() {
    if atWordStart, char.isLetter || char.isNumber {
      result.append(Character(char.uppercased()))
      atWordStart = false
    } else {
      result.append(char)
      if char == " " || char == "-" || char == "/" { atWordStart = true }
    }
  }
  return result
}

/// One line for a place with no room for three — an inline complication, a
/// notification title, the Dynamic Island's compact side. Derived from
/// `deriveLedContent` so it cannot claim a state the panel disagrees with.
public func deriveShortTitle(_ snapshot: AppSnapshot, now: Date) -> String {
  let timer = snapshot.timer
  let content = deriveLedContent(snapshot, now: now)
  if timer.isActive {
    return "\(titleCase(content.label)) \(formatDuration(remaining(timer, now: now)))"
  }
  let custom = snapshot.status.customLabel.trimmingCharacters(in: .whitespaces)
  if snapshot.status.id == .custom, !custom.isEmpty { return custom }
  return titleCase(content.label)
}
