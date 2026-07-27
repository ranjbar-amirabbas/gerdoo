/// The session bell.
///
/// The desktop app can play a sound into a window that is already on screen.
/// A phone is usually in a pocket, so the end of a session is a scheduled local
/// notification: it fires at the deadline whether or not the app is running, and
/// it is cancelled the moment the deadline moves.
import Foundation
import UserNotifications
import os

public enum SessionAlert {
  private static let identifier = "gerdoo.session.complete"
  private static let log = Logger(subsystem: "com.amirabbasranjbar.gerdoo", category: "alerts")

  /// Books the bell for the running session, replacing whatever was booked.
  ///
  /// Permission is asked for here rather than at launch: the first thing a new
  /// user sees should be the device, not a system alert about a feature they
  /// have not used yet. By the time a session is running, the alert explains
  /// itself.
  public static func schedule(for timer: TimerState, sound: Bool) {
    cancel()
    guard timer.phase == .running, let endsAt = timer.endsAt else { return }
    let interval = endsAt.timeIntervalSinceNow
    guard interval > 0.5 else { return }

    let content = UNMutableNotificationContent()
    let isBreak = timer.mode == .break
    content.title = isBreak ? "Break over" : "Session done"
    content.body =
      isBreak
      ? "Back to work." : "\(titleCase(timer.title)) — \(formatBooked(timer.duration)) focused."
    if sound { content.sound = .default }
    content.interruptionLevel = .timeSensitive

    let request = UNNotificationRequest(
      identifier: identifier,
      content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false))

    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      switch settings.authorizationStatus {
      case .notDetermined:
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
          if let error { log.error("authorization failed: \(String(describing: error))") }
          guard granted else { return }
          center.add(request) { error in
            if let error { log.error("could not schedule: \(String(describing: error))") }
          }
        }
      case .denied:
        // Nothing to schedule and nothing to ask — the user has answered.
        break
      default:
        center.add(request) { error in
          if let error { log.error("could not schedule: \(String(describing: error))") }
        }
      }
    }
  }

  public static func cancel() {
    UNUserNotificationCenter.current()
      .removePendingNotificationRequests(withIdentifiers: [identifier])
  }
}
