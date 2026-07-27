import { useEffect, useState } from 'react'

/**
 * Wall-clock tick aligned to the second boundary, so the countdown and the
 * clock change at the same moment and never drift into a stutter.
 */
export function useNow(active = true): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    let timeout: ReturnType<typeof setTimeout>

    const schedule = (): void => {
      const delay = 1000 - (Date.now() % 1000)
      timeout = setTimeout(() => {
        setNow(Date.now())
        schedule()
      }, delay)
    }
    schedule()

    // Waking from sleep or unhiding the window must resync immediately.
    const resync = (): void => setNow(Date.now())
    window.addEventListener('focus', resync)
    document.addEventListener('visibilitychange', resync)

    return () => {
      clearTimeout(timeout)
      window.removeEventListener('focus', resync)
      document.removeEventListener('visibilitychange', resync)
    }
  }, [active])

  return now
}
