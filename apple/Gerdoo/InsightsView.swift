/// The Dashboard, on a phone. Same four numbers, same seven bars, same year of
/// history and the same week ahead — the arithmetic lives in `Insights.swift`,
/// shared with the desktop's definitions.
import GerdooKit
import SwiftUI

struct InsightsView: View {
  @EnvironmentObject private var model: GerdooModel

  private var stats: FocusStats {
    focusStats(model.snapshot.sessions, now: Date())
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          today
          week
          history
          ahead
        }
        .padding(16)
      }
      .background(Color(hex: "#0b0d10").ignoresSafeArea())
      .navigationTitle("Insights")
    }
  }

  // -------------------------------------------------------------------- today

  private var today: some View {
    let stats = stats
    return VStack(alignment: .leading, spacing: 10) {
      SectionTitle("Today")
      LazyVGrid(
        columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10
      ) {
        StatTile(value: "\(Int(stats.today / 60))", label: "Minutes focused", accent: model.accent)
        StatTile(value: "\(stats.todayCount)", label: "Sessions", accent: model.accent)
        StatTile(value: "\(stats.completed)", label: "Completed", accent: model.accent)
        StatTile(value: "\(stats.streak)", label: "Day streak", accent: model.accent)
      }
    }
  }

  // ---------------------------------------------------------------- last week

  private var week: some View {
    let days = stats.days
    let peak = max(days.map(\.focus).max() ?? 0, 25 * 60)
    return VStack(alignment: .leading, spacing: 10) {
      SectionTitle("Last 7 days")
      HStack(alignment: .bottom, spacing: 8) {
        ForEach(days) { day in
          VStack(spacing: 6) {
            GeometryReader { proxy in
              VStack {
                Spacer(minLength: 0)
                RoundedRectangle(cornerRadius: 4)
                  .fill(model.accent.opacity(day.focus > 0 ? 0.9 : 0.18))
                  .frame(height: max(3, proxy.size.height * day.focus / peak))
              }
            }
            .frame(height: 96)
            Text(day.dayStart.formatted(.dateTime.weekday(.abbreviated)))
              .font(.caption2)
              .foregroundStyle(DeviceTokens.textFaint)
          }
          .accessibilityElement()
          .accessibilityLabel(
            "\(day.dayStart.formatted(.dateTime.weekday(.wide))): \(Int(day.focus / 60)) minutes")
        }
      }
      .padding(14)
      .background(card)
    }
  }

  // ------------------------------------------------------------------ heatmap

  private var history: some View {
    VStack(alignment: .leading, spacing: 10) {
      SectionTitle("Focus history")
      HeatmapView(sessions: model.snapshot.sessions, accent: model.accent)
        .padding(14)
        .background(card)
    }
  }

  // ---------------------------------------------------------------- the week ahead

  private var ahead: some View {
    let days = groupByDay(model.snapshot.calendar.events, now: Date())
    return VStack(alignment: .leading, spacing: 10) {
      SectionTitle(
        model.snapshot.calendar.source == .sample ? "The week ahead · sample data"
          : "The week ahead")
      if days.isEmpty {
        Text(
          model.snapshot.calendar.detail
            ?? "Nothing on your calendar for the next seven days."
        )
        .font(.footnote)
        .foregroundStyle(DeviceTokens.textFaint)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(card)
      } else {
        ForEach(days) { day in
          VStack(alignment: .leading, spacing: 8) {
            HStack {
              Text(day.label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(DeviceTokens.text)
              Spacer()
              Text("\(formatBooked(day.booked)) booked")
                .font(.caption)
                .foregroundStyle(DeviceTokens.textFaint)
            }
            ForEach(day.events) { event in
              HStack(spacing: 10) {
                Text(event.isAllDay ? "All day" : formatClock(event.startsAt))
                  .font(.caption.monospacedDigit())
                  .foregroundStyle(DeviceTokens.textDim)
                  .frame(width: 58, alignment: .leading)
                Text(event.title)
                  .font(.caption)
                  .foregroundStyle(DeviceTokens.text)
                  .lineLimit(1)
                Spacer()
              }
            }
          }
          .padding(14)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(card)
        }
      }
    }
  }

  private var card: some View {
    RoundedRectangle(cornerRadius: 14, style: .continuous)
      .fill(Color.white.opacity(0.04))
  }
}

private struct SectionTitle: View {
  let text: String

  init(_ text: String) {
    self.text = text
  }

  var body: some View {
    Text(text.uppercased())
      .font(DeviceTokens.legend(10))
      .tracking(2)
      .foregroundStyle(DeviceTokens.textFaint)
  }
}

private struct StatTile: View {
  let value: String
  let label: String
  let accent: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(value)
        .font(.system(size: 30, weight: .semibold, design: .rounded))
        .foregroundStyle(accent)
      Text(label)
        .font(.caption)
        .foregroundStyle(DeviceTokens.textFaint)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .fill(Color.white.opacity(0.04)))
  }
}

/// A year of focus, a square a day — the desktop's `Heatmap.tsx`, laid out in
/// columns of weeks so it scrolls sideways on a phone.
private struct HeatmapView: View {
  let sessions: [SessionRecord]
  let accent: Color

  private let weeks = 26
  private let cell: CGFloat = 12

  var body: some View {
    let calendar = Calendar.current
    let today = calendar.startOfDay(for: Date())
    // Start on the Sunday that opens the first week shown, so rows are weekdays.
    let weekday = calendar.component(.weekday, from: today) - 1
    let lastWeekStart = calendar.date(byAdding: .day, value: -weekday, to: today) ?? today
    let start =
      calendar.date(byAdding: .day, value: -7 * (weeks - 1), to: lastWeekStart) ?? today
    let peak = max(
      (0..<(weeks * 7)).map { offset -> TimeInterval in
        let day = calendar.date(byAdding: .day, value: offset, to: start) ?? start
        return focusTime(sessions, on: day)
      }.max() ?? 0, 25 * 60)

    return ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 3) {
        ForEach(0..<weeks, id: \.self) { week in
          VStack(spacing: 3) {
            ForEach(0..<7, id: \.self) { weekday in
              let day =
                calendar.date(byAdding: .day, value: week * 7 + weekday, to: start) ?? start
              let focus = day > today ? 0 : focusTime(sessions, on: day)
              RoundedRectangle(cornerRadius: 2.5)
                .fill(
                  focus > 0
                    ? accent.opacity(0.25 + 0.75 * min(1, focus / peak))
                    : Color.white.opacity(day > today ? 0.02 : 0.06)
                )
                .frame(width: cell, height: cell)
                .accessibilityLabel(
                  "\(day.formatted(.dateTime.month().day())): \(Int(focus / 60)) minutes")
            }
          }
        }
      }
      .flipsForRightToLeftLayoutDirection(true)
    }
    .defaultScrollAnchor(.trailing)
  }
}
