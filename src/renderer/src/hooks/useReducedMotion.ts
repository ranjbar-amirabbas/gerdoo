import { useEffect, useState } from 'react'

/** `override` comes from settings: `null` means follow the system preference. */
export function useReducedMotion(override: boolean | null | undefined): boolean {
  const [system, setSystem] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (event: MediaQueryListEvent): void => setSystem(event.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    const reduced = override ?? system
    document.documentElement.dataset.reduceMotion = reduced ? 'true' : 'false'
  }, [override, system])

  return override ?? system
}
