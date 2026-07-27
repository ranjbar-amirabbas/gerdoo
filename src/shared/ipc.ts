import type { AppSnapshot, Settings, StatusId, TimerMode } from './types'

export const IPC = {
  snapshotGet: 'stitch:snapshot:get',
  windowSetPinned: 'stitch:window:setPinned',
  windowGetPinned: 'stitch:window:getPinned',
  windowTogglePinned: 'stitch:window:togglePinned',
  windowSetExpanded: 'stitch:window:setExpanded',
  windowToggleExpanded: 'stitch:window:toggleExpanded',
  windowHide: 'stitch:window:hide',
  windowOpenDashboard: 'stitch:window:openDashboard',
  windowOpenSettings: 'stitch:window:openSettings',
  windowCloseSelf: 'stitch:window:closeSelf',
  timerStart: 'stitch:timer:start',
  timerPause: 'stitch:timer:pause',
  timerResume: 'stitch:timer:resume',
  timerToggle: 'stitch:timer:toggle',
  timerStop: 'stitch:timer:stop',
  timerSetTitle: 'stitch:timer:setTitle',
  statusSet: 'stitch:status:set',
  settingsUpdate: 'stitch:settings:update',
  sessionsClear: 'stitch:sessions:clear',
  calendarRefresh: 'stitch:calendar:refresh',
  calendarRequestAccess: 'stitch:calendar:requestAccess',
  calendarOpenPrivacySettings: 'stitch:calendar:openPrivacySettings'
} as const

export interface StartTimerRequest {
  mode?: TimerMode
  minutes?: number
  title?: string
}

export interface SetStatusRequest {
  id: StatusId
  customLabel?: string
  /** Epoch ms, or null to clear. */
  until?: number | null
}

export interface StitchApi {
  getSnapshot(): Promise<AppSnapshot>
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void
  onSound(listener: (cue: string) => void): () => void
  window: {
    setPinned(pinned: boolean): Promise<boolean>
    getPinned(): Promise<boolean>
    togglePinned(): Promise<boolean>
    setExpanded(expanded: boolean): Promise<boolean>
    toggleExpanded(): Promise<boolean>
    hide(): Promise<void>
    closeSelf(): Promise<void>
    openDashboard(): Promise<void>
    openSettings(): Promise<void>
  }
  timer: {
    start(request?: StartTimerRequest): Promise<void>
    pause(): Promise<void>
    resume(): Promise<void>
    toggle(): Promise<void>
    stop(): Promise<void>
    setTitle(title: string): Promise<void>
  }
  status: {
    set(request: SetStatusRequest): Promise<void>
  }
  settings: {
    update(patch: Partial<Settings>): Promise<void>
  }
  sessions: {
    clear(): Promise<void>
  }
  calendar: {
    refresh(): Promise<void>
    /** May show the macOS access dialog; resolves once the user answers. */
    requestAccess(): Promise<void>
    openPrivacySettings(): Promise<void>
  }
}
