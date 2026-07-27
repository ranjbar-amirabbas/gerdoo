import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Pin } from 'lucide-react'
import { deriveLedContent } from '@shared/display'
import { DEVICE_SCALE_STEP, clampDeviceScale } from '@shared/types'
import { LedPanel } from '@/led/LedPanel'
import { useNow } from '@/hooks/useNow'
import { usePalette } from '@/hooks/usePalette'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useSnapshot } from '@/hooks/useSnapshot'
import { hasAccelerator, shortcut } from '@/platform'
import { playCue } from '@/sound'
import { ControlStrip } from './ControlStrip'
import { ExpandedPanel } from './ExpandedPanel'
import { ResizeGrip } from './ResizeGrip'

export function FocusBar(): React.ReactElement {
  const snapshot = useSnapshot()
  const now = useNow()
  const reduceMotion = useReducedMotion(snapshot?.settings.reduceMotion)
  const palette = usePalette(snapshot)

  // The key handler is bound once, so it reads the live scale through a ref.
  const scaleRef = useRef(1)
  scaleRef.current = snapshot?.window.scale ?? 1

  useEffect(() => window.gerdoo.onSound(playCue), [])

  useEffect(() => {
    const stepScale = (delta: number): void => {
      void window.gerdoo.window.setScale(clampDeviceScale(scaleRef.current + delta))
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (hasAccelerator(event) && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        stepScale(DEVICE_SCALE_STEP)
      } else if (hasAccelerator(event) && event.key === '-') {
        event.preventDefault()
        stepScale(-DEVICE_SCALE_STEP)
      } else if (hasAccelerator(event) && event.key === '0') {
        event.preventDefault()
        void window.gerdoo.window.setScale(1)
      } else if (event.key === 'Escape') {
        // Main ignores this while pinned, so a pinned bar never vanishes.
        void window.gerdoo.window.hide()
      } else if (event.key.toLowerCase() === 'e' && hasAccelerator(event)) {
        event.preventDefault()
        void window.gerdoo.window.toggleExpanded()
      } else if (event.key.toLowerCase() === 'p' && hasAccelerator(event)) {
        event.preventDefault()
        void window.gerdoo.window.togglePinned()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!snapshot) {
    return <div className="stage" aria-busy="true" />
  }

  const content = deriveLedContent(snapshot, now)
  const colors = palette[content.color]
  const { pinned, expanded } = snapshot.window

  return (
    <div className="stage">
      <section
        className="device"
        data-expanded={expanded ? 'true' : undefined}
        style={{ '--accent': colors.accent, '--glow': colors.glow } as React.CSSProperties}
        aria-label="Gerdoo Focus Bar"
      >
        <header className="device__grip drag">
          <span className="brand">
            <span className="brand__mark" aria-hidden="true" />
            GERDOO
          </span>
          <div className="device__grip-actions no-drag">
            <button
              type="button"
              className="key key--icon no-drag"
              data-active={pinned ? 'true' : undefined}
              aria-pressed={pinned}
              title={
                pinned
                  ? `Unpin from top (${shortcut('p')})`
                  : `Pin above other apps (${shortcut('p')})`
              }
              aria-label={pinned ? 'Unpin Focus Bar' : 'Pin Focus Bar above other apps'}
              onClick={() => void window.gerdoo.window.togglePinned()}
            >
              <Pin size={14} strokeWidth={2.2} fill={pinned ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              className="key key--icon no-drag"
              aria-expanded={expanded}
              title={
                expanded
                  ? `Collapse controls (${shortcut('e')})`
                  : `Expand controls (${shortcut('e')})`
              }
              aria-label={expanded ? 'Collapse controls' : 'Expand controls'}
              onClick={() => void window.gerdoo.window.toggleExpanded()}
            >
              {expanded ? <ChevronUp size={14} strokeWidth={2.4} /> : <ChevronDown size={14} strokeWidth={2.4} />}
            </button>
          </div>
        </header>

        <div className="device__screen drag">
          <div className="device__bezel">
            <LedPanel
              content={content}
              palette={palette}
              brightness={snapshot.settings.brightness}
              reduceMotion={reduceMotion}
            />
          </div>
        </div>

        <ControlStrip snapshot={snapshot} />

        <div className="device__drawer" aria-hidden={!expanded}>
          {expanded ? <ExpandedPanel snapshot={snapshot} now={now} /> : null}
        </div>

        <ResizeGrip scale={snapshot.window.scale} />
      </section>
    </div>
  )
}
