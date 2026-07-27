import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'default' | 'ghost'

interface DeviceButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode
  label: string
  /** Rendered next to the icon; the button stays icon-only when omitted. */
  showLabel?: boolean
  variant?: Variant
  active?: boolean
}

/**
 * The physical key. All interactive controls must opt out of the window drag
 * region, which is why `no-drag` lives here rather than in each caller.
 */
export function DeviceButton({
  icon,
  label,
  showLabel = false,
  variant = 'default',
  active = false,
  ...rest
}: DeviceButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      className="key no-drag"
      data-variant={variant}
      data-active={active ? 'true' : undefined}
      aria-label={showLabel ? undefined : label}
      aria-pressed={rest['aria-pressed']}
      title={rest.title ?? label}
      {...rest}
    >
      {icon ? <span className="key__icon">{icon}</span> : null}
      {showLabel ? <span className="key__label">{label}</span> : null}
    </button>
  )
}
