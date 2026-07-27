/// The device's colour scheme, ported from `src/shared/palette.ts`.
///
/// By default Gerdoo ships a hand-tuned palette where every semantic role has
/// its own hue. When the user picks an accent colour instead, the whole palette
/// is re-derived from that one hue: roles keep their relative brightness and a
/// small hue rotation, so `break` still reads warmer than `focus` and `paused`
/// still reads muted, but the device looks like one instrument rather than seven.
///
/// A mode can also be given a colour of its own, which wins over both: that hex
/// becomes the lit pixel exactly as picked, and the unlit grid, the bloom and
/// the shell accent are derived from it.
import Foundation

public typealias Palette = [SemanticColor: SemanticColorSpec]

extension Dictionary where Key == SemanticColor, Value == SemanticColorSpec {
  /// Every lookup has a sane answer, so no view has to unwrap a colour.
  public func spec(_ mode: SemanticColor) -> SemanticColorSpec {
    self[mode] ?? semanticColors[mode] ?? semanticColors[.focus]!
  }
}

/// Display order of the modes wherever they are listed — timer first, then statuses.
public let modeOrder: [SemanticColor] = [
  .focus, .break, .paused, .available, .oncall, .meeting, .dnd
]

/// Short enough for the swatch grid in Settings; `modeTitles` says it in full.
public let modeLabels: [SemanticColor: String] = [
  .focus: "Focus", .break: "Break", .paused: "Paused", .available: "Available",
  .oncall: "On call", .meeting: "Meeting", .dnd: "DND"
]

public let modeTitles: [SemanticColor: String] = [
  .focus: "Focus session", .break: "Break", .paused: "Paused session",
  .available: "Available", .oncall: "On call", .meeting: "In meeting",
  .dnd: "Do not disturb"
]

public struct AccentPreset: Identifiable, Sendable {
  public var label: String
  /// nil = the built-in multi-hue palette.
  public var value: String?
  public var id: String { value ?? "default" }
}

/// Offered as swatches in Settings. The first entry restores the default look.
public let accentPresets: [AccentPreset] = [
  AccentPreset(label: "Default", value: nil),
  AccentPreset(label: "Caramel", value: "#c8823c"),
  AccentPreset(label: "Amber", value: "#ffb648"),
  AccentPreset(label: "Blue", value: "#5c86ff"),
  AccentPreset(label: "Cyan", value: "#3fc9e6"),
  AccentPreset(label: "Green", value: "#4fc97a"),
  AccentPreset(label: "Purple", value: "#b78dff"),
  AccentPreset(label: "Pink", value: "#ff6fae"),
  AccentPreset(label: "Red", value: "#ff6a5e"),
  AccentPreset(label: "Slate", value: "#8d99ab")
]

/// `#RGB` / `#RRGGBB` (any case) → `#rrggbb`. Anything else → nil.
public func normalizeAccent(_ value: String?) -> String? {
  guard let value else { return nil }
  var body = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  if body.hasPrefix("#") { body.removeFirst() }
  guard body.count == 3 || body.count == 6 else { return nil }
  guard body.allSatisfy({ $0.isHexDigit }) else { return nil }
  if body.count == 3 { body = body.map { "\($0)\($0)" }.joined() }
  return "#\(body)"
}

/// Keeps only known modes with a parseable colour — a state file or a sync
/// payload can carry anything, and one bad entry would poison a mode.
public func normalizeModeColors(_ value: ModeColors?) -> ModeColors {
  guard let value else { return [:] }
  var result: ModeColors = [:]
  for mode in modeOrder {
    if let color = normalizeAccent(value[mode]) { result[mode] = color }
  }
  return result
}

private struct RoleProfile {
  /// Degrees of hue rotation from the accent — kept small so the family holds.
  var hue: Double
  /// Multiplier on the accent's saturation.
  var sat: Double
  /// Target lightness, blended with the accent's own so both have a say.
  var light: Double
}

private let roleProfiles: [SemanticColor: RoleProfile] = [
  .focus: RoleProfile(hue: 0, sat: 1, light: 0.6),
  .break: RoleProfile(hue: 14, sat: 1, light: 0.72),
  .paused: RoleProfile(hue: 4, sat: 0.55, light: 0.66),
  .oncall: RoleProfile(hue: -18, sat: 1, light: 0.62),
  .meeting: RoleProfile(hue: 26, sat: 0.85, light: 0.74),
  .available: RoleProfile(hue: 0, sat: 0.95, light: 0.68),
  .dnd: RoleProfile(hue: -9, sat: 1, light: 0.64)
]

/// Unlit pixels are the same hue burnt down to a ghost of the grid.
private let inactiveLight = 0.11
private let inactiveMaxSat = 0.7
private let glowAlpha = 0.5

private func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double {
  min(high, max(low, value))
}

public func hexToRGB(_ hex: String) -> (Int, Int, Int) {
  let body = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
  let n = Int(body, radix: 16) ?? 0
  return ((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

func rgbToHSL(_ rgb: (Int, Int, Int)) -> (Double, Double, Double) {
  let rn = Double(rgb.0) / 255
  let gn = Double(rgb.1) / 255
  let bn = Double(rgb.2) / 255
  let maxValue = max(rn, gn, bn)
  let minValue = min(rn, gn, bn)
  let light = (maxValue + minValue) / 2
  let delta = maxValue - minValue
  if delta == 0 { return (0, 0, light) }

  let sat = delta / (1 - abs(2 * light - 1))
  var hue: Double
  if maxValue == rn {
    hue = ((gn - bn) / delta).truncatingRemainder(dividingBy: 6)
  } else if maxValue == gn {
    hue = (bn - rn) / delta + 2
  } else {
    hue = (rn - gn) / delta + 4
  }
  hue = (hue * 60).truncatingRemainder(dividingBy: 360)
  return ((hue + 360).truncatingRemainder(dividingBy: 360), sat, light)
}

func hslToRGB(_ hue: Double, _ sat: Double, _ light: Double) -> (Int, Int, Int) {
  let c = (1 - abs(2 * light - 1)) * sat
  let wrapped = (hue.truncatingRemainder(dividingBy: 360) + 360)
    .truncatingRemainder(dividingBy: 360)
  let h = wrapped / 60
  let x = c * (1 - abs(h.truncatingRemainder(dividingBy: 2) - 1))
  let parts: (Double, Double, Double)
  switch h {
  case ..<1: parts = (c, x, 0)
  case ..<2: parts = (x, c, 0)
  case ..<3: parts = (0, c, x)
  case ..<4: parts = (0, x, c)
  case ..<5: parts = (x, 0, c)
  default: parts = (c, 0, x)
  }
  let m = light - c / 2
  return (
    Int(((parts.0 + m) * 255).rounded()),
    Int(((parts.1 + m) * 255).rounded()),
    Int(((parts.2 + m) * 255).rounded())
  )
}

func rgbToHex(_ rgb: (Int, Int, Int)) -> String {
  String(format: "#%02x%02x%02x", min(255, max(0, rgb.0)), min(255, max(0, rgb.1)),
    min(255, max(0, rgb.2)))
}

private func spec(base: (Double, Double, Double), profile: RoleProfile) -> SemanticColorSpec {
  let hue = base.0 + profile.hue
  let sat = clamp(base.1 * profile.sat, 0, 1)
  // The accent's own lightness only gets half a vote: a near-black or near-white
  // pick still has to light up legibly on the panel.
  let light = clamp(profile.light * 0.55 + base.2 * 0.45, 0.42, 0.82)

  let active = hslToRGB(hue, sat, light)
  return SemanticColorSpec(
    active: rgbToHex(active),
    inactive: rgbToHex(hslToRGB(hue, min(sat, inactiveMaxSat), inactiveLight)),
    glow: RGBA(active.0, active.1, active.2, glowAlpha),
    accent: rgbToHex(hslToRGB(hue, sat * 0.95, light * 0.84))
  )
}

/// A mode the user coloured by hand. Unlike the accent path nothing is clamped:
/// the pick *is* the lit pixel, so what the swatch shows is what the panel lights.
private func specFromActive(_ hex: String) -> SemanticColorSpec {
  let rgb = hexToRGB(hex)
  let (hue, sat, light) = rgbToHSL(rgb)
  return SemanticColorSpec(
    active: hex,
    inactive: rgbToHex(hslToRGB(hue, min(sat, inactiveMaxSat), inactiveLight)),
    glow: RGBA(rgb.0, rgb.1, rgb.2, glowAlpha),
    accent: rgbToHex(hslToRGB(hue, sat * 0.95, light * 0.84))
  )
}

private func derive(accent: String) -> Palette {
  let base = rgbToHSL(hexToRGB(accent))
  var palette: Palette = [:]
  for (role, profile) in roleProfiles {
    palette[role] = spec(base: base, profile: profile)
  }
  return palette
}

/// The palette to render with. Anything unparseable falls back to the default.
///
/// The desktop build memoises this because a canvas engine compares palette
/// identity between frames. SwiftUI compares values, so the cache would only be
/// shared mutable state for no gain — the maths is a handful of multiplications.
public func paletteFor(accentColor: String?, modeColors: ModeColors? = nil) -> Palette {
  let accent = normalizeAccent(accentColor)
  let overrides = normalizeModeColors(modeColors)
  if accent == nil && overrides.isEmpty { return semanticColors }

  var palette = accent.map(derive(accent:)) ?? semanticColors
  for mode in modeOrder {
    if let hex = overrides[mode] { palette[mode] = specFromActive(hex) }
  }
  return palette
}
