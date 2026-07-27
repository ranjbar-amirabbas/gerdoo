import { useEffect, useRef, useState } from 'react'
import type { Palette } from '@shared/palette'
import { STATUSES, STATUS_ORDER } from '@shared/status'
import type { StatusId } from '@shared/types'

interface StatusMenuProps {
  value: StatusId
  customLabel: string
  palette: Palette
  onSelect(id: StatusId): void
}

export function StatusMenu({
  value,
  customLabel,
  palette,
  onSelect
}: StatusMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const meta = STATUSES[value]
  const label = value === 'custom' ? customLabel || 'Custom' : meta.label

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Close the menu without letting Escape reach the window-hide handler.
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div className="status-menu no-drag" ref={rootRef}>
      <button
        type="button"
        className="key key--status"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Status: ${label}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className="status-dot"
          style={{ background: palette[meta.color].accent }}
          aria-hidden="true"
        />
        <span className="key__label">{label}</span>
      </button>
      {open ? (
        <div className="status-menu__list" role="menu">
          {STATUS_ORDER.map((id) => {
            const item = STATUSES[id]
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={id === value}
                className="status-menu__item"
                onClick={() => {
                  onSelect(id)
                  setOpen(false)
                }}
              >
                <span
                  className="status-dot"
                  style={{ background: palette[item.color].accent }}
                  aria-hidden="true"
                />
                {id === 'custom' ? customLabel || 'Custom' : item.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
