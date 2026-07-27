import { paletteFor, type Palette } from '@shared/palette'
import type { AppSnapshot } from '@shared/types'

/** The palette for a snapshot, or the default one before the first snapshot lands. */
export function usePalette(snapshot: AppSnapshot | null): Palette {
  // `paletteFor` memoises per accent, so the identity is already stable.
  return paletteFor(snapshot?.settings.accentColor)
}
