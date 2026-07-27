import SwiftUI

extension Color {
  /// `#rrggbb` — the form every colour in the palette is stored in.
  public init(hex: String) {
    let (r, g, b) = hexToRGB(hex)
    self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
  }

  init(_ rgba: RGBA, alpha: Double? = nil) {
    self.init(
      .sRGB, red: Double(rgba.red) / 255, green: Double(rgba.green) / 255,
      blue: Double(rgba.blue) / 255, opacity: alpha ?? rgba.alpha)
  }
}

extension SemanticColorSpec {
  public var activeColor: Color { Color(hex: active) }
  public var inactiveColor: Color { Color(hex: inactive) }
  public var accentColor: Color { Color(hex: accent) }
  public var glowColor: Color { Color(glow) }
}
