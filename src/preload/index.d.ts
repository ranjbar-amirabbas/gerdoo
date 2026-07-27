import type { StitchApi } from '@shared/ipc'

declare global {
  interface Window {
    stitch: StitchApi
  }
}

export {}
