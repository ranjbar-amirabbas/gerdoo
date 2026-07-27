/// The device itself — the phone's answer to the Focus Bar.
///
/// The desktop window is a fixed 520 × 230 panel with the controls moulded into
/// the shell. A phone is taller than it is wide and its controls have to be
/// thumb-sized, so the same parts are stacked instead of inlined: screen, preset
/// dial, transport keys, then the things the desktop puts in the expanded panel.
import GerdooKit
import SwiftUI

struct FocusView: View {
  @EnvironmentObject private var model: GerdooModel
  @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
  @State private var editingTitle = false
  @State private var draftTitle = ""
  @State private var showingStatus = false

  private var settings: Settings { model.snapshot.settings }
  private var timer: TimerState { model.snapshot.timer }

  private var reduceMotion: Bool {
    settings.reduceMotion ?? systemReduceMotion
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 18) {
          device
          transport
          statusRow
          UpNextCard()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
      }
      .background(Color(hex: "#0b0d10").ignoresSafeArea())
      .navigationTitle("Gerdoo")
      .navigationBarTitleDisplayMode(.inline)
      .sheet(isPresented: $showingStatus) { StatusSheet() }
      .alert("Session title", isPresented: $editingTitle) {
        TextField("What are you working on?", text: $draftTitle)
        Button("Cancel", role: .cancel) {}
        Button("Set") { model.setTitle(draftTitle.isEmpty ? settings.defaultTitle : draftTitle) }
      }
    }
  }

  // ------------------------------------------------------------------- screen

  private var device: some View {
    DeviceShell(accent: model.accent) {
      VStack(spacing: 12) {
        PanelClock(ticking: model.snapshot.isTicking) { now in
          DeviceScreen(
            content: model.content(at: now),
            palette: model.palette,
            brightness: settings.brightness,
            reduceMotion: reduceMotion)
        }
        presets
      }
    }
  }

  private var presets: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        DeviceLegend("Session")
        Spacer()
        Button {
          draftTitle = timer.title
          editingTitle = true
        } label: {
          HStack(spacing: 4) {
            Text(titleCase(timer.title))
              .font(.footnote.weight(.medium))
            Image(systemName: "pencil")
              .font(.caption2)
          }
          .foregroundStyle(DeviceTokens.textDim)
        }
        .disabled(timer.mode == .break && timer.isActive)
      }

      HStack(spacing: 8) {
        ForEach(Array(settings.presets.enumerated()), id: \.offset) { index, minutes in
          let selected = index == settings.selectedPresetIndex
          Button {
            model.selectPreset(index)
          } label: {
            Text("\(minutes)")
              .font(.system(size: 15, weight: .semibold, design: .rounded))
              .frame(maxWidth: .infinity)
              .padding(.vertical, 9)
              .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                  .fill(selected ? model.accent.opacity(0.22) : Color.white.opacity(0.04)))
              .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                  .strokeBorder(
                    selected ? model.accent : Color.white.opacity(0.08),
                    lineWidth: selected ? 1.5 : 1))
              .foregroundStyle(selected ? model.accent : DeviceTokens.textDim)
          }
          .buttonStyle(.plain)
          // Changing the length of a session that is already running would make
          // the deadline a lie.
          .disabled(timer.isActive)
        }
      }
      .opacity(timer.isActive ? 0.45 : 1)
    }
  }

  // ---------------------------------------------------------------- transport

  private var transport: some View {
    HStack(spacing: 10) {
      DeviceButton(
        primaryLabel, symbol: primarySymbol, kind: .primary, accent: model.accent
      ) {
        model.toggle()
      }
      DeviceButton("Stop", symbol: "stop.fill", accent: model.accent) {
        model.stop()
      }
      .disabled(timer.phase == .idle)
      .opacity(timer.phase == .idle ? 0.4 : 1)
      DeviceButton("Break", symbol: "cup.and.saucer.fill", accent: model.accent) {
        model.startBreak()
      }
    }
  }

  private var primaryLabel: String {
    switch timer.phase {
    case .running: "Pause"
    case .paused: "Resume"
    case .completed: "Clear"
    case .idle: "Start"
    }
  }

  private var primarySymbol: String {
    switch timer.phase {
    case .running: "pause.fill"
    case .completed: "checkmark"
    default: "play.fill"
    }
  }

  // ------------------------------------------------------------------- status

  private var statusRow: some View {
    Button {
      showingStatus = true
    } label: {
      HStack(spacing: 10) {
        Circle()
          .fill(model.palette.spec(model.snapshot.status.id.meta.color).activeColor)
          .frame(width: 10, height: 10)
        VStack(alignment: .leading, spacing: 2) {
          Text(statusTitle)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(DeviceTokens.text)
          Text(statusDetail)
            .font(.caption)
            .foregroundStyle(DeviceTokens.textFaint)
        }
        Spacer()
        Image(systemName: "chevron.right")
          .font(.caption)
          .foregroundStyle(DeviceTokens.textFaint)
      }
      .padding(14)
      .background(
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .fill(Color.white.opacity(0.04)))
    }
    .buttonStyle(.plain)
  }

  private var statusTitle: String {
    let status = model.snapshot.status
    if status.id == .custom, !status.customLabel.isEmpty { return status.customLabel }
    return titleCase(status.id.meta.label)
  }

  private var statusDetail: String {
    if let until = model.snapshot.status.until {
      return "Until \(formatClock(until))"
    }
    return model.snapshot.settings.autoOnCall
      ? "Meetings switch this to On Call" : "Tap to change"
  }
}

/// What the calendar says is happening, under the device.
struct UpNextCard: View {
  @EnvironmentObject private var model: GerdooModel

  var body: some View {
    let calendar = model.snapshot.calendar
    VStack(alignment: .leading, spacing: 10) {
      DeviceLegend(calendar.current != nil ? "Happening now" : "Up next")
      if let event = calendar.current ?? calendar.next {
        HStack(spacing: 12) {
          RoundedRectangle(cornerRadius: 3)
            .fill(model.palette.spec(.meeting).activeColor)
            .frame(width: 3)
          VStack(alignment: .leading, spacing: 3) {
            Text(event.title)
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(DeviceTokens.text)
            Text(
              calendar.current != nil
                ? "Until \(formatClock(event.endsAt))"
                : describeWhen(event.startsAt, now: Date())
            )
            .font(.caption)
            .foregroundStyle(DeviceTokens.textFaint)
          }
          Spacer()
        }
        .frame(height: 40)
      } else {
        Text(emptyMessage)
          .font(.caption)
          .foregroundStyle(DeviceTokens.textFaint)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .fill(Color.white.opacity(0.04)))
  }

  private var emptyMessage: String {
    let calendar = model.snapshot.calendar
    if let detail = calendar.detail { return detail }
    return "Nothing on your calendar for the next seven days."
  }
}
