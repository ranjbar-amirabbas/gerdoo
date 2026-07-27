import { useRef } from 'react'
import { WINDOW_WIDTH, clampDeviceScale } from '@shared/types'
import { IS_MAC } from '@/platform'

const SCALE_KEYS = IS_MAC ? '⌘+ / ⌘− / ⌘0' : 'Ctrl+ / Ctrl− / Ctrl+0'

interface ResizeGripProps {
  /** The scale the device is drawn at right now. */
  scale: number
}

/**
 * Drag corner for the device.
 *
 * The window is transparent, and macOS lets the mouse through transparent
 * pixels — so the frame's own resize edges sit in the shadow padding where
 * nothing can grab them. Windows has no edges to begin with: the Focus Bar
 * turns off `thickFrame` there, because the 1 px border it draws cuts across
 * the device's rounded corners. Either way this handle does the resize itself:
 * it reads screen coordinates (unaffected by the page zoom that the resize
 * applies) and asks main for the matching scale.
 */
export function ResizeGrip({ scale }: ResizeGripProps): React.ReactElement {
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()

    const startX = event.screenX
    const startWidth = WINDOW_WIDTH * scaleRef.current
    let frame = 0
    let pending = scaleRef.current

    const apply = (): void => {
      frame = 0
      void window.gerdoo.window.setScale(pending)
    }

    const onMove = (move: PointerEvent): void => {
      pending = clampDeviceScale((startWidth + (move.screenX - startX)) / WINDOW_WIDTH)
      // One resize per frame: every call crosses to main and moves the window.
      if (!frame) frame = requestAnimationFrame(apply)
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (frame) cancelAnimationFrame(frame)
      void window.gerdoo.window.setScale(pending)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className="device__resize no-drag"
      role="separator"
      aria-label="Resize the Focus Bar"
      title={`Drag to resize · ${SCALE_KEYS}`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => void window.gerdoo.window.setScale(1)}
    >
      <span aria-hidden="true" />
    </div>
  )
}
