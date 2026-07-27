import type { AppSnapshot, Settings, StatusId, TimerMode } from './types'

export const IPC = {
  snapshotGet: 'gerdoo:snapshot:get',
  windowSetPinned: 'gerdoo:window:setPinned',
  windowGetPinned: 'gerdoo:window:getPinned',
  windowTogglePinned: 'gerdoo:window:togglePinned',
  windowSetExpanded: 'gerdoo:window:setExpanded',
  windowToggleExpanded: 'gerdoo:window:toggleExpanded',
  windowHide: 'gerdoo:window:hide',
  windowOpenDashboard: 'gerdoo:window:openDashboard',
  windowOpenSettings: 'gerdoo:window:openSettings',
  windowCloseSelf: 'gerdoo:window:closeSelf',
  timerStart: 'gerdoo:timer:start',
  timerPause: 'gerdoo:timer:pause',
  timerResume: 'gerdoo:timer:resume',
  timerToggle: 'gerdoo:timer:toggle',
  timerStop: 'gerdoo:timer:stop',
  timerSetTitle: 'gerdoo:timer:setTitle',
  statusSet: 'gerdoo:status:set',
  settingsUpdate: 'gerdoo:settings:update',
  sessionsClear: 'gerdoo:sessions:clear',
  calendarRefresh: 'gerdoo:calendar:refresh',
  calendarRequestAccess: 'gerdoo:calendar:requestAccess',
  calendarOpenPrivacySettings: 'gerdoo:calendar:openPrivacySettings'
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

export interface GerdooApi {
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
