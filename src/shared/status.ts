import type { SemanticColor, StatusId } from './types'

/** Semantic LED colours. Components read these tokens, never literals. */
export type { SemanticColor }

export interface SemanticColorSpec {
  /** Lit pixel colour. */
  active: string
  /** Unlit pixel colour — the ghost grid of the panel. */
  inactive: string
  /** Bloom halo colour. */
  glow: string
  /** Accent used by the shell (button rings, status dot). */
  accent: string
}

export const SEMANTIC_COLORS: Record<SemanticColor, SemanticColorSpec> = {
  focus: {
    active: '#c8823c',
    inactive: '#2a1a09',
    glow: 'rgba(200, 130, 60, 0.55)',
    accent: '#b8763a'
  },
  break: {
    active: '#ffbd5c',
    inactive: '#2a1d0c',
    glow: 'rgba(255, 178, 74, 0.5)',
    accent: '#f5a742'
  },
  paused: {
    active: '#e0b070',
    inactive: '#221a10',
    glow: 'rgba(224, 176, 112, 0.38)',
    accent: '#c99a5e'
  },
  oncall: {
    active: '#ff6a5e',
    inactive: '#2b1010',
    glow: 'rgba(255, 90, 80, 0.5)',
    accent: '#f2564a'
  },
  meeting: {
    active: '#b78dff',
    inactive: '#1d1330',
    glow: 'rgba(170, 130, 255, 0.5)',
    accent: '#9b74f0'
  },
  available: {
    active: '#5c86ff',
    inactive: '#0c1230',
    glow: 'rgba(76, 112, 255, 0.45)',
    accent: '#3f6be0'
  },
  dnd: {
    active: '#ff8a4c',
    inactive: '#2b1608',
    glow: 'rgba(255, 130, 70, 0.5)',
    accent: '#f57a3c'
  }
}

export interface StatusMeta {
  id: StatusId
  label: string
  /** Sub-label shown under the main line when no dynamic hint applies. */
  sub: string
  color: SemanticColor
  /** Whether the big LED line shows the wall clock for this status. */
  showsClock: boolean
}

export const STATUSES: Record<StatusId, StatusMeta> = {
  available: {
    id: 'available',
    label: 'AVAILABLE',
    sub: 'READY TO FOCUS',
    color: 'available',
    showsClock: true
  },
  oncall: {
    id: 'oncall',
    label: 'ON CALL',
    sub: 'DO NOT DISTURB',
    color: 'oncall',
    showsClock: false
  },
  meeting: {
    id: 'meeting',
    label: 'IN MEETING',
    sub: '',
    color: 'meeting',
    showsClock: false
  },
  dnd: {
    id: 'dnd',
    label: 'DO NOT DISTURB',
    sub: '',
    color: 'dnd',
    showsClock: false
  },
  custom: {
    id: 'custom',
    label: 'CUSTOM',
    sub: '',
    color: 'available',
    showsClock: true
  }
}

export const STATUS_ORDER: StatusId[] = ['available', 'oncall', 'meeting', 'dnd', 'custom']
