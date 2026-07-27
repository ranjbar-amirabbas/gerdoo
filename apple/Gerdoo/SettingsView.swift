/// Settings. Everything the desktop offers that still means something on a
/// phone, plus the two things only a phone has: haptics and keeping the screen
/// awake. Launch-at-login, hide-on-blur, window scale and the menu bar row have
/// no equivalent here and are gone rather than faked.
import GerdooKit
import SwiftUI

struct SettingsView: View {
  @EnvironmentObject private var model: GerdooModel

  private var settings: Settings { model.snapshot.settings }

  private func edit(_ change: (inout Settings) -> Void) {
    var draft = settings
    change(&draft)
    model.update(settings: draft)
  }

  var body: some View {
    NavigationStack {
      Form {
        sessionSection
        panelSection
        alertsSection
        calendarSection
        aboutSection
      }
      .navigationTitle("Settings")
    }
  }

  // ------------------------------------------------------------------ session

  private var sessionSection: some View {
    Section("Session") {
      NavigationLink {
        PresetEditor()
      } label: {
        LabeledContent("Presets", value: settings.presets.map(String.init).joined(separator: " · "))
      }

      Stepper(
        value: Binding(
          get: { settings.breakMinutes },
          set: { value in edit { $0.breakMinutes = value } }), in: 1...60
      ) {
        LabeledContent("Break", value: "\(settings.breakMinutes) min")
      }

      Toggle(
        "Start break automatically",
        isOn: Binding(
          get: { settings.autoStartBreak },
          set: { value in edit { $0.autoStartBreak = value } }))

      Toggle(
        "Start next session after a break",
        isOn: Binding(
          get: { settings.autoStartFocus },
          set: { value in edit { $0.autoStartFocus = value } }))

      TextField(
        "Default title",
        text: Binding(
          get: { settings.defaultTitle },
          set: { value in edit { $0.defaultTitle = value } }))
    }
  }

  // -------------------------------------------------------------------- panel

  private var panelSection: some View {
    Section {
      VStack(alignment: .leading, spacing: 6) {
        LabeledContent("Brightness", value: "\(Int(settings.brightness * 100))%")
        Slider(
          value: Binding(
            get: { settings.brightness },
            set: { value in edit { $0.brightness = value } }), in: 0.35...1)
      }

      NavigationLink {
        AccentPicker()
      } label: {
        LabeledContent("Accent colour") {
          HStack(spacing: 6) {
            Circle()
              .fill(model.palette.spec(.focus).activeColor)
              .frame(width: 14, height: 14)
            Text(
              accentPresets.first { $0.value == settings.accentColor }?.label ?? "Custom")
          }
        }
      }

      NavigationLink {
        ModeColorEditor()
      } label: {
        LabeledContent(
          "Mode colours",
          value: settings.modeColors.isEmpty
            ? "Following accent" : "\(settings.modeColors.count) set")
      }

      Picker(
        "Motion",
        selection: Binding(
          get: { settings.reduceMotion },
          set: { value in edit { $0.reduceMotion = value } })
      ) {
        Text("Follow system").tag(Bool?.none)
        Text("Full").tag(Bool?.some(false))
        Text("Reduced").tag(Bool?.some(true))
      }
    } header: {
      Text("Panel")
    } footer: {
      Text("Mode colours override the accent for a single mode. The colour you pick is the colour the panel lights.")
    }
  }

  // ------------------------------------------------------------------- alerts

  private var alertsSection: some View {
    Section("Alerts") {
      Toggle(
        "Notify when a session ends",
        isOn: Binding(
          get: { settings.notifyOnComplete },
          set: { value in edit { $0.notifyOnComplete = value } }))
      Toggle(
        "Sound",
        isOn: Binding(
          get: { settings.soundEnabled },
          set: { value in edit { $0.soundEnabled = value } }))
      Toggle(
        "Haptics",
        isOn: Binding(
          get: { settings.hapticsEnabled },
          set: { value in edit { $0.hapticsEnabled = value } }))
      Toggle(
        "Keep the screen awake while focusing",
        isOn: Binding(
          get: { settings.keepAwake },
          set: { value in edit { $0.keepAwake = value } }))
    }
  }

  // ----------------------------------------------------------------- calendar

  private var calendarSection: some View {
    Section {
      Picker(
        "Source",
        selection: Binding(
          get: { settings.calendarSource },
          set: { value in edit { $0.calendarSource = value } })
      ) {
        Text("My calendars").tag(CalendarSource.system)
        Text("Sample schedule").tag(CalendarSource.sample)
      }

      Toggle(
        "On Call during meetings",
        isOn: Binding(
          get: { settings.autoOnCall },
          set: { value in edit { $0.autoOnCall = value } }))

      if settings.calendarSource == .system {
        LabeledContent("Access", value: accessLabel)
        if model.snapshot.calendar.access != .authorized {
          Button("Allow calendar access") {
            Task { await model.requestCalendarAccess() }
          }
          if model.snapshot.calendar.access == .denied {
            Button("Open Settings") {
              if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
              }
            }
          }
        }
      }
    } header: {
      Text("Calendar")
    } footer: {
      Text(
        "Gerdoo reads the calendars already on this iPhone — including any feed you subscribed to in Settings › Calendar › Accounts.")
    }
  }

  private var accessLabel: String {
    switch model.snapshot.calendar.access {
    case .authorized: "Granted"
    case .denied: "Denied"
    case .restricted: "Restricted"
    case .notDetermined: "Not asked yet"
    case .unavailable: "Unavailable"
    case .error: "Failed"
    case .sample: "Not needed"
    }
  }

  // -------------------------------------------------------------------- about

  private var aboutSection: some View {
    Section("About") {
      LabeledContent(
        "Version",
        value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
      LabeledContent("Sessions recorded", value: "\(model.snapshot.sessions.count)")
    }
  }
}

// ------------------------------------------------------------------- children

private struct PresetEditor: View {
  @EnvironmentObject private var model: GerdooModel

  var body: some View {
    Form {
      Section {
        ForEach(Array(model.snapshot.settings.presets.enumerated()), id: \.offset) { index, minutes in
          Stepper(
            value: Binding(
              get: { minutes },
              set: { value in
                var settings = model.snapshot.settings
                settings.presets[index] = value
                model.update(settings: settings)
              }), in: 1...180, step: 5
          ) {
            LabeledContent("Preset \(index + 1)", value: "\(minutes) min")
          }
        }
      } footer: {
        Text("The four lengths offered on the device's dial.")
      }
    }
    .navigationTitle("Presets")
  }
}

private struct AccentPicker: View {
  @EnvironmentObject private var model: GerdooModel
  @State private var custom = Color.orange

  var body: some View {
    Form {
      Section("Presets") {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 14) {
          ForEach(accentPresets) { preset in
            Button {
              var settings = model.snapshot.settings
              settings.accentColor = preset.value
              model.update(settings: settings)
            } label: {
              Group {
                if let hex = preset.value {
                  Circle().fill(Color(hex: hex))
                } else {
                  // The default is not one hue but seven, so its swatch says so.
                  Circle().fill(
                    AngularGradient(
                      colors: modeOrder.compactMap { semanticColors[$0]?.activeColor },
                      center: .center))
                }
              }
              .frame(height: 34)
              .overlay(
                Circle().strokeBorder(
                  model.snapshot.settings.accentColor == preset.value
                    ? Color.primary : .clear, lineWidth: 2))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(preset.label)
          }
        }
        .padding(.vertical, 6)
      }

      Section("Custom") {
        ColorPicker("Pick a colour", selection: $custom, supportsOpacity: false)
        Button("Use this colour") {
          var settings = model.snapshot.settings
          settings.accentColor = custom.hexString
          model.update(settings: settings)
        }
      }
    }
    .navigationTitle("Accent colour")
  }
}

private struct ModeColorEditor: View {
  @EnvironmentObject private var model: GerdooModel

  var body: some View {
    Form {
      ForEach(modeOrder, id: \.self) { mode in
        let override = model.snapshot.settings.modeColors[mode]
        HStack {
          ColorPicker(
            modeTitles[mode] ?? mode.rawValue,
            selection: Binding(
              get: { Color(hex: override ?? model.palette.spec(mode).active) },
              set: { value in
                var settings = model.snapshot.settings
                settings.modeColors[mode] = value.hexString
                model.update(settings: settings)
              }), supportsOpacity: false)
          if override != nil {
            Button {
              var settings = model.snapshot.settings
              settings.modeColors[mode] = nil
              model.update(settings: settings)
            } label: {
              Image(systemName: "arrow.uturn.backward")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Follow the accent again")
          }
        }
      }
    }
    .navigationTitle("Mode colours")
  }
}

extension Color {
  /// `#rrggbb` for storing a picked colour, which the palette expects.
  var hexString: String {
    let components = UIColor(self).cgColor.components ?? [0, 0, 0]
    let values: [CGFloat] = components.count >= 3 ? components : [components[0], components[0], components[0]]
    return String(
      format: "#%02x%02x%02x", Int((values[0] * 255).rounded()), Int((values[1] * 255).rounded()),
      Int((values[2] * 255).rounded()))
  }
}
