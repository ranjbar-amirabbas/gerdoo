import Foundation
import Testing

@testable import GerdooKit

@Suite("Palette derivation")
struct PaletteTests {
  @Test("no accent and no overrides is the hand-tuned default")
  func defaultPalette() {
    let palette = paletteFor(accentColor: nil, modeColors: nil)
    #expect(palette.spec(.focus).active == "#c8823c")
    #expect(palette.spec(.meeting).active == "#b78dff")
  }

  @Test("an accent re-derives every role from one hue")
  func accentDerivation() {
    let palette = paletteFor(accentColor: "#3fc9e6", modeColors: nil)
    let base = rgbToHSL(hexToRGB("#3fc9e6")).0
    // Break sits 14° warm of the accent, and every role stays in that family.
    let focusHue = rgbToHSL(hexToRGB(palette.spec(.focus).active)).0
    let breakHue = rgbToHSL(hexToRGB(palette.spec(.break).active)).0
    #expect(abs(focusHue - base) < 2)
    #expect(abs(breakHue - (base + 14)) < 2)
    // Break still reads brighter than focus, as it does in the default palette.
    #expect(rgbToHSL(hexToRGB(palette.spec(.break).active)).2 > rgbToHSL(hexToRGB(palette.spec(.focus).active)).2)
  }

  @Test("a mode override is the lit pixel exactly as picked")
  func modeOverride() {
    let palette = paletteFor(accentColor: "#3fc9e6", modeColors: [.dnd: "#ff0000"])
    #expect(palette.spec(.dnd).active == "#ff0000")
    #expect(palette.spec(.dnd).glow == RGBA(255, 0, 0, 0.5))
    // Everything else still follows the accent.
    #expect(palette.spec(.focus).active != "#ff0000")
  }

  @Test("a near-black accent still lights up legibly")
  func clampedLightness() {
    let palette = paletteFor(accentColor: "#050505", modeColors: nil)
    let light = rgbToHSL(hexToRGB(palette.spec(.focus).active)).2
    // The floor is 0.42 before the colour is quantised to 8-bit channels.
    #expect(light >= 0.41)
  }

  @Test("shorthand hex is expanded and junk is rejected")
  func normalisation() {
    #expect(normalizeAccent("#ABC") == "#aabbcc")
    #expect(normalizeAccent("4fc97a") == "#4fc97a")
    #expect(normalizeAccent("rebeccapurple") == nil)
    #expect(normalizeAccent(nil) == nil)
    #expect(normalizeModeColors([.focus: "nope", .dnd: "#FFF"]) == [.dnd: "#ffffff"])
  }

  @Test("hsl round-trips through rgb")
  func roundTrip() {
    for hex in ["#c8823c", "#5c86ff", "#b78dff", "#8d99ab"] {
      let (h, s, l) = rgbToHSL(hexToRGB(hex))
      #expect(rgbToHex(hslToRGB(h, s, l)) == hex)
    }
  }
}
