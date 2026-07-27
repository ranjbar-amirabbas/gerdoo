import type { KeyboardEvent, WheelEvent } from 'react'

interface PresetDialProps {
  presets: number[]
  index: number
  disabled?: boolean
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
  disabled = false,
  onChange
}: PresetDialProps): React.ReactElement {
  const minutes = presets[index] ?? presets[0] ?? 25
  const step = (delta: number): void => {
    if (disabled || presets.length === 0) return
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
      tabIndex={disabled ? -1 : 0}
      aria-label="Focus length in minutes"
      aria-valuenow={minutes}
      aria-valuetext={`${minutes} minutes`}
      aria-valuemin={presets[0]}
      aria-valuemax={presets[presets.length - 1]}
      aria-disabled={disabled || undefined}
      data-disabled={disabled || undefined}
      title={`Focus length: ${minutes} min — click or scroll to change`}
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
      <span className="dial__unit">MIN</span>
    </div>
  )
}
