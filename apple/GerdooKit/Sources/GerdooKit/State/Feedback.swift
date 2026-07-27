/// The click and the chime, per platform. The watch has a taptic engine and no
/// speaker worth using; the phone has both.
import Foundation

#if os(iOS)
  import AudioToolbox
  import UIKit
#elseif os(watchOS)
  import WatchKit
#endif

public enum Feedback {
  public enum Cue {
    /// A transport key was pressed.
    case press
    /// The timer changed mode — focus to break, or back.
    case mode
    /// A session ended on its own.
    case complete
  }

  public static func play(_ cue: Cue, sound: Bool, haptics: Bool) {
    #if os(iOS)
      if haptics {
        switch cue {
        case .press: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case .mode: UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case .complete: UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
      }
      // The bell for a completed session is the notification's; this is only for
      // a session that ends while the app is in front, where no alert fires.
      if sound, cue == .complete { AudioServicesPlaySystemSound(1057) }
    #elseif os(watchOS)
      guard haptics else { return }
      switch cue {
      case .press: WKInterfaceDevice.current().play(.click)
      case .mode: WKInterfaceDevice.current().play(.directionUp)
      case .complete: WKInterfaceDevice.current().play(.success)
      }
    #endif
  }
}
