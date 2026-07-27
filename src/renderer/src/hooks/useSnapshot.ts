import { useEffect, useState } from 'react'
import type { AppSnapshot } from '@shared/types'

/** Live app state, pushed from the main process on every change. */
export function useSnapshot(): AppSnapshot | null {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)

  useEffect(() => {
    let alive = true
    void window.gerdoo.getSnapshot().then((initial) => {
      if (alive) setSnapshot(initial)
    })
    const off = window.gerdoo.onSnapshot((next) => setSnapshot(next))
    return () => {
      alive = false
      off()
    }
  }, [])

  return snapshot
}
