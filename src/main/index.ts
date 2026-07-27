import { BrowserWindow, Notification, app, ipcMain, powerMonitor, shell } from 'electron'
import { IPC, type SetStatusRequest, type StartTimerRequest } from '@shared/ipc'
import { normalizeAccent, normalizeModeColors } from '@shared/palette'
import type { AppSnapshot, Settings, StatusId, TimerMode } from '@shared/types'
import { resolveAutoStatus } from './auto-status'
import {
  CalendarService,
  EventKitCalendarProvider,
  IcsCalendarProvider,
  MockCalendarProvider
} from './calendar'
import { Store } from './store'
import { TimerService } from './timer'
import { TrayController, seedMenuBarPosition } from './tray'
import { WindowManager } from './windows'

/**
 * How many hand-offs auto-start may chain before it stops on its own. With both
 * auto-start switches on, focus and break would otherwise keep relaying forever
 * — this ends the loop after a long stretch away from the keyboard. Any manual
 * start or stop resets the count.
 */
const AUTO_CYCLE_LIMIT = 8

class GerdooApp {
  private readonly store = new Store()
  private readonly windows = new WindowManager(this.store)
  private readonly calendar = new CalendarService(
    new EventKitCalendarProvider(),
    new MockCalendarProvider(),
    this.createIcsProvider(),
    this.store.get().settings.calendarSource,
    {
      cache: this.store.get().calendarCache,
      onEvents: (access, events, source) =>
        this.store.patch({ calendarCache: { access, events, source, fetchedAt: Date.now() } })
    }
  )
  private readonly timer: TimerService
  private readonly tray: TrayController
  /** Hand-offs auto-start has chained since the last manual start or stop. */
  private autoStarts = 0
  /** Length and label of the last focus session, replayed by auto-start focus. */
  private lastFocus: { minutes: number; title: string } | null = null

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

  private createIcsProvider(): IcsCalendarProvider {
    const provider = new IcsCalendarProvider()
    provider.setUrl(this.store.get().settings.icsUrl)
    return provider
  }

  // ------------------------------------------------------------------ startup

  start(): void {
    this.windows.setSnapshotProvider(() => this.snapshot())

    this.timer.on('change', () => {
      this.store.patch({ timer: this.timer.getState() })
      this.publish()
    })
    // Ticks only refresh the menu bar title; renderers run their own clock.
    this.timer.on('tick', () => this.tray.updateTimer(this.timer.getState()))
    this.timer.on('complete', (record) => this.onSessionComplete(record.mode))
    this.timer.on('modeChange', () => this.windows.playSound('mode'))

    this.calendar.on('change', () => {
      this.syncCalendarStatus()
      this.publish()
    })
    this.calendar.start()
    // The cached events are already in place, and a meeting may have ended while
    // Gerdoo was closed — a status left On Call by the last run is handed back
    // here rather than waiting for the calendar to change under us.
    this.syncCalendarStatus()
    void this.promptForCalendarOnFirstRun()

    // A resumed Mac may have slept through the deadline — re-check immediately.
    powerMonitor.on('resume', () => {
      this.timer.sync()
      void this.calendar.refresh()
      this.publish()
    })
    powerMonitor.on('unlock-screen', () => this.timer.sync())

    this.registerIpc()
    // First run only: AppKit reads the saved position when the item is created,
    // so this has to happen before `init`, and never again afterwards.
    if (!this.store.get().menuBarPositionSeeded) {
      seedMenuBarPosition()
      this.store.patch({ menuBarPositionSeeded: true })
    }
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
    const mode = request.mode ?? 'focus'
    const minutes = request.minutes ?? fallbackMinutes
    const title = request.title ?? this.timer.getState().title ?? settings.defaultTitle
    const previousMode = this.timer.getState().mode
    // Starting by hand ends whatever chain was running.
    this.autoStarts = 0
    if (mode === 'focus') this.lastFocus = { minutes, title }
    this.timer.start({ mode, minutes, title })
    // A mode switch already fired its own cue via the `modeChange` handler.
    if (mode === previousMode) this.windows.playSound('start')
  }

  private stopTimer(): void {
    const state = this.timer.getState()
    this.autoStarts = 0
    if (state.phase === 'completed') {
      this.timer.acknowledgeCompletion()
      return
    }
    const record = this.timer.stop()
    if (record) this.store.addSession(record)
    this.windows.playSound('stop')
    this.publish()
  }

  private onSessionComplete(mode: TimerMode): void {
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
    if (mode === 'focus') {
      this.lastFocus = { minutes: state.durationMs / 60_000, title: state.title }
    }

    const { settings } = this.store.get()
    const wantsNext = mode === 'focus' ? settings.autoStartBreak : settings.autoStartFocus
    const handOff = wantsNext && this.autoStarts < AUTO_CYCLE_LIMIT
    // The mode-change cue below covers the hand-off, so don't stack two sounds.
    if (!handOff) this.windows.playSound('complete')

    if (Notification.isSupported()) {
      new Notification({
        title: mode === 'focus' ? 'Focus session complete' : 'Break over',
        body: handOff
          ? mode === 'focus'
            ? 'Break starting now.'
            : 'Next focus session starting now.'
          : mode === 'focus'
            ? 'Time for a break.'
            : 'Ready for the next session?',
        silent: !settings.soundEnabled
      }).show()
    }

    if (handOff) {
      this.autoStarts += 1
      if (mode === 'focus') {
        this.timer.start({ mode: 'break', minutes: settings.breakMinutes, title: 'BREAK' })
      } else {
        // Repeat the focus session that led into this break, so a 15/5 rhythm
        // keeps its 15 rather than snapping back to the selected preset.
        const next = this.lastFocus ?? {
          minutes: settings.presets[settings.selectedPresetIndex] ?? 25,
          title: settings.defaultTitle
        }
        this.timer.start({ mode: 'focus', minutes: next.minutes, title: next.title })
      }
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

  /**
   * `auto` marks a change Gerdoo made for a calendar event. Anything else is the
   * user speaking, and it ends any hold the calendar had on the status — their
   * choice then stands until they change it again.
   */
  private setStatus(request: SetStatusRequest, auto = false): void {
    const current = this.store.get().status
    this.store.patch({
      status: {
        id: request.id,
        customLabel: request.customLabel ?? current.customLabel,
        until: request.until === undefined ? current.until : request.until
      },
      ...(auto ? {} : { autoStatus: null })
    })
    this.publish()
  }

  /**
   * Puts the status where the calendar says it should be: ON CALL while an event
   * runs, and back to whatever preceded it once the event ends.
   */
  private syncCalendarStatus(): void {
    const state = this.store.get()
    const decision = resolveAutoStatus({
      enabled: state.settings.autoOnCall,
      current: this.calendar.getState().current,
      status: state.status,
      hold: state.autoStatus,
      now: Date.now()
    })
    if (decision.hold !== state.autoStatus) this.store.patch({ autoStatus: decision.hold })
    if (decision.status) this.setStatus(decision.status, true)
  }

  private updateSettings(patch: Partial<Settings>): void {
    // A malformed colour would poison every window, so it never reaches disk.
    if (patch.accentColor !== undefined) {
      patch = { ...patch, accentColor: normalizeAccent(patch.accentColor) }
    }
    if (patch.modeColors !== undefined) {
      patch = { ...patch, modeColors: normalizeModeColors(patch.modeColors) }
    }
    const settings = this.store.patchSettings(patch)
    if (patch.launchAtLogin !== undefined) this.applyLoginItem(settings)
    if (patch.selectedPresetIndex !== undefined || patch.presets !== undefined) {
      const minutes = settings.presets[settings.selectedPresetIndex] ?? 25
      this.timer.setDurationMinutes(minutes)
    }
    if (patch.icsUrl !== undefined) this.calendar.setIcsUrl(settings.icsUrl)
    if (patch.calendarSource !== undefined) this.calendar.setSource(settings.calendarSource)
    // Switched on during a meeting it takes effect now; switched off it hands
    // the status back rather than leaving it stuck on ON CALL.
    if (patch.autoOnCall !== undefined) this.syncCalendarStatus()
    this.publish()
  }

  private applyLoginItem(settings: Settings): void {
    if (!app.isPackaged) return
    try {
      // Only write when it actually differs: on macOS the call fails outright
      // for an unsigned build, and there is no reason to make it every launch.
      if (app.getLoginItemSettings().openAtLogin === settings.launchAtLogin) return
      app.setLoginItemSettings({
        openAtLogin: settings.launchAtLogin,
        // macOS only. Windows starts the app normally; it has no Dock icon to
        // hide, and the Focus Bar showing at login is the point of the setting.
        openAsHidden: true
      })
    } catch (error) {
      console.error('[gerdoo] could not update the login item:', error)
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
    handle<number>(IPC.windowSetScale, (scale) => {
      const result = this.windows.setScale(Number(scale))
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
    handle<boolean>(IPC.windowSetCompact, (compact) => {
      const result = this.windows.setCompact(Boolean(compact))
      this.publish()
      return result
    })
    handle(IPC.windowToggleCompact, () => {
      const result = this.windows.toggleCompact()
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
      // Asked for by hand, so it bypasses the feed cache.
      await this.calendar.refresh({ force: true })
      this.publish()
    })
    handle(IPC.calendarRequestAccess, async () => {
      await this.calendar.refresh({ mayPrompt: true })
      this.publish()
    })
    handle(IPC.calendarOpenPrivacySettings, async () => {
      const url =
        process.platform === 'darwin'
          ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'
          : process.platform === 'win32'
            ? 'ms-settings:privacy-calendar'
            : null
      if (url) await shell.openExternal(url)
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
let gerdoo: GerdooApp | null = null

if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => gerdoo?.showFocusBar())

  app.whenReady().then(() => {
    // Menu bar app: no Dock icon, no app switcher entry.
    app.dock?.hide()
    app.setAppUserModelId('com.gerdoo.focusbar')
    gerdoo = new GerdooApp()
    gerdoo.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) gerdoo?.showFocusBar()
    })
  })

  app.on('window-all-closed', () => {
    // Deliberately empty: closing windows must not quit a menu bar app.
  })

  app.on('before-quit', () => gerdoo?.shutdown())
}
