/**
 * Generates the tray images and the app icons, for every platform.
 *
 * Everything is drawn as raw pixels and encoded to PNG (or ICO, which is a
 * container of PNGs) here so the repo carries no binary art that cannot be
 * regenerated: `npm run icons`.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** @param {{width:number,height:number,data:Uint8Array}} image RGBA, row-major */
function encodePng(image) {
  const { width, height, data } = image
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    Buffer.from(data.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * ICO container. Windows picks the entry that matches the current DPI, so an
 * icon file is a set of independently drawn sizes rather than one image scaled
 * down. Each entry holds a whole PNG, which Windows has understood since Vista.
 *
 * @param {Array<{size:number,png:Buffer}>} entries
 */
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(entries.length * 16)
  let offset = header.length + directory.length
  entries.forEach(({ size, png }, index) => {
    const at = index * 16
    directory[at] = size >= 256 ? 0 : size // 0 means 256
    directory[at + 1] = size >= 256 ? 0 : size
    directory[at + 2] = 0 // palette size: none, it is a true-colour image
    directory[at + 3] = 0 // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += png.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)])
}

function createCanvas(size) {
  const data = new Uint8Array(size * size * 4)
  const set = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = a
  }
  return { size, data, set }
}

/** Draws in a 16x16 design grid, scaled up to `size`. */
function drawDevice(canvas, color, { filled = false, bg = null, radius = 0 } = {}) {
  const s = canvas.size / 16
  const px = (gx, gy, gw, gh, c) => {
    for (let y = Math.round(gy * s); y < Math.round((gy + gh) * s); y++) {
      for (let x = Math.round(gx * s); x < Math.round((gx + gw) * s); x++) canvas.set(x, y, c)
    }
  }

  if (bg) {
    const r = radius * s
    for (let y = 0; y < canvas.size; y++) {
      for (let x = 0; x < canvas.size; x++) {
        const cx = Math.min(x, canvas.size - 1 - x)
        const cy = Math.min(y, canvas.size - 1 - y)
        const inCorner = cx < r && cy < r
        if (inCorner && Math.hypot(r - cx, r - cy) > r) continue
        canvas.set(x, y, bg)
      }
    }
  }

  if (filled) {
    px(1.5, 4, 13, 8, color)
    return
  }

  // Shell outline with clipped corners, then three lit "pixels" inside.
  px(2, 3.5, 12, 1, color)
  px(2, 11.5, 12, 1, color)
  px(1.5, 4, 1, 7.5, color)
  px(13.5, 4, 1, 7.5, color)
  px(4.5, 7, 1.5, 1.5, color)
  px(7.25, 7, 1.5, 1.5, color)
  px(10, 7, 1.5, 1.5, color)
}

/**
 * Vector painter for the mascot.
 *
 * Shapes are drawn opaque, in back-to-front order, into a supersampled buffer
 * that is box-filtered down at the end — cheaper to write than per-pixel
 * coverage, and the only anti-aliasing the icon needs. Coordinates are the
 * mascot's own user units (the 200 x 236 space of `Mascot.tsx`), mapped by
 * `scale` / `offset` so the drawing here stays a transcription of the
 * component rather than a second set of numbers.
 */
function createPainter(canvas, scale, offsetX, offsetY) {
  const tx = (x) => x * scale + offsetX
  const ty = (y) => y * scale + offsetY

  const fillEllipse = (cx, cy, rx, ry, color) => {
    const px = tx(cx)
    const py = ty(cy)
    const ax = rx * scale
    const ay = ry * scale
    for (let y = Math.floor(py - ay); y <= Math.ceil(py + ay); y++) {
      for (let x = Math.floor(px - ax); x <= Math.ceil(px + ax); x++) {
        const dx = (x + 0.5 - px) / ax
        const dy = (y + 0.5 - py) / ay
        if (dx * dx + dy * dy <= 1) canvas.set(x, y, color)
      }
    }
  }

  const fillCircle = (cx, cy, r, color) => fillEllipse(cx, cy, r, r, color)

  const fillRoundRect = (x0, y0, w, h, r, color) => {
    for (let y = Math.floor(ty(y0)); y < Math.ceil(ty(y0 + h)); y++) {
      for (let x = Math.floor(tx(x0)); x < Math.ceil(tx(x0 + w)); x++) {
        const lx = (x + 0.5 - tx(x0)) / scale
        const ly = (y + 0.5 - ty(y0)) / scale
        const cx = Math.min(lx, w - lx)
        const cy = Math.min(ly, h - ly)
        if (cx < r && cy < r && Math.hypot(r - cx, r - cy) > r) continue
        canvas.set(x, y, color)
      }
    }
  }

  /** Stroked arc, stamped as a run of dots — used for the wink. */
  const strokeArc = (cx, cy, r, from, to, width, color) => {
    const steps = Math.max(16, Math.round(Math.abs(to - from) * r * scale))
    for (let i = 0; i <= steps; i++) {
      const angle = from + ((to - from) * i) / steps
      fillCircle(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, width / 2, color)
    }
  }

  /** A fluff cluster: outline pass first, then the fill on top of it. */
  const fillCluster = (circles, fill, outline, stroke) => {
    for (const [cx, cy, r] of circles) fillCircle(cx, cy, r + stroke, outline)
    for (const [cx, cy, r] of circles) fillCircle(cx, cy, r, fill)
  }

  return { fillEllipse, fillCircle, fillRoundRect, strokeArc, fillCluster }
}

// The mascot's palette and geometry, kept in step with
// `src/renderer/src/components/Mascot.tsx`.
const FUR_HEAD = [217, 161, 92, 255]
const FUR_BODY = [207, 148, 80, 255]
const FUR_EAR = [191, 132, 66, 255]
const MUZZLE = [240, 199, 140, 255]
const OUTLINE = [79, 47, 20, 255]
const INK = [43, 35, 32, 255]
const TONGUE = [242, 163, 163, 255]
const COLLAR = [217, 52, 43, 255]
const GOLD = [217, 164, 65, 255]
const BONE = [241, 238, 226, 255]
const WHITE = [255, 255, 255, 255]

const EAR = [
  [44, 94, 25],
  [34, 122, 27],
  [38, 148, 22]
]
const BODY = [
  [100, 206, 56],
  [58, 212, 34],
  [142, 212, 34],
  [100, 180, 44]
]
const HEAD = [
  [100, 90, 54],
  [62, 66, 30],
  [138, 66, 30],
  [100, 50, 34],
  [68, 110, 30],
  [132, 110, 30],
  [100, 26, 16],
  [84, 32, 13],
  [116, 32, 13]
]

function drawMascot(p) {
  const STROKE = 2.5
  const mirror = (circles) => circles.map(([x, y, r]) => [200 - x, y, r])

  p.fillCluster(BODY, FUR_BODY, OUTLINE, STROKE)
  p.fillCluster(EAR, FUR_EAR, OUTLINE, STROKE)
  p.fillCluster(mirror(EAR), FUR_EAR, OUTLINE, STROKE)
  p.fillCluster(HEAD, FUR_HEAD, OUTLINE, STROKE)

  p.fillEllipse(100, 122, 39, 31, MUZZLE)

  // Open smile: a dark bowl with the tongue sitting in it.
  p.fillEllipse(100, 134, 25, 14, OUTLINE)
  p.fillEllipse(100, 133, 23, 12, INK)
  p.fillEllipse(100, 142, 14, 9, TONGUE)

  p.fillEllipse(100, 106, 15, 12, INK)
  p.fillEllipse(94, 102, 4, 3, WHITE)

  p.fillEllipse(74, 88, 11, 13, INK)
  p.fillCircle(70, 83, 4, WHITE)
  // The winking eye, matching the component's arc.
  p.strokeArc(129, 96, 13, Math.PI * 1.15, Math.PI * 1.85, 5, INK)

  p.fillRoundRect(58, 164, 84, 19, 8, OUTLINE)
  p.fillRoundRect(60, 166, 80, 15, 6, COLLAR)
  p.fillRoundRect(97.5, 180, 5, 12, 2.5, GOLD)

  // Bone tag: every outline pass first, so the lobes read as one shape.
  const lobes = [
    [88, 194, 7],
    [88, 204, 7],
    [112, 194, 7],
    [112, 204, 7]
  ]
  for (const [cx, cy, r] of lobes) p.fillCircle(cx, cy, r + 2.5, OUTLINE)
  p.fillRoundRect(83.5, 189.5, 33, 19, 8, OUTLINE)
  p.fillRoundRect(86, 192, 28, 14, 6, BONE)
  for (const [cx, cy, r] of lobes) p.fillCircle(cx, cy, r, BONE)
}

const CLEAR = [0, 0, 0, 0]

/**
 * The mascot reduced to a menu bar glyph.
 *
 * A template image is a stencil — macOS keeps the alpha and throws the colour
 * away — so the dog has to survive as a silhouette with holes punched in it.
 * The outline is the mascot's own ear and head clusters, and the face is drawn
 * larger than a literal transcription would be: at 16 px an eye is two pixels,
 * and the mascot's real eyes would vanish.
 */
function drawMascotGlyph(canvas, color) {
  // Bounding box of the ear and head clusters in the mascot's 200 x 236 space.
  const box = { x: 7, y: 10, w: 186, h: 160 }
  const pad = canvas.size * 0.03
  const scale = Math.min((canvas.size - pad * 2) / box.w, (canvas.size - pad * 2) / box.h)
  const p = createPainter(
    canvas,
    scale,
    (canvas.size - box.w * scale) / 2 - box.x * scale,
    (canvas.size - box.h * scale) / 2 - box.y * scale
  )
  const mirror = (circles) => circles.map(([x, y, r]) => [200 - x, y, r])

  // The lowest ear circle is dropped: hanging past the chin, two pixels wide,
  // it read as a pair of feet rather than as fur.
  const ear = EAR.slice(0, 2)
  for (const [cx, cy, r] of [...ear, ...mirror(ear), ...HEAD]) p.fillCircle(cx, cy, r, color)

  // A notch on each side, so the ears read as ears and not as one wide lump.
  p.fillEllipse(66, 146, 13, 11, CLEAR)
  p.fillEllipse(134, 146, 13, 11, CLEAR)

  // Face, punched back out of the silhouette. The muzzle stops short of the
  // chin: punch it any lower and the head loses its bottom edge.
  p.fillCircle(74, 84, 12, CLEAR)
  p.fillCircle(126, 84, 12, CLEAR)
  p.fillEllipse(100, 118, 26, 16, CLEAR)
  p.fillEllipse(100, 110, 11, 7, color)
}

/**
 * The mascot's head in full colour, cropped to the ears and head.
 *
 * Windows has no template images: the tray icon keeps whatever colours it is
 * given, on a taskbar that may be light or dark. The mascot's own dark outline
 * is what makes it readable either way, so it is thickened here — at 16 px the
 * 2.5-unit stroke of `drawMascot` lands well under a pixel and the golden fur
 * ends up floating on a light taskbar with no edge at all.
 *
 * The body, collar and tag are dropped: at tray sizes they collapse into a
 * coloured smudge under the chin and cost the head the pixels it needs.
 */
function drawMascotHead(canvas) {
  // Same crop as the template glyph, so both tray icons frame the dog alike.
  const box = { x: 7, y: 10, w: 186, h: 160 }
  const pad = canvas.size * 0.03
  const scale = Math.min((canvas.size - pad * 2) / box.w, (canvas.size - pad * 2) / box.h)
  const p = createPainter(
    canvas,
    scale,
    (canvas.size - box.w * scale) / 2 - box.x * scale,
    (canvas.size - box.h * scale) / 2 - box.y * scale
  )
  const mirror = (circles) => circles.map(([x, y, r]) => [200 - x, y, r])
  const STROKE = 5

  p.fillCluster(EAR, FUR_EAR, OUTLINE, STROKE)
  p.fillCluster(mirror(EAR), FUR_EAR, OUTLINE, STROKE)
  p.fillCluster(HEAD, FUR_HEAD, OUTLINE, STROKE)

  p.fillEllipse(100, 122, 39, 31, MUZZLE)
  p.fillEllipse(100, 134, 25, 14, OUTLINE)
  p.fillEllipse(100, 133, 23, 12, INK)
  p.fillEllipse(100, 142, 14, 9, TONGUE)

  p.fillEllipse(100, 106, 15, 12, INK)
  p.fillEllipse(94, 102, 4, 3, WHITE)

  // Both eyes are drawn open: the winking arc is a hairline that disappears
  // below about 32 px, leaving the dog with one eye.
  p.fillEllipse(74, 88, 11, 13, INK)
  p.fillCircle(70, 83, 4, WHITE)
  p.fillEllipse(126, 88, 11, 13, INK)
  p.fillCircle(122, 83, 4, WHITE)
}

/** Box-filters a supersampled buffer down to `size`, alpha-weighted so the
    edges of the rounded background do not darken against transparency. */
function downsample(source, size, factor) {
  const out = createCanvas(size)
  const samples = factor * factor
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * source.size + x * factor + sx) * 4
          const alpha = source.data[i + 3]
          r += source.data[i] * alpha
          g += source.data[i + 1] * alpha
          b += source.data[i + 2] * alpha
          a += alpha
        }
      }
      if (a === 0) continue
      out.set(x, y, [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / samples)])
    }
  }
  return out
}

/** Renders `draw` at `size`, supersampled, and returns the PNG bytes. */
function renderPng(size, draw, supersample) {
  const drawn = createCanvas(size * supersample)
  draw(drawn)
  const canvas = supersample > 1 ? downsample(drawn, size, supersample) : drawn
  return encodePng({ width: size, height: size, data: canvas.data })
}

function write(relPath, bytes, note) {
  const file = join(root, relPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, bytes)
  console.log(`wrote ${relPath} (${note})`)
}

function writeIcon(relPath, size, draw, { supersample = 1 } = {}) {
  write(relPath, renderPng(size, draw, supersample), `${size}x${size}`)
}

/** Every size is drawn from scratch, not scaled: small icons need fatter strokes. */
function writeIco(relPath, sizes, draw, { supersample = 1 } = {}) {
  const entries = sizes.map((size) => ({ size, png: renderPng(size, draw, supersample) }))
  write(relPath, encodeIco(entries), `${sizes.join(', ')}`)
}

const BLACK = [0, 0, 0, 255]
const SHELL = [17, 20, 24, 255]

/** Rounded-square backdrop, in the same 16-unit design grid as the tray glyph. */
function fillBackdrop(canvas, color, radius) {
  const r = (radius / 16) * canvas.size
  for (let y = 0; y < canvas.size; y++) {
    for (let x = 0; x < canvas.size; x++) {
      const cx = Math.min(x, canvas.size - 1 - x)
      const cy = Math.min(y, canvas.size - 1 - y)
      if (cx < r && cy < r && Math.hypot(r - cx, r - cy) > r) continue
      canvas.set(x, y, color)
    }
  }
}

// Template images: macOS recolours black-on-alpha for light/dark menu bars.
// The mascot's head, stencilled — see `drawMascotGlyph`.
writeIcon('resources/trayTemplate.png', 16, (c) => drawMascotGlyph(c, BLACK), { supersample: 8 })
writeIcon('resources/trayTemplate@2x.png', 32, (c) => drawMascotGlyph(c, BLACK), {
  supersample: 8
})

// Windows and Linux tray: no template images, so the dog keeps his colours and
// relies on his outline to survive a light or a dark taskbar.
writeIco('resources/tray.ico', [16, 20, 24, 32, 40, 48, 64], drawMascotHead, { supersample: 8 })
writeIcon('resources/tray.png', 32, drawMascotHead, { supersample: 8 })
writeIcon('resources/tray@2x.png', 64, drawMascotHead, { supersample: 8 })

/** The mascot on the device shell — the app icon, at any size. */
function drawAppIcon(canvas) {
  fillBackdrop(canvas, SHELL, 3.4)
  // Fit the 200 x 236 mascot box into the middle of the icon, sitting a
  // little low so the head lands on the optical centre.
  const scale = (canvas.size * 0.8) / 236
  const offsetX = (canvas.size - 200 * scale) / 2
  const offsetY = (canvas.size - 236 * scale) / 2 + canvas.size * 0.02
  drawMascot(createPainter(canvas, scale, offsetX, offsetY))
}

// App icon: drawn at 3x and filtered down. macOS and Linux take the PNG;
// Windows needs a real ICO for the executable, the installer and the taskbar.
writeIcon('build/icon.png', 1024, drawAppIcon, { supersample: 3 })
writeIco('build/icon.ico', [16, 24, 32, 48, 64, 128, 256], drawAppIcon, { supersample: 4 })

// iOS and watchOS take a single 1024 and derive every size themselves, so the
// asset catalogues get the same drawing the desktop icon is made of.
writeIcon('apple/Gerdoo/Assets.xcassets/AppIcon.appiconset/icon-1024.png', 1024, drawAppIcon, {
  supersample: 3
})
writeIcon(
  'apple/GerdooWatch/Assets.xcassets/AppIcon.appiconset/icon-1024.png',
  1024,
  drawAppIcon,
  { supersample: 3 }
)
