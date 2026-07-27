/// The hardware shell the panel sits in — the same tokens as
/// `src/renderer/src/styles/{tokens,device}.css`, so the phone and the desktop
/// are recognisably the same instrument.
import SwiftUI

public enum DeviceTokens {
  public static let shellTop = Color(hex: "#2b2f36")
  public static let shellMid = Color(hex: "#1c2026")
  public static let shellBottom = Color(hex: "#101317")
  public static let screen = Color(hex: "#05070a")
  public static let bezelTop = Color(hex: "#0a0d11")
  public static let keyTop = Color(hex: "#34393f")
  public static let keyMid = Color(hex: "#23272d")
  public static let keyBottom = Color(hex: "#1a1e23")
  public static let text = Color(hex: "#e8eaed")
  public static let textDim = Color(hex: "#9aa2ad")
  public static let textFaint = Color(hex: "#6a727d")
  public static let edge = Color.white.opacity(0.09)
  public static let edgeStrong = Color.white.opacity(0.16)

  /// Etched, wide-tracked capitals — the legend printed on a real device.
  public static func legend(_ size: CGFloat = 10) -> Font {
    .system(size: size, weight: .semibold, design: .rounded)
  }
}

/// The screen: the mascot behind a transparent dot grid, then the glass.
public struct DeviceScreen: View {
  private let content: LedContent
  private let palette: Palette
  private let brightness: Double
  private let reduceMotion: Bool
  private let layout: LedLayout
  private let showsMascot: Bool

  public init(
    content: LedContent,
    palette: Palette,
    brightness: Double = 0.85,
    reduceMotion: Bool = false,
    layout: LedLayout = .full,
    showsMascot: Bool = true
  ) {
    self.content = content
    self.palette = palette
    self.brightness = brightness
    self.reduceMotion = reduceMotion
    self.layout = layout
    self.showsMascot = showsMascot
  }

  public var body: some View {
    ZStack {
      LinearGradient(
        colors: [DeviceTokens.bezelTop, DeviceTokens.screen],
        startPoint: .top, endPoint: .bottom)

      if showsMascot {
        // The dog reads through the panel like a backlit sheet behind it.
        MascotView(animated: !reduceMotion)
          .padding(.vertical, 6)
          .opacity(0.16)
          .blendMode(.plusLighter)
      }

      LedPanelView(
        content: content, palette: palette, brightness: brightness,
        reduceMotion: reduceMotion, layout: layout)
      .padding(.horizontal, 10)
      .padding(.vertical, 6)

      Glass()
    }
    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .strokeBorder(Color.black.opacity(0.85), lineWidth: 1))
  }
}

/// A sheen across the top third plus the scanlines of a coarse panel.
private struct Glass: View {
  var body: some View {
    ZStack {
      LinearGradient(
        colors: [.white.opacity(0.05), .clear, .black.opacity(0.18)],
        startPoint: .topLeading, endPoint: .bottomTrailing)
      Canvas { context, size in
        var lines = Path()
        var y: CGFloat = 0
        while y < size.height {
          lines.addRect(CGRect(x: 0, y: y, width: size.width, height: 1))
          y += 3
        }
        context.fill(lines, with: .color(.black.opacity(0.12)))
      }
    }
    .allowsHitTesting(false)
  }
}

/// The moulded shell around everything.
public struct DeviceShell<Content: View>: View {
  private let accent: Color
  private let content: Content

  public init(accent: Color, @ViewBuilder content: () -> Content) {
    self.accent = accent
    self.content = content()
  }

  public var body: some View {
    content
      .padding(14)
      .background(
        LinearGradient(
          stops: [
            .init(color: DeviceTokens.shellTop, location: 0),
            .init(color: DeviceTokens.shellMid, location: 0.55),
            .init(color: DeviceTokens.shellBottom, location: 1)
          ],
          startPoint: .top, endPoint: .bottom))
      .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .strokeBorder(DeviceTokens.edge, lineWidth: 1))
      .shadow(color: .black.opacity(0.55), radius: 22, y: 12)
  }
}

/// A moulded key. `primary` gets the accent ring the desktop gives its start key.
public struct DeviceButton: View {
  public enum Kind { case primary, standard }

  private let title: String
  private let symbol: String?
  private let kind: Kind
  private let accent: Color
  private let action: () -> Void

  public init(
    _ title: String, symbol: String? = nil, kind: Kind = .standard, accent: Color,
    action: @escaping () -> Void
  ) {
    self.title = title
    self.symbol = symbol
    self.kind = kind
    self.accent = accent
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if let symbol { Image(systemName: symbol) }
        if !title.isEmpty {
          Text(title)
            .font(DeviceTokens.legend(11))
            .tracking(1.6)
        }
      }
      .foregroundStyle(kind == .primary ? accent : DeviceTokens.text)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 12)
      .background(
        LinearGradient(
          stops: [
            .init(color: DeviceTokens.keyTop, location: 0),
            .init(color: DeviceTokens.keyMid, location: 0.55),
            .init(color: DeviceTokens.keyBottom, location: 1)
          ],
          startPoint: .top, endPoint: .bottom))
      .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 9, style: .continuous)
          .strokeBorder(
            kind == .primary ? accent.opacity(0.65) : Color.white.opacity(0.1),
            lineWidth: kind == .primary ? 1.5 : 1))
    }
    .buttonStyle(.plain)
    .contentShape(Rectangle())
  }
}

/// The etched legend above a control.
public struct DeviceLegend: View {
  private let text: String

  public init(_ text: String) {
    self.text = text
  }

  public var body: some View {
    Text(text.uppercased())
      .font(DeviceTokens.legend(9))
      .tracking(2.2)
      .foregroundStyle(DeviceTokens.textFaint)
  }
}
