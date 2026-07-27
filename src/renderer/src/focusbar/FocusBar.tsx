import { useEffect } from 'react'
import { ChevronDown, ChevronUp, Pin } from 'lucide-react'
import { deriveLedContent } from '@shared/display'
import { SEMANTIC_COLORS } from '@shared/status'
import { LedPanel } from '@/led/LedPanel'
import { Mascot } from '@/components/Mascot'
import { useNow } from '@/hooks/useNow'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useSnapshot } from '@/hooks/useSnapshot'
import { playCue } from '@/sound'
import { ControlStrip } from './ControlStrip'
import { ExpandedPanel } from './ExpandedPanel'

export function FocusBar(): React.ReactElement {
  const snapshot = useSnapshot()
  const now = useNow()
  const reduceMotion = useReducedMotion(snapshot?.settings.reduceMotion)

  useEffect(() => window.stitch.onSound(playCue), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // Main ignores this while pinned, so a pinned bar never vanishes.
        void window.stitch.window.hide()
      } else if (event.key.toLowerCase() === 'e' && event.metaKey) {
        event.preventDefault()
        void window.stitch.window.toggleExpanded()
      } else if (event.key.toLowerCase() === 'p' && event.metaKey) {
        event.preventDefault()
        void window.stitch.window.togglePinned()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!snapshot) {
    return <div className="stage" aria-busy="true" />
  }

  const content = deriveLedContent(snapshot, now)
  const palette = SEMANTIC_COLORS[content.color]
  const { pinned, expanded } = snapshot.window

  return (
    <div className="stage">
      <section
        className="device"
        data-expanded={expanded ? 'true' : undefined}
        style={{ '--accent': palette.accent, '--glow': palette.glow } as React.CSSProperties}
        aria-label="Stitch Focus Bar"
      >
        <Mascot />

        <header className="device__grip drag">
          <span className="brand">
            <span className="brand__mark" aria-hidden="true" />
            STITCH
          </span>
          <div className="device__grip-actions no-drag">
            <button
              type="button"
              className="key key--icon no-drag"
              data-active={pinned ? 'true' : undefined}
              aria-pressed={pinned}
              title={pinned ? 'Unpin from top (⌘P)' : 'Pin above other apps (⌘P)'}
              aria-label={pinned ? 'Unpin Focus Bar' : 'Pin Focus Bar above other apps'}
              onClick={() => void window.stitch.window.togglePinned()}
            >
              <Pin size={14} strokeWidth={2.2} fill={pinned ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              className="key key--icon no-drag"
              aria-expanded={expanded}
              title={expanded ? 'Collapse controls (⌘E)' : 'Expand controls (⌘E)'}
              aria-label={expanded ? 'Collapse controls' : 'Expand controls'}
              onClick={() => void window.stitch.window.toggleExpanded()}
            >
              {expanded ? <ChevronUp size={14} strokeWidth={2.4} /> : <ChevronDown size={14} strokeWidth={2.4} />}
            </button>
          </div>
        </header>

        <div className="device__screen drag">
          <div className="device__bezel">
            <LedPanel
              content={content}
              brightness={snapshot.settings.brightness}
              reduceMotion={reduceMotion}
            />
          </div>
        </div>

        <ControlStrip snapshot={snapshot} />

        <div className="device__drawer" aria-hidden={!expanded}>
          {expanded ? <ExpandedPanel snapshot={snapshot} now={now} /> : null}
        </div>
      </section>
    </div>
  )
}
