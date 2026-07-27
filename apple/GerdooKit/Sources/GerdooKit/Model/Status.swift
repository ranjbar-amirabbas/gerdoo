/// Semantic colours and status metadata, ported from `src/shared/status.ts`.
import Foundation

public struct RGBA: Equatable, Sendable {
  public var red: Int
  public var green: Int
  public var blue: Int
  public var alpha: Double

  public init(_ red: Int, _ green: Int, _ blue: Int, _ alpha: Double) {
    self.red = red
    self.green = green
    self.blue = blue
    self.alpha = alpha
  }
}

public struct SemanticColorSpec: Equatable, Sendable {
  /// Lit pixel colour, `#rrggbb`.
  public var active: String
  /// Unlit pixel colour — the ghost grid of the panel.
  public var inactive: String
  /// Bloom halo colour.
  public var glow: RGBA
  /// Accent used by the shell (button rings, status dot).
  public var accent: String

  public init(active: String, inactive: String, glow: RGBA, accent: String) {
    self.active = active
    self.inactive = inactive
    self.glow = glow
    self.accent = accent
  }
}

/// The hand-tuned default palette: every role has a hue of its own.
public let semanticColors: [SemanticColor: SemanticColorSpec] = [
  .focus: SemanticColorSpec(
    active: "#c8823c", inactive: "#2a1a09", glow: RGBA(200, 130, 60, 0.55), accent: "#b8763a"),
  .break: SemanticColorSpec(
    active: "#ffbd5c", inactive: "#2a1d0c", glow: RGBA(255, 178, 74, 0.5), accent: "#f5a742"),
  .paused: SemanticColorSpec(
    active: "#e0b070", inactive: "#221a10", glow: RGBA(224, 176, 112, 0.38), accent: "#c99a5e"),
  .oncall: SemanticColorSpec(
    active: "#ff6a5e", inactive: "#2b1010", glow: RGBA(255, 90, 80, 0.5), accent: "#f2564a"),
  .meeting: SemanticColorSpec(
    active: "#b78dff", inactive: "#1d1330", glow: RGBA(170, 130, 255, 0.5), accent: "#9b74f0"),
  .available: SemanticColorSpec(
    active: "#5c86ff", inactive: "#0c1230", glow: RGBA(76, 112, 255, 0.45), accent: "#3f6be0"),
  .dnd: SemanticColorSpec(
    active: "#ff8a4c", inactive: "#2b1608", glow: RGBA(255, 130, 70, 0.5), accent: "#f57a3c")
]

public struct StatusMeta: Sendable {
  public var id: StatusID
  /// Shouted, because the LED panel is.
  public var label: String
  /// Sub-label shown under the main line when no dynamic hint applies.
  public var sub: String
  public var color: SemanticColor
  /// Whether the big LED line shows the wall clock for this status.
  public var showsClock: Bool
  /// SF Symbol used wherever a status needs an icon — menus, complications.
  public var symbol: String
}

public let statuses: [StatusID: StatusMeta] = [
  .available: StatusMeta(
    id: .available, label: "AVAILABLE", sub: "READY TO FOCUS", color: .available,
    showsClock: true, symbol: "circle.dotted"),
  .oncall: StatusMeta(
    id: .oncall, label: "ON CALL", sub: "DO NOT DISTURB", color: .oncall,
    showsClock: false, symbol: "phone.fill"),
  .meeting: StatusMeta(
    id: .meeting, label: "IN MEETING", sub: "", color: .meeting,
    showsClock: false, symbol: "person.2.fill"),
  .dnd: StatusMeta(
    id: .dnd, label: "DO NOT DISTURB", sub: "", color: .dnd,
    showsClock: false, symbol: "moon.fill"),
  .custom: StatusMeta(
    id: .custom, label: "CUSTOM", sub: "", color: .available,
    showsClock: true, symbol: "text.bubble.fill")
]

public let statusOrder: [StatusID] = [.available, .oncall, .meeting, .dnd, .custom]

extension StatusID {
  public var meta: StatusMeta { statuses[self] ?? statuses[.available]! }
}
