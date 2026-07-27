/// The Live Activity: the running session on the Lock Screen and in the
/// Dynamic Island. `Text(timerInterval:)` counts the seconds down without the
/// extension being woken once per second — the LED panel cannot do that, so
/// this surface uses type rather than dots.
import ActivityKit
import GerdooKit
import SwiftUI
import WidgetKit

struct GerdooSessionActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: GerdooActivityAttributes.self) { context in
      lockScreen(context.state)
        .padding(16)
        .activityBackgroundTint(DeviceTokens.shellBottom)
        .activitySystemActionForegroundColor(Color(hex: context.state.accentHex))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label(
            titleCase(context.state.label),
            systemImage: context.state.mode == .break ? "cup.and.saucer.fill" : "timer"
          )
          .font(.caption.weight(.semibold))
          .foregroundStyle(Color(hex: context.state.accentHex))
        }
        DynamicIslandExpandedRegion(.trailing) {
          countdown(context.state)
            .font(.title3.monospacedDigit())
            .foregroundStyle(Color(hex: context.state.accentHex))
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(titleCase(context.state.title))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      } compactLeading: {
        Image(systemName: context.state.mode == .break ? "cup.and.saucer.fill" : "timer")
          .foregroundStyle(Color(hex: context.state.accentHex))
      } compactTrailing: {
        countdown(context.state)
          .font(.caption.monospacedDigit())
          .frame(maxWidth: 54)
          .foregroundStyle(Color(hex: context.state.accentHex))
      } minimal: {
        Image(systemName: "timer")
          .foregroundStyle(Color(hex: context.state.accentHex))
      }
    }
  }

  private func lockScreen(_ state: GerdooActivityAttributes.State) -> some View {
    HStack(alignment: .center, spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        Text(titleCase(state.label))
          .font(.caption.weight(.semibold))
          .tracking(1.4)
          .foregroundStyle(Color(hex: state.accentHex))
        Text(titleCase(state.title))
          .font(.footnote)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer()
      countdown(state)
        .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(Color(hex: state.accentHex))
    }
  }

  @ViewBuilder
  private func countdown(_ state: GerdooActivityAttributes.State) -> some View {
    if state.phase == .running, let endsAt = state.endsAt {
      Text(timerInterval: Date()...endsAt, countsDown: true)
        .multilineTextAlignment(.trailing)
    } else {
      Text(formatDuration(state.remaining))
    }
  }
}
