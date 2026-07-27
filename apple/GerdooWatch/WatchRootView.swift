/// Three pages, because a watch has no room for tabs and no patience for
/// navigation: the device, the status, and what the calendar says is coming.
import GerdooKit
import SwiftUI

struct WatchRootView: View {
  var body: some View {
    TabView {
      WatchTimerView()
      WatchStatusView()
      WatchUpNextView()
    }
    .tabViewStyle(.verticalPage)
  }
}

/// The panel, the countdown and the three keys — the whole device, wrist-sized.
struct WatchTimerView: View {
  @EnvironmentObject private var model: GerdooModel
  @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
  @State private var crownMinutes: Double = 25

  private var settings: Settings { model.snapshot.settings }
  private var timer: TimerState { model.snapshot.timer }
  private var reduceMotion: Bool { settings.reduceMotion ?? systemReduceMotion }

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        PanelClock(ticking: model.snapshot.isTicking) { now in
          DeviceScreen(
            content: model.content(at: now),
            palette: model.palette,
            brightness: settings.brightness,
            reduceMotion: reduceMotion,
            layout: .watch,
            // At this size the dog is a smudge behind the digits.
            showsMascot: false)
        }
        .frame(maxWidth: .infinity)

        Text(subline)
          .font(.caption2)
          .foregroundStyle(DeviceTokens.textFaint)
          .lineLimit(1)
          .minimumScaleFactor(0.7)

        if timer.phase == .idle {
          crown
        }

        HStack(spacing: 6) {
          Button {
            model.toggle()
          } label: {
            Image(systemName: primarySymbol)
              .frame(maxWidth: .infinity)
          }
          .tint(model.accent)

          Button {
            model.stop()
          } label: {
            Image(systemName: "stop.fill")
              .frame(maxWidth: .infinity)
          }
          .disabled(timer.phase == .idle)

          Button {
            model.startBreak()
          } label: {
            Image(systemName: "cup.and.saucer.fill")
              .frame(maxWidth: .infinity)
          }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
      }
      .padding(.horizontal, 4)
    }
    .onAppear { crownMinutes = Double(Int(timer.duration / 60)) }
  }

  /// The crown sets a length that is not one of the presets — the one control a
  /// watch has that a phone does not.
  private var crown: some View {
    HStack {
      Text("\(Int(crownMinutes)) min")
        .font(.system(.title3, design: .rounded).weight(.semibold))
        .foregroundStyle(model.accent)
      Spacer()
      Image(systemName: "digitalcrown.arrow.clockwise.fill")
        .font(.caption)
        .foregroundStyle(DeviceTokens.textFaint)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 6)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(Color.white.opacity(0.06)))
    .focusable()
    .digitalCrownRotation(
      $crownMinutes, from: 5, through: 120, by: 5, sensitivity: .low,
      isContinuous: false, isHapticFeedbackEnabled: true
    )
    .onChange(of: crownMinutes) { _, minutes in
      model.setDuration(minutes: Int(minutes))
    }
  }

  private var subline: String {
    let content = model.content(at: Date())
    return content.big.isEmpty ? content.sub : titleCase(content.sub)
  }

  private var primarySymbol: String {
    switch timer.phase {
    case .running: "pause.fill"
    case .completed: "checkmark"
    default: "play.fill"
    }
  }
}

/// A clock that only ticks when something on screen is counting.
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
  var isTicking: Bool {
    timer.phase == .running || status.id.meta.showsClock
  }
}
