// stitch-calendar — reads macOS Calendar (EventKit) and prints JSON on stdout.
//
// Electron cannot talk to EventKit, so the main process spawns this helper.
// It always exits 0 and always prints a JSON object; the caller reads `status`
// to tell "no events" apart from "no permission".
//
// Usage:
//   stitch-calendar --status              # permission state only, no prompt
//   stitch-calendar --days 2              # events from start of today, N days out
//   stitch-calendar --days 2 --request    # same, but may show the access prompt

import EventKit
import Foundation

struct EventOut: Codable {
  let id: String
  let title: String
  let startsAt: Double  // epoch milliseconds
  let endsAt: Double
  let isAllDay: Bool
  let calendar: String
  let location: String?
  let isCancelled: Bool
}

struct Output: Codable {
  let status: String
  let events: [EventOut]
  let message: String?
}

func emit(status: String, events: [EventOut] = [], message: String? = nil) -> Never {
  let output = Output(status: status, events: events, message: message)
  let encoder = JSONEncoder()
  if let data = try? encoder.encode(output), let json = String(data: data, encoding: .utf8) {
    print(json)
  } else {
    print("{\"status\":\"error\",\"events\":[],\"message\":\"encoding failed\"}")
  }
  exit(0)
}

// Compared by raw value on purpose: `.fullAccess` and `.writeOnly` are macOS 14
// symbols, and matching on them would drag an availability check into every
// call site. The numbers are stable API.
//   0 notDetermined · 1 restricted · 2 denied · 3 authorized/fullAccess · 4 writeOnly
func describe(_ status: EKAuthorizationStatus) -> String {
  switch status.rawValue {
  case 0: return "notDetermined"
  case 1: return "restricted"
  case 2: return "denied"
  case 3: return "authorized"
  case 4: return "writeOnly"
  default: return "unknown"
  }
}

func canRead(_ status: EKAuthorizationStatus) -> Bool {
  status.rawValue == 3
}

// ---------------------------------------------------------------- arguments

var days = 2
var statusOnly = false
var mayPrompt = false

var index = 1
let arguments = CommandLine.arguments
while index < arguments.count {
  switch arguments[index] {
  case "--status":
    statusOnly = true
  case "--request":
    mayPrompt = true
  case "--days":
    index += 1
    if index < arguments.count, let parsed = Int(arguments[index]) { days = max(1, min(60, parsed)) }
  default:
    break
  }
  index += 1
}

let store = EKEventStore()
let current = EKEventStore.authorizationStatus(for: .event)

if statusOnly {
  emit(status: describe(current))
}

// --------------------------------------------------------------- permission

if current.rawValue == 0 {
  guard mayPrompt else { emit(status: "notDetermined") }
  let semaphore = DispatchSemaphore(value: 0)
  var failure: Error?
  if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { _, error in
      failure = error
      semaphore.signal()
    }
  } else {
    store.requestAccess(to: .event) { _, error in
      failure = error
      semaphore.signal()
    }
  }
  // The prompt is modal to the user, not to us — wait, but never forever.
  if semaphore.wait(timeout: .now() + 120) == .timedOut {
    emit(status: "notDetermined", message: "access request timed out")
  }
  if let failure {
    emit(status: "error", message: failure.localizedDescription)
  }
}

let resolved = EKEventStore.authorizationStatus(for: .event)
guard canRead(resolved) else {
  emit(status: describe(resolved))
}

// ------------------------------------------------------------------- events

let calendar = Calendar.current
let start = calendar.startOfDay(for: Date())
guard let end = calendar.date(byAdding: .day, value: days, to: start) else {
  emit(status: "error", message: "could not build the date range")
}

let calendars = store.calendars(for: .event)
let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
let events = store.events(matching: predicate)
  .sorted { ($0.startDate ?? start) < ($1.startDate ?? start) }
  .compactMap { event -> EventOut? in
    guard let startDate = event.startDate, let endDate = event.endDate else { return nil }
    return EventOut(
      id: event.eventIdentifier ?? event.calendarItemIdentifier,
      title: event.title ?? "Untitled",
      startsAt: startDate.timeIntervalSince1970 * 1000,
      endsAt: endDate.timeIntervalSince1970 * 1000,
      isAllDay: event.isAllDay,
      calendar: event.calendar?.title ?? "",
      location: event.location,
      isCancelled: event.status == .canceled
    )
  }

emit(status: "authorized", events: events)
