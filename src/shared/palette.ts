/**
 * The device's colour scheme.
 *
 * By default Gerdoo ships a hand-tuned palette where every semantic role has its
 * own hue. When the user picks an accent colour instead, the whole palette is
 * re-derived from that one hue: roles keep their relative brightness and a small
 * hue rotation, so `break` still reads warmer than `focus` and `paused` still
 * reads muted, but the device looks like one instrument rather than seven.
 */

import { SEMANTIC_COLORS, type SemanticColor, type SemanticColorSpec } from './status'

export type Palette = Record<SemanticColor, SemanticColorSpec>

export interface AccentPreset {
  label: string
  /** null = the built-in multi-hue palette. */
  value: string | null
}

/** Offered as swatches in Settings. The first entry restores the default look. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { label: 'Default', value: null },
  { label: 'Caramel', value: '#c8823c' },
  { label: 'Amber', value: '#ffb648' },
  { label: 'Blue', value: '#5c86ff' },
  { label: 'Cyan', value: '#3fc9e6' },
  { label: 'Green', value: '#4fc97a' },
  { label: 'Purple', value: '#b78dff' },
  { label: 'Pink', value: '#ff6fae' },
  { label: 'Red', value: '#ff6a5e' },
  { label: 'Slate', value: '#8d99ab' }
]

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** `#RGB` / `#RRGGBB` (any case) → `#rrggbb`. Anything else → null. */
export function normalizeAccent(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = HEX.exec(value.trim())
  if (!match) return null
  const body = match[1].toLowerCase()
  return `#${body.length === 3 ? body.replace(/./g, (char) => char + char) : body}`
}

interface RoleProfile {
  /** Degrees of hue rotation from the accent — kept small so the family holds. */
  hue: number
  /** Multiplier on the accent's saturation. */
  sat: number
  /** Target lightness, blended with the accent's own so both have a say. */
  light: number
}

const ROLE_PROFILES: Record<SemanticColor, RoleProfile> = {
  focus: { hue: 0, sat: 1, light: 0.6 },
  break: { hue: 14, sat: 1, light: 0.72 },
  paused: { hue: 4, sat: 0.55, light: 0.66 },
  oncall: { hue: -18, sat: 1, light: 0.62 },
  meeting: { hue: 26, sat: 0.85, light: 0.74 },
  available: { hue: 0, sat: 0.95, light: 0.68 },
  dnd: { hue: -9, sat: 1, light: 0.64 }
}

/** Unlit pixels are the same hue burnt down to a ghost of the grid. */
const INACTIVE_LIGHT = 0.11
const INACTIVE_MAX_SAT = 0.7
const GLOW_ALPHA = 0.5

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const light = (max + min) / 2
  const delta = max - min
  if (delta === 0) return [0, 0, light]

  const sat = delta / (1 - Math.abs(2 * light - 1))
  let hue: number
  if (max === rn) hue = ((gn - bn) / delta) % 6
  else if (max === gn) hue = (bn - rn) / delta + 2
  else hue = (rn - gn) / delta + 4
  return [((hue * 60) % 360 + 360) % 360, sat, light]
}

function hslToRgb(hue: number, sat: number, light: number): Rgb {
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const h = (((hue % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((h % 2) - 1))
  const m = light - c / 2
  const [r, g, b] =
    h < 1 ? [c, x, 0]
    : h < 2 ? [x, c, 0]
    : h < 3 ? [0, c, x]
    : h < 4 ? [0, x, c]
    : h < 5 ? [x, 0, c]
    : [c, 0, x]
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ]
}

function toHex([r, g, b]: Rgb): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

function specFor(baseHsl: [number, number, number], profile: RoleProfile): SemanticColorSpec {
  const [baseHue, baseSat, baseLight] = baseHsl
  const hue = baseHue + profile.hue
  const sat = clamp(baseSat * profile.sat, 0, 1)
  // The accent's own lightness only gets half a vote: a near-black or near-white
  // pick still has to light up legibly on the panel.
  const light = clamp(profile.light * 0.55 + baseLight * 0.45, 0.42, 0.82)

  const active = hslToRgb(hue, sat, light)
  return {
    active: toHex(active),
    inactive: toHex(hslToRgb(hue, Math.min(sat, INACTIVE_MAX_SAT), INACTIVE_LIGHT)),
    glow: `rgba(${active[0]}, ${active[1]}, ${active[2]}, ${GLOW_ALPHA})`,
    accent: toHex(hslToRgb(hue, sat * 0.95, light * 0.84))
  }
}

function derive(accent: string): Palette {
  const baseHsl = rgbToHsl(hexToRgb(accent))
  const palette = {} as Palette
  for (const role of Object.keys(ROLE_PROFILES) as SemanticColor[]) {
    palette[role] = specFor(baseHsl, ROLE_PROFILES[role])
  }
  return palette
}

// Every render of every window asks for the palette; the maths is cheap but the
// object identity matters to the LED engine's change check.
const cache = new Map<string, Palette>()

/** The palette to render with. Anything unparseable falls back to the default. */
export function paletteFor(accentColor: string | null | undefined): Palette {
  const accent = normalizeAccent(accentColor)
  if (!accent) return SEMANTIC_COLORS
  const cached = cache.get(accent)
  if (cached) return cached
  const palette = derive(accent)
  cache.set(accent, palette)
  return palette
}
