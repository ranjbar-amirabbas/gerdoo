/// The mascot — a toy poodle who lives behind the panel, ported from
/// `src/renderer/src/components/Mascot.tsx`.
///
/// Hand-authored geometry so nothing ships as a raster asset: the fluffy
/// silhouette is a cluster of circles drawn twice, once with a thick stroke for
/// the outline and once fill-only on top, which hides the interior strokes.
import SwiftUI

private let outline = Color(hex: "#4f2f14")
private let strokeWidth: CGFloat = 5

/// The SVG viewBox, padded so the sway never clips an ear.
private let viewBox = CGRect(x: -18, y: -22, width: 236, height: 278)

private func cluster(_ circles: [(CGFloat, CGFloat, CGFloat)]) -> Path {
  var path = Path()
  for (x, y, r) in circles {
    path.addEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
  }
  return path
}

private let earCluster = cluster([(44, 94, 25), (34, 122, 27), (38, 148, 22)])
private let bodyCluster = cluster([(100, 206, 56), (58, 212, 34), (142, 212, 34), (100, 180, 44)])
private let headCluster = cluster([
  (100, 90, 54), (62, 66, 30), (138, 66, 30), (100, 50, 34), (68, 110, 30), (132, 110, 30),
  (100, 26, 16), (84, 32, 13), (116, 32, 13)
])

public struct MascotView: View {
  private let animated: Bool
  @State private var swaying = false

  public init(animated: Bool = true) {
    self.animated = animated
  }

  public var body: some View {
    Canvas { context, size in
      // Map the design box onto whatever we were given, keeping the aspect.
      let scale = min(size.width / viewBox.width, size.height / viewBox.height)
      context.translateBy(
        x: (size.width - viewBox.width * scale) / 2,
        y: (size.height - viewBox.height * scale) / 2)
      context.scaleBy(x: scale, y: scale)
      context.translateBy(x: -viewBox.minX, y: -viewBox.minY)
      draw(in: &context)
    }
    .rotationEffect(.degrees(swaying ? 2.4 : -2.4), anchor: .bottom)
    .offset(y: swaying ? -3 : 3)
    .onAppear {
      guard animated else { return }
      withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) {
        swaying = true
      }
    }
    .accessibilityHidden(true)
  }

  private func draw(in context: inout GraphicsContext) {
    func plate(_ path: Path, _ fill: Color) {
      context.stroke(path, with: .color(outline), lineWidth: strokeWidth)
      context.fill(path, with: .color(fill))
    }

    // chest
    plate(bodyCluster, Color(hex: "#cf9450"))

    // ears — the right one is the left one mirrored about the body's axis
    plate(earCluster, Color(hex: "#bf8442"))
    var mirrored = context
    mirrored.translateBy(x: 200, y: 0)
    mirrored.scaleBy(x: -1, y: 1)
    mirrored.stroke(earCluster, with: .color(outline), lineWidth: strokeWidth)
    mirrored.fill(earCluster, with: .color(Color(hex: "#bf8442")))

    plate(headCluster, Color(hex: "#d9a15c"))

    // muzzle, nose and its highlight
    context.fill(
      Path(ellipseIn: CGRect(x: 61, y: 91, width: 78, height: 62)),
      with: .color(Color(hex: "#f0c78c")))
    context.fill(
      Path(ellipseIn: CGRect(x: 85, y: 94, width: 30, height: 24)),
      with: .color(Color(hex: "#2b2320")))
    context.fill(
      Path(ellipseIn: CGRect(x: 90, y: 99, width: 8, height: 6)),
      with: .color(.white.opacity(0.75)))
    var philtrum = Path()
    philtrum.move(to: CGPoint(x: 100, y: 118))
    philtrum.addLine(to: CGPoint(x: 100, y: 127))
    context.stroke(
      philtrum, with: .color(outline), style: StrokeStyle(lineWidth: 3, lineCap: .round))

    // open smile with a tongue
    var mouth = Path()
    mouth.move(to: CGPoint(x: 78, y: 130))
    mouth.addCurve(
      to: CGPoint(x: 122, y: 130), control1: CGPoint(x: 85, y: 150),
      control2: CGPoint(x: 115, y: 150))
    mouth.addCurve(
      to: CGPoint(x: 78, y: 130), control1: CGPoint(x: 117, y: 152),
      control2: CGPoint(x: 83, y: 152))
    mouth.closeSubpath()
    context.fill(mouth, with: .color(Color(hex: "#2b2320")))
    context.stroke(
      mouth, with: .color(outline), style: StrokeStyle(lineWidth: 3, lineJoin: .round))
    context.fill(
      Path(ellipseIn: CGRect(x: 86, y: 133, width: 28, height: 18)),
      with: .color(Color(hex: "#f2a3a3")))

    // one eye open, one winking
    context.fill(
      Path(ellipseIn: CGRect(x: 63, y: 75, width: 22, height: 26)),
      with: .color(Color(hex: "#2b2320")))
    context.fill(
      Path(ellipseIn: CGRect(x: 66, y: 79, width: 8, height: 8)), with: .color(.white))
    var wink = Path()
    wink.move(to: CGPoint(x: 116, y: 90))
    wink.addCurve(
      to: CGPoint(x: 142, y: 90), control1: CGPoint(x: 124, y: 81),
      control2: CGPoint(x: 134, y: 81))
    context.stroke(
      wink, with: .color(Color(hex: "#2b2320")),
      style: StrokeStyle(lineWidth: 5, lineCap: .round))

    // collar, and the bone tag hanging off it
    var collar = Path()
    collar.move(to: CGPoint(x: 60, y: 166))
    collar.addCurve(
      to: CGPoint(x: 140, y: 166), control1: CGPoint(x: 86, y: 178),
      control2: CGPoint(x: 114, y: 178))
    collar.addLine(to: CGPoint(x: 140, y: 181))
    collar.addCurve(
      to: CGPoint(x: 60, y: 181), control1: CGPoint(x: 114, y: 193),
      control2: CGPoint(x: 86, y: 193))
    collar.closeSubpath()
    context.fill(collar, with: .color(Color(hex: "#d9342b")))
    context.stroke(
      collar, with: .color(outline), style: StrokeStyle(lineWidth: 4, lineJoin: .round))

    var link = Path()
    link.move(to: CGPoint(x: 100, y: 182))
    link.addLine(to: CGPoint(x: 100, y: 191))
    context.stroke(
      link, with: .color(Color(hex: "#d9a441")),
      style: StrokeStyle(lineWidth: 5, lineCap: .round))

    var tag = Path()
    tag.addRoundedRect(
      in: CGRect(x: 86, y: 192, width: 28, height: 14), cornerSize: CGSize(width: 6, height: 6))
    for (x, y) in [(88.0, 194.0), (88.0, 204.0), (112.0, 194.0), (112.0, 204.0)] {
      tag.addEllipse(in: CGRect(x: x - 7, y: y - 7, width: 14, height: 14))
    }
    context.stroke(tag, with: .color(outline), lineWidth: 4)
    context.fill(tag, with: .color(Color(hex: "#f1eee2")))
  }
}
