import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SetStatusRequest, type StartTimerRequest, type GerdooApi } from '@shared/ipc'
import { SNAPSHOT_CHANNEL, SOUND_CHANNEL, type AppSnapshot, type Settings } from '@shared/types'

/**
 * The entire surface the renderer gets. No `ipcRenderer`, no `require`, no
 * `BrowserWindow` — every privileged operation goes through a named channel
 * that the main process validates.
 */
const api: GerdooApi = {
  platform: process.platform,
  getSnapshot: () => ipcRenderer.invoke(IPC.snapshotGet),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(SNAPSHOT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(SNAPSHOT_CHANNEL, handler)
  },
  onSound: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, cue: string): void => listener(cue)
    ipcRenderer.on(SOUND_CHANNEL, handler)
    return () => ipcRenderer.removeListener(SOUND_CHANNEL, handler)
  },
  window: {
    setPinned: (pinned: boolean) => ipcRenderer.invoke(IPC.windowSetPinned, pinned),
    getPinned: () => ipcRenderer.invoke(IPC.windowGetPinned),
    togglePinned: () => ipcRenderer.invoke(IPC.windowTogglePinned),
    setScale: (scale: number) => ipcRenderer.invoke(IPC.windowSetScale, scale),
    setExpanded: (expanded: boolean) => ipcRenderer.invoke(IPC.windowSetExpanded, expanded),
    toggleExpanded: () => ipcRenderer.invoke(IPC.windowToggleExpanded),
    hide: () => ipcRenderer.invoke(IPC.windowHide),
    closeSelf: () => ipcRenderer.invoke(IPC.windowCloseSelf),
    openDashboard: () => ipcRenderer.invoke(IPC.windowOpenDashboard),
    openSettings: () => ipcRenderer.invoke(IPC.windowOpenSettings)
  },
  timer: {
    start: (request?: StartTimerRequest) => ipcRenderer.invoke(IPC.timerStart, request),
    pause: () => ipcRenderer.invoke(IPC.timerPause),
    resume: () => ipcRenderer.invoke(IPC.timerResume),
    toggle: () => ipcRenderer.invoke(IPC.timerToggle),
    stop: () => ipcRenderer.invoke(IPC.timerStop),
    setTitle: (title: string) => ipcRenderer.invoke(IPC.timerSetTitle, title)
  },
  status: {
    set: (request: SetStatusRequest) => ipcRenderer.invoke(IPC.statusSet, request)
  },
  settings: {
    update: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  sessions: {
    clear: () => ipcRenderer.invoke(IPC.sessionsClear)
  },
  calendar: {
    refresh: () => ipcRenderer.invoke(IPC.calendarRefresh),
    requestAccess: () => ipcRenderer.invoke(IPC.calendarRequestAccess),
    openPrivacySettings: () => ipcRenderer.invoke(IPC.calendarOpenPrivacySettings)
  }
}

contextBridge.exposeInMainWorld('gerdoo', api)
