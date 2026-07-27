/// The dot-matrix panel, ported from `src/renderer/src/led/{engine.ts,LedPanel.tsx}`.
///
/// The canvas engine on the desktop keeps two dot buffers and cross-fades them
/// so a mode change reads like a physical panel repainting itself. This does the
/// same thing, with a `Canvas` and a `TimelineView` that only runs while a
/// transition is in flight — a static panel costs nothing between seconds.
///
/// The unlit grid is one filled path (a single draw call), and every lit dot is
/// the same resolved symbol blitted with `plusLighter`, so a frame only pays for
/// the dots that are actually alight.
import SwiftUI

public enum LedTransition {
  case sweep
  case fade
  case none
}

private let sweepDuration: TimeInterval = 0.26
private let fadeDuration: TimeInterval = 0.15
/// How far the sweep leads across the panel — higher means a steeper wipe.
private let sweepLead = 0.65

/// Which dot grid a surface gets. The screen sizes are far enough apart that one
/// grid cannot serve them: 140 columns on a 40 mm watch would draw a 7-dot-tall
/// label about a millimetre high.
public enum LedLayout: Equatable {
  /// The full device: label, countdown, sub-label. 140 × 34, as on the desktop.
  case full
  /// One centred line — the countdown alone.
  case compact
  /// Label over countdown, sized for a watch face.
  case watch

  public var cols: Int {
    switch self {
    case .full: 140
    case .compact: 64
    case .watch: 64
    }
  }

  public var rows: Int {
    switch self {
    case .full: 34
    case .compact: 18
    case .watch: 24
    }
  }

  /// Panel aspect ratio, so a caller can reserve the right box for it.
  public var aspectRatio: CGFloat { CGFloat(cols) / CGFloat(rows) }

  func lines(for content: LedContent) -> [LedLine] {
    switch self {
    case .full:
      if !content.big.isEmpty {
        return [
          LedLine(text: content.label, font: .small, scale: 1, row: 2),
          LedLine(text: content.big, font: .big, scale: 1, row: 11),
          LedLine(text: content.sub, font: .small, scale: 1, row: 27)
        ]
      }
      // No countdown: the status label becomes the focal line.
      return [
        LedLine(text: content.label, font: .small, scale: 2, row: 7),
        LedLine(text: content.sub, font: .small, scale: 1, row: 24)
      ]

    case .compact:
      let centre = { (height: Int) in (self.rows - height) / 2 }
      if !content.big.isEmpty {
        return [LedLine(text: content.big, font: .big, scale: 1, row: centre(LedFonts.big.height))]
      }
      let scale = LedFonts.small.measure(content.label, scale: 2) <= cols ? 2 : 1
      return [
        LedLine(
          text: content.label, font: .small, scale: scale,
          row: centre(LedFonts.small.height * scale))
      ]

    case .watch:
      if !content.big.isEmpty {
        return [
          LedLine(text: content.label, font: .small, scale: 1, row: 1),
          LedLine(text: content.big, font: .big, scale: 1, row: 9)
        ]
      }
      let scale = LedFonts.small.measure(content.label, scale: 2) <= cols ? 2 : 1
      return [
        LedLine(
          text: content.label, font: .small, scale: scale,
          row: (rows - LedFonts.small.height * scale) / 2)
      ]
    }
  }
}

struct LedLine {
  enum Face { case small, big }
  var text: String
  var font: Face
  var scale: Int
  /// Top row of the line, in dots.
  var row: Int

  var bitmapFont: BitmapFont { font == .big ? LedFonts.big : LedFonts.small }
}

/// Lit mask for a set of lines. Pure, so it can be reused by a widget that has
/// no view lifecycle to hang state off.
func rasterize(_ lines: [LedLine], cols: Int, rows: Int) -> [Bool] {
  var buffer = [Bool](repeating: false, count: cols * rows)
  for line in lines {
    let font = line.bitmapFont
    var scale = max(1, line.scale)
    var width = font.measure(line.text, scale: scale)
    // Never let a long label bleed off the panel — drop to a tighter scale first.
    if width > cols, scale > 1 {
      scale = 1
      width = font.measure(line.text, scale: 1)
    }
    var x = (cols - width) / 2

    for char in line.text {
      let glyph = font.glyph(for: char)
      for gy in 0..<glyph.height {
        for gx in 0..<glyph.width where glyph.mask[gy][gx] {
          for sy in 0..<scale {
            for sx in 0..<scale {
              let px = x + gx * scale + sx
              let py = line.row + gy * scale + sy
              guard px >= 0, py >= 0, px < cols, py < rows else { continue }
              buffer[py * cols + px] = true
            }
          }
        }
      }
      x += glyph.width * scale + font.tracking * scale
    }
  }
  return buffer
}

/// Per-dot intensity jitter — the tiny unevenness of a real LED array. The hash
/// is deterministic, so the panel's texture is stable between redraws.
private func jitter(_ index: Int) -> Double {
  let h = sin(Double(index) * 12.9898) * 43758.5453
  return 0.9 + (h - h.rounded(.down)) * 0.1
}

public struct LedPanelView: View {
  private let content: LedContent
  private let palette: Palette
  private let brightness: Double
  private let reduceMotion: Bool
  private let layout: LedLayout

  @State private var target: [Bool] = []
  @State private var previous: [Bool] = []
  @State private var transition: LedTransition = .none
  @State private var transitionStart = Date.distantPast
  @State private var lastContent: LedContent?

  public init(
    content: LedContent,
    palette: Palette,
    brightness: Double = 0.85,
    reduceMotion: Bool = false,
    layout: LedLayout = .full
  ) {
    self.content = content
    self.palette = palette
    self.brightness = brightness
    self.reduceMotion = reduceMotion
    self.layout = layout
  }

  private var spec: SemanticColorSpec { palette.spec(content.color) }

  private var duration: TimeInterval {
    switch transition {
    case .sweep: sweepDuration
    case .fade: fadeDuration
    case .none: 0
    }
  }

  public var body: some View {
    GeometryReader { proxy in
      let pitch = min(proxy.size.width / CGFloat(layout.cols), proxy.size.height / CGFloat(layout.rows))
      TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: transition == .none)) { timeline in
        Canvas(rendersAsynchronously: false) { context, size in
          draw(context: context, size: size, pitch: pitch, at: timeline.date)
        } symbols: {
          GlowDot(spec: spec, pitch: pitch).tag(0)
        }
      }
    }
    .aspectRatio(layout.aspectRatio, contentMode: .fit)
    .onAppear { apply(content, animated: false) }
    .onChange(of: content) { _, new in apply(new, animated: true) }
    .accessibilityElement()
    .accessibilityLabel(
      "\(titleCase(content.label)). \(content.big). \(titleCase(content.sub))")
  }

  // ------------------------------------------------------------------ content

  private func apply(_ new: LedContent, animated: Bool) {
    let lines = layout.lines(for: new)
    let mask = rasterize(lines, cols: layout.cols, rows: layout.rows)
    let old = lastContent
    lastContent = new

    var kind: LedTransition = .none
    if animated, let old {
      if old.transitionKey != new.transitionKey {
        kind = .sweep
      } else if old.label != new.label || old.sub != new.sub {
        kind = .fade
      }
    }
    // A ticking countdown repaints instantly — physical panels do not fade digits.
    if reduceMotion { kind = .none }

    previous = target.count == mask.count ? target : mask
    target = mask
    transition = kind
    guard kind != .none else { return }
    transitionStart = Date()
    let ends = duration
    DispatchQueue.main.asyncAfter(deadline: .now() + ends) {
      // Only the transition that armed this one gets to end it.
      if Date().timeIntervalSince(transitionStart) >= ends - 0.001 { transition = .none }
    }
  }

  /// 0 → the dot still shows the old frame, 1 → it has fully repainted.
  private func dotProgress(index: Int, progress: Double) -> Double {
    guard transition == .sweep else { return progress }
    let col = Double(index % layout.cols)
    let columnStart = (col / Double(layout.cols)) * sweepLead
    let scaled = (progress * (1 + sweepLead) - columnStart) / (1 - sweepLead * 0.35)
    return min(1, max(0, scaled))
  }

  // ------------------------------------------------------------------ drawing

  private func draw(context: GraphicsContext, size: CGSize, pitch: CGFloat, at date: Date) {
    guard pitch > 0, !target.isEmpty else { return }
    let cols = layout.cols
    let rows = layout.rows
    let offsetX = (size.width - CGFloat(cols) * pitch) / 2 + pitch / 2
    let offsetY = (size.height - CGFloat(rows) * pitch) / 2 + pitch / 2
    let radius = pitch * 0.3

    // The unlit grid: one path, one fill.
    var grid = Path()
    for y in 0..<rows {
      for x in 0..<cols {
        let centre = CGPoint(
          x: offsetX + CGFloat(x) * pitch, y: offsetY + CGFloat(y) * pitch)
        grid.addEllipse(
          in: CGRect(
            x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
      }
    }
    context.fill(grid, with: .color(spec.inactiveColor))

    guard let sprite = context.resolveSymbol(id: 0) else { return }
    let progress =
      transition == .none
      ? 1 : min(1, max(0, date.timeIntervalSince(transitionStart) / max(0.001, duration)))

    var lit = context
    lit.blendMode = .plusLighter
    for index in 0..<target.count {
      let value: Double
      if transition == .none {
        value = target[index] ? 1 : 0
      } else {
        let p = dotProgress(index: index, progress: progress)
        let was = (index < previous.count && previous[index]) ? 1.0 : 0.0
        value = was * (1 - p) + (target[index] ? 1.0 : 0.0) * p
      }
      guard value > 0.02 else { continue }
      lit.opacity = min(1, value * brightness * jitter(index))
      lit.draw(
        sprite,
        at: CGPoint(
          x: offsetX + CGFloat(index % cols) * pitch,
          y: offsetY + CGFloat(index / cols) * pitch))
    }
  }
}

/// Core dot plus a restrained halo — resolved once per frame and blitted per lit dot.
private struct GlowDot: View {
  let spec: SemanticColorSpec
  let pitch: CGFloat

  var body: some View {
    let size = max(6, pitch * 3.2)
    let core = pitch * 0.36
    ZStack {
      RadialGradient(
        stops: [
          .init(color: spec.glowColor, location: 0),
          .init(color: Color(spec.glow, alpha: 0.18), location: 0.45),
          .init(color: .clear, location: 1)
        ],
        center: .center,
        startRadius: core * 0.6,
        endRadius: size / 2)
      Circle()
        .fill(spec.activeColor)
        .frame(width: core * 2, height: core * 2)
    }
    .frame(width: size, height: size)
  }
}
