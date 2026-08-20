import type { KeyboardEvent, WheelEvent } from 'react'

interface PresetDialProps {
  presets: number[]
  index: number
  /**
   * A session is running, so the pick lands on the next one rather than on the
   * countdown in front of the user. The dial says NEXT instead of MIN.
   */
  queued?: boolean
  onChange(index: number): void
}

/**
 * Rotary-style preset selector. Click steps forward; arrows, scroll and
 * Shift+click step back — and it exposes itself as a spinbutton so the whole
 * thing is reachable from the keyboard.
 */
export function PresetDial({
  presets,
  index,
  queued = false,
  onChange
}: PresetDialProps): React.ReactElement {
  const minutes = presets[index] ?? presets[0] ?? 25
  const step = (delta: number): void => {
    if (presets.length === 0) return
    const next = (index + delta + presets.length) % presets.length
    onChange(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      step(1)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      step(-1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      step(1)
    }
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    step(event.deltaY > 0 ? 1 : -1)
  }

  return (
    <div
      className="dial no-drag"
      role="spinbutton"
      tabIndex={0}
      data-queued={queued || undefined}
      aria-label={queued ? 'Next focus length in minutes' : 'Focus length in minutes'}
      aria-valuenow={minutes}
      aria-valuetext={`${minutes} minutes`}
      aria-valuemin={presets[0]}
      aria-valuemax={presets[presets.length - 1]}
      title={
        queued
          ? `Next focus: ${minutes} min — click or scroll to change; this session keeps its own length`
          : `Focus length: ${minutes} min — click or scroll to change`
      }
      onClick={(event) => step(event.shiftKey ? -1 : 1)}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
    >
      <span className="dial__ticks" aria-hidden="true">
        {presets.map((preset, i) => (
          <i key={preset} data-on={i === index ? 'true' : undefined} />
        ))}
      </span>
      <span className="dial__value">{minutes}</span>
      <span className="dial__unit">{queued ? 'NEXT' : 'MIN'}</span>
    </div>
  )
}
