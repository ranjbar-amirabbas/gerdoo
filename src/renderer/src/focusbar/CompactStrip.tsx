import { Maximize2, Pause, Play, Square } from 'lucide-react'
import type { AppSnapshot } from '@shared/types'
import { DeviceButton } from '@/components/DeviceButton'
import { shortcut } from '@/platform'

interface CompactStripProps {
  snapshot: AppSnapshot
}

/**
 * The compact device's only controls: run the session, end it, and get the full
 * device back. Everything else — presets, status, settings — lives behind that
 * last key rather than being duplicated here.
 */
export function CompactStrip({ snapshot }: CompactStripProps): React.ReactElement {
  const { timer } = snapshot
  const running = timer.phase === 'running'
  const paused = timer.phase === 'paused'
  const active = running || paused

  return (
    <div className="compact__keys">
      <DeviceButton
        variant="primary"
        icon={running ? <Pause size={15} strokeWidth={2.4} /> : <Play size={15} strokeWidth={2.4} />}
        label={running ? 'Pause session' : paused ? 'Resume session' : 'Start focus'}
        onClick={() => {
          if (active) void window.gerdoo.timer.toggle()
          else void window.gerdoo.timer.start({})
        }}
      />
      <DeviceButton
        icon={<Square size={14} strokeWidth={2.4} />}
        label="Stop session"
        disabled={timer.phase === 'idle'}
        onClick={() => void window.gerdoo.timer.stop()}
      />
      <DeviceButton
        icon={<Maximize2 size={14} strokeWidth={2.4} />}
        label="Show all controls"
        title={`Show all controls (${shortcut('m')})`}
        onClick={() => void window.gerdoo.window.setCompact(false)}
      />
    </div>
  )
}
