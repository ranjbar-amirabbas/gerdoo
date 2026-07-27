import { Coffee, LayoutDashboard, Pin, Repeat, Volume2, VolumeX } from 'lucide-react'
import { describeWhen, suggestFocus } from '@shared/display'
import { paletteFor } from '@shared/palette'
import { STATUSES, STATUS_ORDER } from '@shared/status'
import type { AppSnapshot } from '@shared/types'

interface ExpandedPanelProps {
  snapshot: AppSnapshot
  now: number
}

export function ExpandedPanel({ snapshot, now }: ExpandedPanelProps): React.ReactElement {
  const { settings, status, calendar, timer, window: windowState } = snapshot
  const palette = paletteFor(settings.accentColor)
  const suggestion = suggestFocus(calendar.next, now, settings.presets)
  const sessionActive = timer.phase === 'running' || timer.phase === 'paused'
  // One switch for the whole focus → break → focus loop; Settings splits the two.
  const autoCycle = settings.autoStartBreak && settings.autoStartFocus

  return (
    <div className="panel">
      <div className="panel__row">
        <label className="field">
          <input
            className="field__input no-drag"
            type="text"
            maxLength={40}
            value={timer.title}
            aria-label="Session label"
            placeholder="Session label"
            onChange={(event) => void window.gerdoo.timer.setTitle(event.target.value)}
          />
        </label>
      </div>

      <div className="panel__row">
        <span className="panel__label">Presets</span>
        <div className="chips">
          {settings.presets.map((preset, index) => (
            <button
              key={preset}
              type="button"
              className="chip no-drag"
              data-active={index === settings.selectedPresetIndex ? 'true' : undefined}
              disabled={sessionActive}
              onClick={() => void window.gerdoo.settings.update({ selectedPresetIndex: index })}
            >
              {preset}
              <small>MIN</small>
            </button>
          ))}
          <button
            type="button"
            className="chip chip--break no-drag"
            title={`Start a ${settings.breakMinutes} minute break`}
            onClick={() =>
              void window.gerdoo.timer.start({ mode: 'break', minutes: settings.breakMinutes })
            }
          >
            <Coffee size={13} strokeWidth={2.2} />
            BREAK
          </button>
        </div>
      </div>

      <div className="panel__row">
        <span className="panel__label">Status</span>
        <div className="chips">
          {STATUS_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className="chip no-drag"
              data-active={status.id === id ? 'true' : undefined}
              aria-label={id === 'custom' ? status.customLabel || 'Custom' : STATUSES[id].label}
              onClick={() => void window.gerdoo.status.set({ id })}
            >
              <span
                className="status-dot"
                style={{ background: palette[STATUSES[id].color].accent }}
                aria-hidden="true"
              />
              {/* Short forms keep the row to one line; the full name stays in the label. */}
              {id === 'custom'
                ? status.customLabel || 'Custom'
                : id === 'dnd'
                  ? 'DND'
                  : STATUSES[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel__row">
        <div className="meeting">
          <span className="panel__label">Next</span>
          {calendar.next ? (
            <p className="meeting__text">
              <strong>{calendar.next.title}</strong>
              <span>{describeWhen(calendar.next.startsAt, now)}</span>
            </p>
          ) : (
            <p className="meeting__text meeting__text--empty">Nothing else scheduled today</p>
          )}
          {suggestion && !sessionActive ? (
            <button
              type="button"
              className="chip chip--suggest no-drag"
              onClick={() => void window.gerdoo.timer.start({ minutes: suggestion.suggestMinutes })}
            >
              Start {suggestion.suggestMinutes} min focus
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel__row">
        <div className="toggles">
          <button
            type="button"
            className="toggle no-drag"
            role="switch"
            aria-checked={settings.soundEnabled}
            onClick={() => void window.gerdoo.settings.update({ soundEnabled: !settings.soundEnabled })}
          >
            {settings.soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            Sound
          </button>
          <button
            type="button"
            className="toggle no-drag"
            role="switch"
            aria-checked={autoCycle}
            title="Roll straight from focus into a break, and back again"
            onClick={() =>
              void window.gerdoo.settings.update({
                autoStartBreak: !autoCycle,
                autoStartFocus: !autoCycle
              })
            }
          >
            <Repeat size={14} />
            Auto-cycle
          </button>
          <button
            type="button"
            className="toggle no-drag"
            role="switch"
            aria-checked={windowState.pinned}
            onClick={() => void window.gerdoo.window.togglePinned()}
          >
            <Pin size={14} />
            Always on top
          </button>
          <button
            type="button"
            className="toggle toggle--action no-drag"
            onClick={() => void window.gerdoo.window.openDashboard()}
          >
            <LayoutDashboard size={14} />
            Open Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
