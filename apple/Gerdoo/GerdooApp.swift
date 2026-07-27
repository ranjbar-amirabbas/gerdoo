import GerdooKit
import SwiftUI

@main
struct GerdooApp: App {
  @StateObject private var model = GerdooModel()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(model)
        .preferredColorScheme(.dark)
        .tint(model.accent)
    }
    .onChange(of: scenePhase) { _, phase in
      // Coming back from the background: the deadline may have passed, the
      // calendar may have moved on, and the watch may have won.
      if phase == .active { model.resume() }
      UIApplication.shared.isIdleTimerDisabled =
        phase == .active && model.snapshot.settings.keepAwake
        && model.snapshot.timer.phase == .running
    }
  }
}
