import type { GerdooApi } from '@shared/ipc'

declare global {
  interface Window {
    gerdoo: GerdooApi
  }
}

export {}
