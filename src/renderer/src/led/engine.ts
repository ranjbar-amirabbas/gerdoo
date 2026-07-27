import { BIG_FONT, SMALL_FONT, glyphFor, measureText, type BitmapFont } from '@shared/led-font'
import type { SemanticColorSpec } from '@shared/status'

export interface LedLineSpec {
  text: string
  font: 'small' | 'big'
  scale: number
  /** Top row of the line, in dots. */
  row: number
}

export type LedTransition = 'sweep' | 'fade' | 'none'

interface Geometry {
  cols: number
  rows: number
  cssWidth: number
  cssHeight: number
  dpr: number
  pitch: number
}

type DotBuffer = Float32Array<ArrayBufferLike>

const SWEEP_MS = 260
const FADE_MS = 150
/** How far the sweep leads across the panel — higher means a steeper wipe. */
const SWEEP_LEAD = 0.65

function fontOf(name: 'small' | 'big'): BitmapFont {
  return name === 'big' ? BIG_FONT : SMALL_FONT
}

/**
 * Canvas renderer for the dot-matrix panel.
 *
 * Two buffers (previous / target) are cross-faded so mode changes read like a
 * physical panel repainting itself. The unlit dot grid is pre-rendered once and
 * blitted, so a frame only pays for the dots that are actually lit.
 */
export class LedEngine {
  private readonly ctx: CanvasRenderingContext2D
  private geometry: Geometry = { cols: 0, rows: 0, cssWidth: 0, cssHeight: 0, dpr: 1, pitch: 0 }
  private colors: SemanticColorSpec | null = null
  private brightness = 0.85

  private target: DotBuffer = new Float32Array(0)
  private previous: DotBuffer = new Float32Array(0)
  /** Per-dot intensity jitter — the tiny unevenness of a real LED array. */
  private jitter: DotBuffer = new Float32Array(0)

  private gridCanvas: HTMLCanvasElement | null = null
  private sprite: HTMLCanvasElement | null = null
  private spriteSize = 0

  private animation: { start: number; duration: number; kind: LedTransition } | null = null
  private frame = 0
  private lastLines: LedLineSpec[] = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
  }

  setGeometry(cols: number, rows: number, cssWidth: number, cssHeight: number, dpr: number): void {
    const pitch = Math.min(cssWidth / cols, cssHeight / rows)
    const same =
      this.geometry.cols === cols &&
      this.geometry.rows === rows &&
      this.geometry.cssWidth === cssWidth &&
      this.geometry.cssHeight === cssHeight &&
      this.geometry.dpr === dpr
    if (same) return

    this.geometry = { cols, rows, cssWidth, cssHeight, dpr, pitch }
    this.canvas.width = Math.round(cssWidth * dpr)
    this.canvas.height = Math.round(cssHeight * dpr)
    this.canvas.style.width = `${cssWidth}px`
    this.canvas.style.height = `${cssHeight}px`

    const cells = cols * rows
    if (this.target.length !== cells) {
      this.target = new Float32Array(cells)
      this.previous = new Float32Array(cells)
      this.jitter = new Float32Array(cells)
      // Deterministic hash keeps the panel's texture stable between redraws.
      for (let i = 0; i < cells; i++) {
        const h = Math.sin(i * 12.9898) * 43758.5453
        this.jitter[i] = 0.9 + (h - Math.floor(h)) * 0.1
      }
      if (this.lastLines.length > 0) this.setContent(this.lastLines, 'none')
    }
    this.buildGrid()
    this.buildSprite()
    this.render(performance.now())
  }

  setColors(colors: SemanticColorSpec): void {
    if (
      this.colors &&
      this.colors.active === colors.active &&
      this.colors.inactive === colors.inactive
    ) {
      return
    }
    this.colors = colors
    this.buildGrid()
    this.buildSprite()
    this.render(performance.now())
  }

  setBrightness(brightness: number): void {
    const clamped = Math.min(1, Math.max(0.25, brightness))
    if (Math.abs(clamped - this.brightness) < 0.001) return
    this.brightness = clamped
    this.render(performance.now())
  }

  setContent(lines: LedLineSpec[], transition: LedTransition): void {
    this.lastLines = lines
    const { cols, rows } = this.geometry
    if (cols === 0 || rows === 0) return

    this.previous = this.currentValues()
    const next = new Float32Array(cols * rows)
    for (const line of lines) this.rasterize(next, line)
    this.target = next

    if (transition === 'none') {
      this.animation = null
      this.previous = next.slice()
    } else {
      this.animation = {
        start: performance.now(),
        duration: transition === 'sweep' ? SWEEP_MS : FADE_MS,
        kind: transition
      }
    }
    this.schedule()
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  // ------------------------------------------------------------------ raster

  private rasterize(buffer: DotBuffer, line: LedLineSpec): void {
    const { cols } = this.geometry
    const font = fontOf(line.font)
    const scale = Math.max(1, Math.round(line.scale))
    let width = measureText(font, line.text, scale)
    let usedScale = scale
    // Never let a long label bleed off the panel — drop to a tighter scale first.
    if (width > cols && scale > 1) {
      usedScale = 1
      width = measureText(font, line.text, 1)
    }
    let x = Math.round((cols - width) / 2)

    for (const char of line.text) {
      const glyph = glyphFor(font, char)
      for (let gy = 0; gy < glyph.height; gy++) {
        const row = glyph.rows[gy]
        for (let gx = 0; gx < glyph.width; gx++) {
          if (row[gx] !== '1') continue
          for (let sy = 0; sy < usedScale; sy++) {
            for (let sx = 0; sx < usedScale; sx++) {
              this.plot(buffer, x + gx * usedScale + sx, line.row + gy * usedScale + sy)
            }
          }
        }
      }
      x += glyph.width * usedScale + font.tracking * usedScale
    }
  }

  private plot(buffer: DotBuffer, x: number, y: number): void {
    const { cols, rows } = this.geometry
    if (x < 0 || y < 0 || x >= cols || y >= rows) return
    buffer[y * cols + x] = 1
  }

  private currentValues(): DotBuffer {
    const { cols, rows } = this.geometry
    const out = new Float32Array(cols * rows)
    const animation = this.animation
    if (!animation) {
      out.set(this.target.subarray(0, out.length))
      return out
    }
    const progress = Math.min(1, (performance.now() - animation.start) / animation.duration)
    for (let i = 0; i < out.length; i++) {
      const p = this.dotProgress(i, progress, animation.kind)
      out[i] = this.previous[i] * (1 - p) + this.target[i] * p
    }
    return out
  }

  private dotProgress(index: number, progress: number, kind: LedTransition): number {
    if (kind !== 'sweep') return progress
    const col = index % this.geometry.cols
    const columnStart = (col / this.geometry.cols) * SWEEP_LEAD
    const scaled = (progress * (1 + SWEEP_LEAD) - columnStart) / (1 - SWEEP_LEAD * 0.35)
    return Math.min(1, Math.max(0, scaled))
  }

  // ------------------------------------------------------------------ drawing

  private buildGrid(): void {
    const { cols, rows, cssWidth, cssHeight, dpr, pitch } = this.geometry
    if (!this.colors || cols === 0) return
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.fillStyle = this.colors.inactive
    const radius = pitch * 0.3
    const offsetX = (cssWidth - cols * pitch) / 2 + pitch / 2
    const offsetY = (cssHeight - rows * pitch) / 2 + pitch / 2
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.beginPath()
        ctx.arc(offsetX + x * pitch, offsetY + y * pitch, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    this.gridCanvas = canvas
  }

  private buildSprite(): void {
    const { pitch, dpr } = this.geometry
    if (!this.colors || pitch === 0) return
    // Core dot plus a restrained halo; drawn once, blitted per lit dot.
    const size = Math.max(6, Math.ceil(pitch * 3.2 * dpr))
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const center = size / 2
    const coreRadius = pitch * 0.36 * dpr

    const glow = ctx.createRadialGradient(center, center, coreRadius * 0.6, center, center, center)
    glow.addColorStop(0, this.colors.glow)
    glow.addColorStop(0.45, this.colors.glow.replace(/[\d.]+\)$/, '0.18)'))
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, size, size)

    ctx.beginPath()
    ctx.arc(center, center, coreRadius, 0, Math.PI * 2)
    ctx.fillStyle = this.colors.active
    ctx.fill()

    this.sprite = canvas
    this.spriteSize = size
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame((time) => {
      this.frame = 0
      this.render(time)
      if (this.animation) this.schedule()
    })
  }

  private render(time: number): void {
    const { cols, rows, cssWidth, cssHeight, dpr, pitch } = this.geometry
    if (!this.colors || cols === 0 || !this.gridCanvas || !this.sprite) return

    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.drawImage(this.gridCanvas, 0, 0)

    let progress = 1
    if (this.animation) {
      progress = Math.min(1, (time - this.animation.start) / this.animation.duration)
      if (progress >= 1) {
        this.previous = this.target.slice()
        this.animation = null
      }
    }
    const kind = this.animation?.kind ?? 'none'

    const offsetX = (cssWidth - cols * pitch) / 2 + pitch / 2
    const offsetY = (cssHeight - rows * pitch) / 2 + pitch / 2
    const half = this.spriteSize / (2 * dpr)

    ctx.scale(dpr, dpr)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < this.target.length; i++) {
      const value =
        kind === 'none'
          ? this.target[i]
          : this.previous[i] * (1 - this.dotProgress(i, progress, kind)) +
            this.target[i] * this.dotProgress(i, progress, kind)
      if (value <= 0.02) continue
      const alpha = Math.min(1, value * this.brightness * this.jitter[i])
      ctx.globalAlpha = alpha
      const x = offsetX + (i % cols) * pitch
      const y = offsetY + Math.floor(i / cols) * pitch
      ctx.drawImage(this.sprite, x - half, y - half, half * 2, half * 2)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}
