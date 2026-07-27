/// Phone ↔ watch sync.
///
/// Both sides run the same model, so this is not a remote control: it is
/// replication. Every mutation broadcasts the whole snapshot, and a receiver
/// adopts one only if it is newer than what it already has. That is
/// last-write-wins, which is the right answer for one person with two devices —
/// and it means either side keeps working when the other is out of range, which
/// a command-only link could not do.
///
/// Commands still exist, for the one case replication cannot cover: a press on
/// the watch while the phone is asleep should start the session on both, and the
/// snapshot that comes back settles any disagreement.
import Foundation
import os

#if canImport(WatchConnectivity)
  import WatchConnectivity
#endif

public enum SyncCommand: Codable, Sendable {
  case start(minutes: Int, mode: TimerMode, title: String?)
  case toggle
  case stop
  case acknowledge
  case setStatus(id: StatusID, customLabel: String?, until: Date?)
  /// "Tell me what you have" — sent when a side wakes up with a stale snapshot.
  case requestState
}

private enum PayloadKey {
  static let state = "gerdoo.state"
  static let command = "gerdoo.command"
}

public final class WatchLink: NSObject {
  public var onState: ((AppSnapshot) -> Void)?
  public var onCommand: ((SyncCommand) -> Void)?
  /// Latest snapshot to hand over when the other side asks for one.
  public var provideState: (() -> AppSnapshot)?

  private let log = Logger(subsystem: "com.amirabbasranjbar.gerdoo", category: "sync")
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  public override init() {
    super.init()
  }

  public func activate() {
    #if canImport(WatchConnectivity)
      guard WCSession.isSupported() else { return }
      let session = WCSession.default
      session.delegate = self
      session.activate()
    #endif
  }

  /// Replication. `updateApplicationContext` keeps only the latest value and is
  /// delivered even if the other side is asleep, which is exactly the semantics
  /// of "here is the current state".
  public func send(state: AppSnapshot) {
    #if canImport(WatchConnectivity)
      guard let data = try? encoder.encode(state) else { return }
      let session = WCSession.default
      guard session.activationState == .activated else { return }
      do {
        try session.updateApplicationContext([PayloadKey.state: data])
      } catch {
        log.error("application context refused: \(String(describing: error))")
      }
    #endif
  }

  public func send(command: SyncCommand) {
    #if canImport(WatchConnectivity)
      guard let data = try? encoder.encode(command) else { return }
      let session = WCSession.default
      guard session.activationState == .activated else { return }
      if session.isReachable {
        session.sendMessage([PayloadKey.command: data], replyHandler: nil) { [weak self] error in
          self?.log.error("message failed: \(String(describing: error))")
        }
      } else {
        // Queued and delivered when the other side next wakes.
        session.transferUserInfo([PayloadKey.command: data])
      }
    #endif
  }

  private func handle(_ payload: [String: Any]) {
    if let data = payload[PayloadKey.state] as? Data,
      let state = try? decoder.decode(AppSnapshot.self, from: data)
    {
      DispatchQueue.main.async { self.onState?(state) }
    }
    if let data = payload[PayloadKey.command] as? Data,
      let command = try? decoder.decode(SyncCommand.self, from: data)
    {
      DispatchQueue.main.async {
        if case .requestState = command {
          if let state = self.provideState?() { self.send(state: state) }
        } else {
          self.onCommand?(command)
        }
      }
    }
  }
}

#if canImport(WatchConnectivity)
  extension WatchLink: WCSessionDelegate {
    public func session(
      _ session: WCSession, activationDidCompleteWith state: WCSessionActivationState,
      error: Error?
    ) {
      if let error { log.error("activation failed: \(String(describing: error))") }
      // Whatever arrived while this process was not running is waiting in the
      // received context.
      let received = session.receivedApplicationContext
      if !received.isEmpty { handle(received) }
    }

    public func session(
      _ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]
    ) {
      handle(applicationContext)
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
      handle(message)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
      handle(userInfo)
    }

    #if os(iOS)
      public func sessionDidBecomeInactive(_ session: WCSession) {}

      public func sessionDidDeactivate(_ session: WCSession) {
        // Reactivate so a switched watch keeps syncing.
        WCSession.default.activate()
      }
    #endif
  }
#endif
