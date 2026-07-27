import GerdooKit
import SwiftUI

struct RootView: View {
  @EnvironmentObject private var model: GerdooModel

  var body: some View {
    TabView {
      FocusView()
        .tabItem { Label("Focus", systemImage: "timer") }
      InsightsView()
        .tabItem { Label("Insights", systemImage: "chart.bar.fill") }
      SettingsView()
        .tabItem { Label("Settings", systemImage: "slider.horizontal.3") }
    }
  }
}

/// A clock that only ticks when something on screen is counting. An idle status
/// with no wall clock has nothing to redraw, and a phone in a pocket should not
/// be redrawing anything at all.
struct PanelClock<Content: View>: View {
  let ticking: Bool
  @ViewBuilder let content: (Date) -> Content

  var body: some View {
    if ticking {
      TimelineView(.periodic(from: .now, by: 1)) { timeline in
        content(timeline.date)
      }
    } else {
      content(Date())
    }
  }
}

extension AppSnapshot {
  /// Whether the panel has anything that changes on its own.
  var isTicking: Bool {
    timer.phase == .running || status.id.meta.showsClock
  }
}
