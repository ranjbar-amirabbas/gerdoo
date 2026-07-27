import { useEffect, useRef } from 'react'
import { compactLabel, type LedContent } from '@shared/display'
import { BIG_FONT, SMALL_FONT, measureText } from '@shared/led-font'
import type { Palette } from '@shared/palette'
import { Mascot } from '@/components/Mascot'
import { LedEngine, type LedLineSpec, type LedTransition } from './engine'

export const LED_COLS = 140
export const LED_ROWS = 34

/** The compact screen carries the mode and the big line, on a grid of its own.
    Rows fit `SMALL_FONT` + a dark row + `BIG_FONT` exactly; the grid is wider
    than it is tall, so the extra rows cost no dot pitch. */
export const LED_COMPACT_COLS = 64
export const LED_COMPACT_ROWS = 22

interface LedPanelProps {
  content: LedContent
  palette: Palette
  brightness: number
  reduceMotion: boolean
  /** One centred line — the countdown alone, for the compact device. */
  compact?: boolean
}

function layout(content: LedContent): LedLineSpec[] {
  if (content.big) {
    return [
      { text: content.label, font: 'small', scale: 1, row: 2 },
      { text: content.big, font: 'big', scale: 1, row: 11 },
      { text: content.sub, font: 'small', scale: 1, row: 27 }
    ]
  }
  // No countdown: the status label becomes the focal line.
  return [
    { text: content.label, font: 'small', scale: 2, row: 7 },
    { text: content.sub, font: 'small', scale: 1, row: 24 }
  ]
}

/**
 * Compact: the mode over the big line, so a shrunken device still says what it
 * is counting. With no countdown to show — an idle status without a clock — the
 * label takes the whole screen at whichever scale fits across the narrow grid.
 */
function compactLayout(content: LedContent): LedLineSpec[] {
  const centre = (height: number): number => Math.round((LED_COMPACT_ROWS - height) / 2)
  const label = compactLabel(content.label)
  if (content.big) {
    return [
      { text: label, font: 'small', scale: 1, row: 0 },
      { text: content.big, font: 'big', scale: 1, row: LED_COMPACT_ROWS - BIG_FONT.height }
    ]
  }
  const scale = measureText(SMALL_FONT, label, 2) <= LED_COMPACT_COLS ? 2 : 1
  return [
    {
      text: label,
      font: 'small',
      scale,
      row: centre(SMALL_FONT.height * scale)
    }
  ]
}

export function LedPanel({
  content,
  palette,
  brightness,
  reduceMotion,
  compact = false
}: LedPanelProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<LedEngine | null>(null)
  const lastRef = useRef<LedContent | null>(null)

  const cols = compact ? LED_COMPACT_COLS : LED_COLS
  const rows = compact ? LED_COMPACT_ROWS : LED_ROWS
  const pick = compact ? compactLayout : layout

  // What the effects below would have painted, always current — a rebuilt engine
  // reads it instead of waiting for the next prop change to notice it is blank.
  const liveRef = useRef({ content, palette, brightness, pick })
  liveRef.current = { content, palette, brightness, pick }

  // Switching views changes the dot grid, which the engine builds once — so it
  // is rebuilt from scratch rather than reshaped.
  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    const engine = new LedEngine(canvas)
    engineRef.current = engine

    const resize = (): void => {
      const rect = host.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      engine.setGeometry(cols, rows, rect.width, rect.height, window.devicePixelRatio || 1)
    }
    resize()

    // A fresh engine has no colours, no brightness and nothing lit.
    const live = liveRef.current
    engine.setColors(live.palette[live.content.color])
    engine.setBrightness(live.brightness)
    lastRef.current = live.content
    engine.setContent(live.pick(live.content), 'none')

    const observer = new ResizeObserver(resize)
    observer.observe(host)

    // A fresh dot grid is needed whenever the device pixel ratio moves: a window
    // dragged to a non-Retina display, and every step of a device resize — which
    // is a page zoom, so it changes the ratio while the CSS box stays put and
    // the ResizeObserver above never fires. Each query only matches one ratio,
    // so the listener is re-armed against the new one after every change.
    let media: MediaQueryList | null = null
    const onPixelRatioChange = (): void => {
      resize()
      watchPixelRatio()
    }
    function watchPixelRatio(): void {
      media?.removeEventListener('change', onPixelRatioChange)
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      media.addEventListener('change', onPixelRatioChange)
    }
    watchPixelRatio()

    return () => {
      observer.disconnect()
      media?.removeEventListener('change', onPixelRatioChange)
      engine.destroy()
      engineRef.current = null
    }
  }, [cols, rows])

  useEffect(() => {
    engineRef.current?.setColors(palette[content.color])
  }, [content.color, palette])

  useEffect(() => {
    engineRef.current?.setBrightness(brightness)
  }, [brightness])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const previous = lastRef.current
    lastRef.current = content

    let transition: LedTransition = 'none'
    if (!previous) transition = 'none'
    else if (previous.transitionKey !== content.transitionKey) transition = 'sweep'
    else if (previous.label !== content.label || previous.sub !== content.sub) transition = 'fade'
    // A ticking countdown repaints instantly — physical panels do not fade digits.
    if (reduceMotion) transition = 'none'

    engine.setContent(pick(content), transition)
  }, [content, reduceMotion, pick])

  return (
    <div className="led" ref={hostRef}>
      {/* Behind the canvas: the dot grid is drawn on a transparent canvas, so
          the dog reads through it like a backlit panel. */}
      <Mascot />
      <canvas className="led__canvas" ref={canvasRef} />
      <div className="led__glass" aria-hidden="true" />
      <div className="led__scanlines" aria-hidden="true" />
      <span className="sr-only" role="status" aria-live="polite">
        {`${content.label} ${content.big} ${content.sub}`.trim()}
      </span>
    </div>
  )
}
