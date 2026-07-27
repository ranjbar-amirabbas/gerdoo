import { BrowserWindow, Notification, app, ipcMain, powerMonitor, shell } from 'electron'
import { IPC, type SetStatusRequest, type StartTimerRequest } from '@shared/ipc'
import type { AppSnapshot, Settings, StatusId } from '@shared/types'
import { CalendarService, EventKitCalendarProvider, MockCalendarProvider } from './calendar'
import { Store } from './store'
import { TimerService } from './timer'
import { TrayController } from './tray'
import { WindowManager } from './windows'

class StitchApp {
  private readonly store = new Store()
  private readonly windows = new WindowManager(this.store)
  private readonly calendar = new CalendarService(
    new EventKitCalendarProvider(2),
    new MockCalendarProvider(),
    this.store.get().settings.calendarSource,
    {
      cache: this.store.get().calendarCache,
      onEvents: (access, events) =>
        this.store.patch({ calendarCache: { access, events, fetchedAt: Date.now() } })
    }
  )
  private readonly timer: TimerService
  private readonly tray: TrayController

  constructor() {
    const { settings, timer } = this.store.get()
    const presetMinutes = settings.presets[settings.selectedPresetIndex] ?? 25
    this.timer = new TimerService(timer, presetMinutes, settings.defaultTitle)
    this.tray = new TrayController({
      showFocusBar: (bounds) => this.windows.showFocusBar(bounds),
      toggleFocusBar: (bounds) => this.windows.toggleFocusBar(bounds),
      togglePinned: () => {
        this.windows.togglePinned()
        this.publish()
      },
      startFocus: () => this.startTimer({}),
      toggleTimer: () => {
        this.timer.toggle()
      },
      stopTimer: () => this.stopTimer(),
      setStatus: (id) => this.setStatus({ id }),
      openDashboard: () => this.windows.openDashboard(),
      openSettings: () => this.windows.openSettings(),
      quit: () => app.quit()
    })
  }

  // ------------------------------------------------------------------ startup

  start(): void {
    this.windows.setSnapshotProvider(() => this.snapshot())

    this.timer.on('change', () => {
      this.store.patch({ timer: this.timer.getState() })
      this.publish()
    })
    // Ticks only refresh the menu bar countdown; renderers run their own clock.
    this.timer.on('tick', () => this.tray.updateCountdown(this.timer.getState()))
    this.timer.on('complete', (record) => this.onSessionComplete(record.mode))

    this.calendar.on('change', () => this.publish())
    this.calendar.start()
    void this.promptForCalendarOnFirstRun()

    // A resumed Mac may have slept through the deadline — re-check immediately.
    powerMonitor.on('resume', () => {
      this.timer.sync()
      void this.calendar.refresh()
      this.publish()
    })
    powerMonitor.on('unlock-screen', () => this.timer.sync())

    this.registerIpc()
    this.tray.init(this.snapshot())
    this.windows.ensureFocusBar()
    this.applyLoginItem(this.store.get().settings)
  }

  // ----------------------------------------------------------------- snapshot

  private snapshot(): AppSnapshot {
    const state = this.store.get()
    return {
      timer: this.timer.getState(),
      status: state.status,
      calendar: this.calendar.getState(),
      settings: state.settings,
      window: state.window,
      sessions: state.sessions,
      now: Date.now()
    }
  }

  private publish(): void {
    const snapshot = this.snapshot()
    this.tray.update(snapshot)
    this.windows.broadcast()
  }

  // ------------------------------------------------------------------ actions

  private startTimer(request: StartTimerRequest): void {
    const { settings } = this.store.get()
    const fallbackMinutes =
      request.mode === 'break'
        ? settings.breakMinutes
        : (settings.presets[settings.selectedPresetIndex] ?? 25)
    this.timer.start({
      mode: request.mode ?? 'focus',
      minutes: request.minutes ?? fallbackMinutes,
      title: request.title ?? this.timer.getState().title ?? settings.defaultTitle
    })
    this.windows.playSound('start')
  }

  private stopTimer(): void {
    const state = this.timer.getState()
    if (state.phase === 'completed') {
      this.timer.acknowledgeCompletion()
      return
    }
    const record = this.timer.stop()
    if (record) this.store.addSession(record)
    this.windows.playSound('stop')
    this.publish()
  }

  private onSessionComplete(mode: 'focus' | 'break'): void {
    const state = this.timer.getState()
    this.store.addSession({
      id: `${state.startedAt ?? Date.now()}-${mode}`,
      mode,
      title: state.title,
      startedAt: state.startedAt ?? Date.now(),
      endedAt: Date.now(),
      plannedMs: state.durationMs,
      actualMs: state.durationMs,
      completed: true
    })
    this.windows.playSound('complete')

    if (Notification.isSupported()) {
      new Notification({
        title: mode === 'focus' ? 'Focus session complete' : 'Break over',
        body: mode === 'focus' ? 'Time for a break.' : 'Ready for the next session?',
        silent: !this.store.get().settings.soundEnabled
      }).show()
    }

    const { settings } = this.store.get()
    if (mode === 'focus' && settings.autoStartBreak) {
      this.timer.start({ mode: 'break', minutes: settings.breakMinutes, title: 'BREAK' })
    }
    this.publish()
  }

  /**
   * Asks for Calendar access once, shortly after launch. macOS only shows the
   * dialog while the state is `notDetermined`, so this is a no-op afterwards.
   */
  private async promptForCalendarOnFirstRun(): Promise<void> {
    if (this.store.get().settings.calendarSource !== 'system') return
    await new Promise((resolve) => setTimeout(resolve, 1500))
    if (this.calendar.getState().access !== 'notDetermined') return
    await this.calendar.refresh({ mayPrompt: true })
    this.publish()
  }

  private setStatus(request: SetStatusRequest): void {
    const current = this.store.get().status
    this.store.patch({
      status: {
        id: request.id,
        customLabel: request.customLabel ?? current.customLabel,
        until: request.until === undefined ? current.until : request.until
      }
    })
    this.publish()
  }

  private updateSettings(patch: Partial<Settings>): void {
    const settings = this.store.patchSettings(patch)
    if (patch.launchAtLogin !== undefined) this.applyLoginItem(settings)
    if (patch.selectedPresetIndex !== undefined || patch.presets !== undefined) {
      const minutes = settings.presets[settings.selectedPresetIndex] ?? 25
      this.timer.setDurationMinutes(minutes)
    }
    if (patch.calendarSource !== undefined) this.calendar.setSource(settings.calendarSource)
    this.publish()
  }

  private applyLoginItem(settings: Settings): void {
    if (!app.isPackaged) return
    try {
      // Only write when it actually differs: the call fails outright for an
      // unsigned build, and there is no reason to make it on every launch.
      if (app.getLoginItemSettings().openAtLogin === settings.launchAtLogin) return
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, openAsHidden: true })
    } catch (error) {
      console.error('[stitch] could not update the login item:', error)
    }
  }

  // ---------------------------------------------------------------------- ipc

  private registerIpc(): void {
    const handle = <T>(channel: string, handler: (payload: T, event: Electron.IpcMainInvokeEvent) => unknown) => {
      ipcMain.handle(channel, (event, payload: T) => handler(payload, event))
    }

    handle(IPC.snapshotGet, () => this.snapshot())

    handle<boolean>(IPC.windowSetPinned, (pinned) => {
      const result = this.windows.setPinned(Boolean(pinned))
      this.publish()
      return result
    })
    handle(IPC.windowGetPinned, () => this.windows.getPinned())
    handle(IPC.windowTogglePinned, () => {
      const result = this.windows.togglePinned()
      this.publish()
      return result
    })
    handle<boolean>(IPC.windowSetExpanded, (expanded) => {
      const result = this.windows.setExpanded(Boolean(expanded))
      this.publish()
      return result
    })
    handle(IPC.windowToggleExpanded, () => {
      const result = this.windows.toggleExpanded()
      this.publish()
      return result
    })
    handle(IPC.windowHide, () => this.windows.hideIfUnpinned())
    handle(IPC.windowCloseSelf, (_payload, event) => this.windows.closeWindow(event.sender.id))
    handle(IPC.windowOpenDashboard, () => this.windows.openDashboard())
    handle(IPC.windowOpenSettings, () => this.windows.openSettings())

    handle<StartTimerRequest | undefined>(IPC.timerStart, (request) => this.startTimer(request ?? {}))
    handle(IPC.timerPause, () => this.timer.pause())
    handle(IPC.timerResume, () => this.timer.resume())
    handle(IPC.timerToggle, () => this.timer.toggle())
    handle(IPC.timerStop, () => this.stopTimer())
    handle<string>(IPC.timerSetTitle, (title) => {
      const clean = (title ?? '').slice(0, 40)
      this.timer.setTitle(clean)
      // Remember it as the default so the next session starts with the same label.
      this.store.patchSettings({ defaultTitle: clean || 'DEEP WORK' })
    })

    handle<SetStatusRequest>(IPC.statusSet, (request) => this.setStatus(request))
    handle<Partial<Settings>>(IPC.settingsUpdate, (patch) => this.updateSettings(patch ?? {}))
    handle(IPC.sessionsClear, () => {
      this.store.patch({ sessions: [] })
      this.publish()
    })
    handle(IPC.calendarRefresh, async () => {
      await this.calendar.refresh()
      this.publish()
    })
    handle(IPC.calendarRequestAccess, async () => {
      await this.calendar.refresh({ mayPrompt: true })
      this.publish()
    })
    handle(IPC.calendarOpenPrivacySettings, async () => {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'
      )
    })
  }

  // -------------------------------------------------------------------- teardown

  shutdown(): void {
    this.windows.markQuitting()
    this.store.patch({ timer: this.timer.getState() })
    this.store.flush()
    this.timer.dispose()
    this.calendar.dispose()
    this.windows.dispose()
    this.tray.dispose()
  }

  showFocusBar(): void {
    this.windows.showFocusBar()
  }

  setStatusFromMenu(id: StatusId): void {
    this.setStatus({ id })
  }
}

const singleInstance = app.requestSingleInstanceLock()
let stitch: StitchApp | null = null

if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => stitch?.showFocusBar())

  app.whenReady().then(() => {
    // Menu bar app: no Dock icon, no app switcher entry.
    app.dock?.hide()
    app.setAppUserModelId('com.stitch.focusbar')
    stitch = new StitchApp()
    stitch.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) stitch?.showFocusBar()
    })
  })

  app.on('window-all-closed', () => {
    // Deliberately empty: closing windows must not quit a menu bar app.
  })

  app.on('before-quit', () => stitch?.shutdown())
}
