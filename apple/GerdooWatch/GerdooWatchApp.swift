import GerdooKit
import SwiftUI

@main
struct GerdooWatchApp: App {
  @StateObject private var model = GerdooModel()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      WatchRootView()
        .environmentObject(model)
        .tint(model.accent)
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { model.resume() }
    }
  }
}
