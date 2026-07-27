/// The iPhone's widgets: the device on the Home Screen, a line of it on the
/// Lock Screen, and a Live Activity for a session in flight.
import GerdooKit
import SwiftUI
import WidgetKit

@main
struct GerdooWidgetBundle: WidgetBundle {
  var body: some Widget {
    GerdooStatusWidget()
    GerdooSessionActivity()
  }
}

struct GerdooProvider: TimelineProvider {
  func placeholder(in context: Context) -> GerdooEntry { GerdooTimeline.placeholder }

  func getSnapshot(in context: Context, completion: @escaping (GerdooEntry) -> Void) {
    completion(
      context.isPreview ? GerdooTimeline.placeholder : GerdooTimeline.entries().first!)
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<GerdooEntry>) -> Void) {
    let entries = GerdooTimeline.entries()
    completion(Timeline(entries: entries, policy: GerdooTimeline.reloadPolicy(entries)))
  }
}

struct GerdooStatusWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "GerdooStatus", provider: GerdooProvider()) { entry in
      GerdooWidgetView(entry: entry)
        .containerBackground(for: .widget) {
          LinearGradient(
            colors: [DeviceTokens.shellMid, DeviceTokens.shellBottom],
            startPoint: .top, endPoint: .bottom)
        }
    }
    .configurationDisplayName("Gerdoo")
    .description("Your timer and status, on the panel.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline
    ])
  }
}

struct GerdooWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: GerdooEntry

  var body: some View {
    switch family {
    case .accessoryInline:
      Text(deriveShortTitle(entry.snapshot, now: entry.date))
    case .accessoryCircular:
      CircularGauge(entry: entry)
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        Text(titleCase(entry.content.label))
          .font(.caption.weight(.semibold))
        if entry.snapshot.timer.phase == .running, let endsAt = entry.snapshot.timer.endsAt {
          Text(timerInterval: entry.date...endsAt, countsDown: true)
            .font(.title3.monospacedDigit())
        } else if !entry.content.big.isEmpty {
          Text(entry.content.big).font(.title3.monospacedDigit())
        }
        Text(titleCase(entry.content.sub))
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      .widgetAccentable()
    default:
      panel
    }
  }

  /// The Home Screen widget is the device itself, shrunk.
  private var panel: some View {
    VStack(spacing: 8) {
      DeviceScreen(
        content: entry.content,
        palette: entry.palette,
        brightness: entry.snapshot.settings.brightness,
        // A widget is a still image; a sweep it cannot play would only be a
        // half-drawn frame.
        reduceMotion: true,
        layout: family == .systemSmall ? .compact : .full,
        showsMascot: family != .systemSmall)
      if family != .systemSmall {
        HStack {
          Text(titleCase(entry.content.label))
            .font(.caption.weight(.semibold))
            .foregroundStyle(entry.accent)
          Spacer()
          Text(titleCase(entry.content.sub))
            .font(.caption2)
            .foregroundStyle(DeviceTokens.textFaint)
            .lineLimit(1)
        }
      }
    }
  }
}

/// A ring that empties as the session runs — the one shape that reads at
/// complication size.
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
      .widgetAccentable()
    } else {
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: entry.snapshot.status.id.meta.symbol)
          .font(.title3)
      }
      .widgetAccentable()
    }
  }
}
