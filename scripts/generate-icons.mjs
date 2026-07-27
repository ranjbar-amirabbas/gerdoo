/**
 * Generates the tray template images and the app icon.
 *
 * Everything is drawn as raw pixels and encoded to PNG here so the repo carries
 * no binary art that cannot be regenerated: `npm run icons`.
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

function writeIcon(relPath, size, draw) {
  const canvas = createCanvas(size)
  draw(canvas)
  const file = join(root, relPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, encodePng({ width: size, height: size, data: canvas.data }))
  console.log(`wrote ${relPath} (${size}x${size})`)
}

const BLACK = [0, 0, 0, 255]
const CYAN = [111, 211, 255, 255]
const SHELL = [17, 20, 24, 255]

// Template images: macOS recolours black-on-alpha for light/dark menu bars.
writeIcon('resources/trayTemplate.png', 16, (c) => drawDevice(c, BLACK))
writeIcon('resources/trayTemplate@2x.png', 32, (c) => drawDevice(c, BLACK))
// App icon for packaging.
writeIcon('build/icon.png', 1024, (c) => drawDevice(c, CYAN, { bg: SHELL, radius: 3.4 }))
