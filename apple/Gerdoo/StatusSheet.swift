import GerdooKit
import SwiftUI

/// The status menu, which on the desktop hangs off the shell's status dot.
struct StatusSheet: View {
  @EnvironmentObject private var model: GerdooModel
  @Environment(\.dismiss) private var dismiss
  @State private var customLabel = ""
  @State private var untilEnabled = false
  @State private var until = Date().addingTimeInterval(3600)

  var body: some View {
    NavigationStack {
      Form {
        Section {
          ForEach(statusOrder, id: \.self) { id in
            Button {
              choose(id)
            } label: {
              HStack {
                Image(systemName: id.meta.symbol)
                  .foregroundStyle(model.palette.spec(id.meta.color).activeColor)
                  .frame(width: 24)
                Text(id == .custom ? "Custom…" : titleCase(id.meta.label))
                  .foregroundStyle(.primary)
                Spacer()
                if model.snapshot.status.id == id {
                  Image(systemName: "checkmark")
                    .foregroundStyle(model.accent)
                }
              }
            }
          }
        } header: {
          Text("Status")
        } footer: {
          Text(
            model.snapshot.settings.autoOnCall
              ? "While a calendar event is running Gerdoo shows On Call, then puts this back."
              : "Calendar events are not changing your status.")
        }

        Section("Custom label") {
          TextField("Writing docs", text: $customLabel)
            .onSubmit { choose(.custom) }
        }

        Section("Back at") {
          Toggle("Set a time", isOn: $untilEnabled.animation())
          if untilEnabled {
            DatePicker("Until", selection: $until, displayedComponents: .hourAndMinute)
          }
        }
      }
      .navigationTitle("Status")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
      .onAppear {
        customLabel = model.snapshot.status.customLabel
        if let existing = model.snapshot.status.until {
          untilEnabled = true
          until = existing
        }
      }
    }
  }

  private func choose(_ id: StatusID) {
    model.setStatus(
      id,
      customLabel: customLabel,
      until: untilEnabled ? until : nil)
    dismiss()
  }
}
