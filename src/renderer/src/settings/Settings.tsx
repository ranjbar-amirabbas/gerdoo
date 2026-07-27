import { SEMANTIC_COLORS } from '@shared/status'
import type { CalendarAccess, Settings as SettingsShape } from '@shared/types'
import { useSnapshot } from '@/hooks/useSnapshot'

const CALENDAR_ACCESS_HINT: Record<CalendarAccess, string> = {
  authorized: 'Reading events from macOS Calendar.',
  notDetermined: 'macOS has not been asked for access yet.',
  denied: 'Access was refused — turn Gerdoo on under Privacy & Security → Calendars.',
  restricted: 'Calendar access is blocked by a system policy.',
  unavailable: 'The calendar helper is missing. Run `npm run build:native`.',
  error: 'The calendar helper could not be read. Showing sample events.',
  sample: 'Using the built-in sample schedule.'
}

function Switch({
  checked,
  label,
  onChange
}: {
  checked: boolean
  label: string
  onChange(next: boolean): void
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  )
}

export function Settings(): React.ReactElement {
  const snapshot = useSnapshot()
  if (!snapshot) return <div className="app" aria-busy="true" />

  const settings = snapshot.settings
  const update = (patch: Partial<SettingsShape>): void => {
    void window.gerdoo.settings.update(patch)
  }

  const motionValue: 'system' | 'on' | 'off' =
    settings.reduceMotion === null ? 'system' : settings.reduceMotion ? 'on' : 'off'

  return (
    <div className="app" style={{ '--accent': SEMANTIC_COLORS.focus.accent } as React.CSSProperties}>
      <header className="app__titlebar">
        <span className="app__title">Settings</span>
      </header>

      <div className="app__body">
        <section className="section">
          <h2 className="section__title">Timer</h2>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Focus presets</span>
              <span className="row__hint">Minutes offered by the dial and preset chips.</span>
            </div>
            <div className="control">
              {settings.presets.map((preset, index) => (
                <input
                  key={index}
                  className="input"
                  type="number"
                  min={1}
                  max={180}
                  value={preset}
                  aria-label={`Preset ${index + 1} in minutes`}
                  onChange={(event) => {
                    const minutes = Math.min(180, Math.max(1, Number(event.target.value) || 1))
                    const presets = settings.presets.map((p, i) => (i === index ? minutes : p))
                    update({ presets })
                  }}
                />
              ))}
            </div>
          </div>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Break length</span>
              <span className="row__hint">Used by the break chip and auto-start.</span>
            </div>
            <div className="control">
              <input
                className="input"
                type="number"
                min={1}
                max={60}
                value={settings.breakMinutes}
                aria-label="Break length in minutes"
                onChange={(event) =>
                  update({ breakMinutes: Math.min(60, Math.max(1, Number(event.target.value) || 1)) })
                }
              />
            </div>
          </div>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Auto-start break</span>
              <span className="row__hint">Begin the break as soon as a focus session ends.</span>
            </div>
            <div className="control">
              <Switch
                checked={settings.autoStartBreak}
                label="Auto-start break"
                onChange={(autoStartBreak) => update({ autoStartBreak })}
              />
            </div>
          </div>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Default session label</span>
              <span className="row__hint">Shown under the countdown on the LED panel.</span>
            </div>
            <div className="control">
              <input
                className="input input--wide"
                type="text"
                maxLength={40}
                value={settings.defaultTitle}
                aria-label="Default session label"
                onChange={(event) => update({ defaultTitle: event.target.value })}
              />
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">Focus Bar</h2>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Display brightness</span>
              <span className="row__hint">Intensity of the lit pixels.</span>
            </div>
            <div className="control">
              <input
                className="slider"
                type="range"
                min={35}
                max={100}
                value={Math.round(settings.brightness * 100)}
                aria-label="Display brightness"
                onChange={(event) => update({ brightness: Number(event.target.value) / 100 })}
              />
            </div>
          </div>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Hide when it loses focus</span>
              <span className="row__hint">Only applies while the bar is unpinned.</span>
            </div>
            <div className="control">
              <Switch
                checked={settings.hideOnBlur}
                label="Hide on blur"
                onChange={(hideOnBlur) => update({ hideOnBlur })}
              />
            </div>
          </div>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Sound</span>
              <span className="row__hint">Cues when a session starts, stops, or completes.</span>
            </div>
            <div className="control">
              <Switch
                checked={settings.soundEnabled}
                label="Sound"
                onChange={(soundEnabled) => update({ soundEnabled })}
              />
            </div>
          </div>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Reduced motion</span>
              <span className="row__hint">Turns off panel transitions and drawer animation.</span>
            </div>
            <div className="control">
              <div className="segmented" role="group" aria-label="Reduced motion">
                {(['system', 'on', 'off'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    data-active={motionValue === option ? 'true' : undefined}
                    onClick={() =>
                      update({ reduceMotion: option === 'system' ? null : option === 'on' })
                    }
                  >
                    {option === 'system' ? 'System' : option === 'on' ? 'On' : 'Off'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">System</h2>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Launch at login</span>
              <span className="row__hint">Applies to the packaged app.</span>
            </div>
            <div className="control">
              <Switch
                checked={settings.launchAtLogin}
                label="Launch at login"
                onChange={(launchAtLogin) => update({ launchAtLogin })}
              />
            </div>
          </div>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Calendar source</span>
              <span className="row__hint">{CALENDAR_ACCESS_HINT[snapshot.calendar.access]}</span>
            </div>
            <div className="control">
              <div className="segmented" role="group" aria-label="Calendar source">
                {(['system', 'sample'] as const).map((source) => (
                  <button
                    key={source}
                    type="button"
                    data-active={settings.calendarSource === source ? 'true' : undefined}
                    onClick={() => update({ calendarSource: source })}
                  >
                    {source === 'system' ? 'macOS Calendar' : 'Sample'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="row">
            <div className="row__text">
              <span className="row__title">Calendar access</span>
              <span className="row__hint">
                {snapshot.calendar.access === 'authorized'
                  ? `${snapshot.calendar.events.length} event${snapshot.calendar.events.length === 1 ? '' : 's'} loaded`
                  : 'Gerdoo reads events only to show what is current and next.'}
              </span>
            </div>
            <div className="control">
              {snapshot.calendar.access === 'denied' ||
              snapshot.calendar.access === 'restricted' ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => void window.gerdoo.calendar.openPrivacySettings()}
                >
                  Open Privacy Settings
                </button>
              ) : snapshot.calendar.access === 'authorized' ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => void window.gerdoo.calendar.refresh()}
                >
                  Refresh
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void window.gerdoo.calendar.requestAccess()}
                >
                  Grant access
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
