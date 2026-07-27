import GerdooKit
import SwiftUI

struct WatchStatusView: View {
  @EnvironmentObject private var model: GerdooModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        Text("Status")
          .font(.headline)
          .foregroundStyle(DeviceTokens.textDim)

        ForEach(statusOrder.filter { $0 != .custom }, id: \.self) { id in
          Button {
            model.setStatus(id)
          } label: {
            HStack(spacing: 8) {
              Image(systemName: id.meta.symbol)
                .foregroundStyle(model.palette.spec(id.meta.color).activeColor)
              Text(titleCase(id.meta.label))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
              Spacer()
              if model.snapshot.status.id == id {
                Image(systemName: "checkmark")
                  .font(.caption)
              }
            }
          }
          .buttonStyle(.bordered)
          .tint(
            model.snapshot.status.id == id
              ? model.palette.spec(id.meta.color).accentColor : Color.gray.opacity(0.35))
        }

        if model.snapshot.settings.autoOnCall {
          Text("Meetings switch this to On Call, then put it back.")
            .font(.caption2)
            .foregroundStyle(DeviceTokens.textFaint)
        }
      }
      .padding(.horizontal, 4)
    }
  }
}

struct WatchUpNextView: View {
  @EnvironmentObject private var model: GerdooModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 10) {
        Text(model.snapshot.calendar.current != nil ? "Now" : "Up next")
          .font(.headline)
          .foregroundStyle(DeviceTokens.textDim)

        let days = groupByDay(model.snapshot.calendar.events, now: Date())
        if days.isEmpty {
          Text(model.snapshot.calendar.detail ?? "Nothing in the next seven days.")
            .font(.caption2)
            .foregroundStyle(DeviceTokens.textFaint)
        } else {
          ForEach(days.prefix(3)) { day in
            VStack(alignment: .leading, spacing: 4) {
              Text(day.label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(model.accent)
              ForEach(day.events.prefix(4)) { event in
                HStack(alignment: .top, spacing: 6) {
                  Text(event.isAllDay ? "—" : formatClock(event.startsAt))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(DeviceTokens.textFaint)
                    .frame(width: 38, alignment: .leading)
                  Text(event.title)
                    .font(.caption2)
                    .lineLimit(2)
                }
              }
            }
          }
        }
      }
      .padding(.horizontal, 4)
    }
  }
}
