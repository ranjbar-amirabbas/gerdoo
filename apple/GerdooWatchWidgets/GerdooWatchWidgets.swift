/// Watch face complications, and the card the Smart Stack shows.
///
/// Every family here is drawn from the same App Group record the app publishes,
/// so a complication cannot disagree with the panel it came from.
import GerdooKit
import SwiftUI
import WidgetKit

@main
struct GerdooWatchWidgetBundle: WidgetBundle {
  var body: some Widget {
    GerdooComplication()
  }
}

struct WatchProvider: TimelineProvider {
  func placeholder(in context: Context) -> GerdooEntry { GerdooTimeline.placeholder }

  func getSnapshot(in context: Context, completion: @escaping (GerdooEntry) -> Void) {
    completion(context.isPreview ? GerdooTimeline.placeholder : GerdooTimeline.entries().first!)
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<GerdooEntry>) -> Void) {
    let entries = GerdooTimeline.entries()
    completion(Timeline(entries: entries, policy: GerdooTimeline.reloadPolicy(entries)))
  }
}

struct GerdooComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "GerdooComplication", provider: WatchProvider()) { entry in
      ComplicationView(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Gerdoo")
    .description("Your session and status on the watch face.")
    .supportedFamilies([
      .accessoryCircular, .accessoryCorner, .accessoryInline, .accessoryRectangular
    ])
  }
}

struct ComplicationView: View {
  @Environment(\.widgetFamily) private var family
  let entry: GerdooEntry

  private var timer: TimerState { entry.snapshot.timer }

  var body: some View {
    switch family {
    case .accessoryInline:
      Label(
        deriveShortTitle(entry.snapshot, now: entry.date),
        systemImage: timer.isActive ? "timer" : entry.snapshot.status.id.meta.symbol)

    case .accessoryCorner:
      Image(systemName: timer.isActive ? "timer" : entry.snapshot.status.id.meta.symbol)
        .font(.title2)
        .widgetAccentable()
        .widgetLabel {
          if timer.isActive, timer.duration > 0 {
            Gauge(value: progress) {
              Text(titleCase(entry.content.label))
            }
            .tint(entry.accent)
          } else {
            Text(titleCase(entry.content.label))
          }
        }

    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        Text(titleCase(entry.content.label))
          .font(.caption.weight(.semibold))
          .foregroundStyle(entry.accent)
        big
          .font(.title3.monospacedDigit())
        Text(titleCase(entry.content.sub))
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

    default:
      CircularGauge(entry: entry)
    }
  }

  private var progress: Double {
    guard timer.duration > 0 else { return 0 }
    return max(0, min(1, remaining(timer, now: entry.date) / timer.duration))
  }

  @ViewBuilder
  private var big: some View {
    if timer.phase == .running, let endsAt = timer.endsAt {
      // The complication renderer counts this down itself, so the watch does not
      // have to wake the extension every second.
      Text(timerInterval: entry.date...endsAt, countsDown: true)
    } else if !entry.content.big.isEmpty {
      Text(entry.content.big)
    } else {
      Text(titleCase(entry.snapshot.status.id.meta.sub))
        .font(.caption2)
    }
  }
}

/// A ring that empties as the session runs, and the status glyph when none is.
struct CircularGauge: View {
  let entry: GerdooEntry

  var body: some View {
    let timer = entry.snapshot.timer
    if timer.isActive, timer.duration > 0 {
      let left = remaining(timer, now: entry.date)
      Gauge(value: max(0, min(1, left / timer.duration))) {
        Image(systemName: timer.mode == .break ? "cup.and.saucer.fill" : "timer")
      } currentValueLabel: {
        Text("\(Int((left / 60).rounded(.up)))")
      }
      .gaugeStyle(.accessoryCircular)
      .tint(entry.accent)
    } else {
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: entry.snapshot.status.id.meta.symbol)
          .font(.title3)
          .foregroundStyle(entry.accent)
      }
    }
  }
}
