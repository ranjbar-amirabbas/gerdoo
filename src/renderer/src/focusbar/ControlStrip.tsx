import { Pause, Play, Settings2, Square } from 'lucide-react'
import { paletteFor } from '@shared/palette'
import type { AppSnapshot } from '@shared/types'
import { DeviceButton } from '@/components/DeviceButton'
import { PresetDial } from '@/components/PresetDial'
import { StatusMenu } from '@/components/StatusMenu'

interface ControlStripProps {
  snapshot: AppSnapshot
}

export function ControlStrip({ snapshot }: ControlStripProps): React.ReactElement {
  const { timer, settings, status } = snapshot
  const running = timer.phase === 'running'
  const paused = timer.phase === 'paused'
  const active = running || paused

  const primaryLabel = running ? 'Pause session' : paused ? 'Resume session' : 'Start focus'

  return (
    <div className="controls">
      <DeviceButton
        variant="primary"
        icon={running ? <Pause size={15} strokeWidth={2.4} /> : <Play size={15} strokeWidth={2.4} />}
        label={primaryLabel}
        showLabel
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

      <span className="controls__divider" aria-hidden="true" />

      <PresetDial
        presets={settings.presets}
        index={settings.selectedPresetIndex}
        disabled={active}
        onChange={(index) => void window.gerdoo.settings.update({ selectedPresetIndex: index })}
      />

      <span className="controls__divider" aria-hidden="true" />

      <StatusMenu
        value={status.id}
        customLabel={status.customLabel}
        palette={paletteFor(settings.accentColor, settings.modeColors)}
        onSelect={(id) => void window.gerdoo.status.set({ id })}
      />

      <div className="controls__spacer" />

      <DeviceButton
        icon={<Settings2 size={15} strokeWidth={2.2} />}
        label="Settings"
        onClick={() => void window.gerdoo.window.openSettings()}
      />
    </div>
  )
}
