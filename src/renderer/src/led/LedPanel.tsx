import { useEffect, useRef } from 'react'
import type { LedContent } from '@shared/display'
import { colorsFor } from '@shared/display'
import { Mascot } from '@/components/Mascot'
import { LedEngine, type LedLineSpec, type LedTransition } from './engine'

export const LED_COLS = 140
export const LED_ROWS = 34

interface LedPanelProps {
  content: LedContent
  brightness: number
  reduceMotion: boolean
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

export function LedPanel({ content, brightness, reduceMotion }: LedPanelProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<LedEngine | null>(null)
  const lastRef = useRef<LedContent | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    const engine = new LedEngine(canvas)
    engineRef.current = engine

    const resize = (): void => {
      const rect = host.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      engine.setGeometry(LED_COLS, LED_ROWS, rect.width, rect.height, window.devicePixelRatio || 1)
    }
    resize()

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    // A window dragged to a non-Retina display needs a fresh dot grid.
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    media.addEventListener('change', resize)

    return () => {
      observer.disconnect()
      media.removeEventListener('change', resize)
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setColors(colorsFor(content.color))
  }, [content.color])

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

    engine.setContent(layout(content), transition)
  }, [content, reduceMotion])

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
