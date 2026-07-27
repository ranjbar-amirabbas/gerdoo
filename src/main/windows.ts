import { BrowserWindow, app, screen, shell } from 'electron'
import { join } from 'node:path'
import type { AppSnapshot } from '@shared/types'
import {
  COLLAPSED_HEIGHT,
  EXPANDED_HEIGHT,
  MAX_DEVICE_SCALE,
  MIN_DEVICE_SCALE,
  SNAPSHOT_CHANNEL,
  SOUND_CHANNEL,
  WINDOW_WIDTH,
  clampDeviceScale,
  type SoundCue
} from '@shared/types'
import type { Store } from './store'

const PRELOAD = join(__dirname, '../preload/index.js')

function rendererUrl(page: string): { url?: string; file?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) return { url: `${devUrl}/${page}.html` }
  return { file: join(__dirname, `../renderer/${page}.html`) }
}

function loadPage(window: BrowserWindow, page: string): void {
  const target = rendererUrl(page)
  if (target.url) void window.loadURL(target.url)
  else void window.loadFile(target.file!)
}

export class WindowManager {
  private focusBar: BrowserWindow | null = null
  private dashboard: BrowserWindow | null = null
  private settings: BrowserWindow | null = null
  private quitting = false
  private saveTimer: NodeJS.Timeout | null = null
  private snapshotProvider: (() => AppSnapshot) | null = null

  constructor(private readonly store: Store) {}

  setSnapshotProvider(provider: () => AppSnapshot): void {
    this.snapshotProvider = provider
  }

  markQuitting(): void {
    this.quitting = true
  }

  // ---------------------------------------------------------------- focus bar

  getFocusBar(): BrowserWindow | null {
    return this.focusBar
  }

  /** Creates the single Focus Bar window, or returns the existing one. */
  ensureFocusBar(): BrowserWindow {
    if (this.focusBar && !this.focusBar.isDestroyed()) return this.focusBar

    const { window: windowState } = this.store.get()
    const scale = this.getScale()
    const size = this.scaledSize(windowState.expanded, scale)

    const win = new BrowserWindow({
      width: size.width,
      height: size.height,
      minWidth: Math.round(WINDOW_WIDTH * MIN_DEVICE_SCALE),
      maxWidth: Math.round(WINDOW_WIDTH * MAX_DEVICE_SCALE),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false, // the device casts its own shadow in CSS
      resizable: true,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      acceptFirstMouse: true,
      roundedCorners: false,
      title: 'Gerdoo Focus Bar',
      webPreferences: {
        preload: PRELOAD,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Keep the countdown and LED redraws alive while the window is hidden.
        backgroundThrottling: false
      }
    })

    win.setWindowButtonVisibility?.(false)
    this.applyAspectRatio(win, windowState.expanded)

    // The device is one piece of artwork: everything in it is laid out in fixed
    // pixels, so resizing means zooming the page, never reflowing it.
    win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(this.getScale()))

    win.once('ready-to-show', () => {
      this.applyPinState(this.store.get().window.pinned)
      this.positionFocusBar(win)
      win.show()
    })

    // Live while the user drags an edge; `resized` then snaps away the rounding.
    win.on('resize', () => {
      if (win.isDestroyed()) return
      win.webContents.setZoomFactor(clampDeviceScale(win.getBounds().width / WINDOW_WIDTH))
    })

    win.on('resized', () => {
      if (win.isDestroyed()) return
      this.applyScale(clampDeviceScale(win.getBounds().width / WINDOW_WIDTH))
    })

    win.on('blur', () => {
      const state = this.store.get()
      if (!state.window.pinned && state.settings.hideOnBlur && !win.isDestroyed()) win.hide()
    })

    win.on('moved', () => this.persistPosition())

    win.on('close', (event) => {
      if (this.quitting) return
      event.preventDefault()
      win.hide()
    })

    win.on('closed', () => {
      this.focusBar = null
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    loadPage(win, 'focusbar')
    this.focusBar = win
    return win
  }

  showFocusBar(trayBounds?: Electron.Rectangle): void {
    const win = this.ensureFocusBar()
    if (!win.isVisible()) this.positionFocusBar(win, trayBounds)
    win.show()
    win.focus()
  }

  hideFocusBar(): void {
    if (this.focusBar && !this.focusBar.isDestroyed()) this.focusBar.hide()
  }

  /** Menu bar click: show, focus, or hide — never a second window. */
  toggleFocusBar(trayBounds?: Electron.Rectangle): void {
    const win = this.ensureFocusBar()
    if (!win.isVisible()) {
      this.showFocusBar(trayBounds)
      return
    }
    // A pinned bar is a desk device, not a popover: the tray icon only raises it.
    if (this.store.get().window.pinned) {
      win.show()
      win.focus()
      return
    }
    if (!win.isFocused()) {
      win.focus()
      return
    }
    win.hide()
  }

  /** Requested by the renderer (Escape). Ignored while pinned. */
  hideIfUnpinned(): void {
    if (this.store.get().window.pinned) return
    this.hideFocusBar()
  }

  private positionFocusBar(win: BrowserWindow, trayBounds?: Electron.Rectangle): void {
    const saved = this.store.get().focusBarPosition
    const bounds = win.getBounds()
    let x: number
    let y: number

    if (saved) {
      x = saved.x
      y = saved.y
    } else if (trayBounds) {
      x = Math.round(trayBounds.x + trayBounds.width / 2 - bounds.width / 2)
      y = Math.round(trayBounds.y + trayBounds.height + 2)
    } else {
      const area = screen.getPrimaryDisplay().workArea
      x = Math.round(area.x + area.width - bounds.width - 24)
      y = Math.round(area.y + 16)
    }

    const clamped = this.clampToVisibleDisplay({ ...bounds, x, y })
    win.setBounds(clamped)
  }

  /** Keeps the window on a connected display after a monitor is unplugged. */
  private clampToVisibleDisplay(bounds: Electron.Rectangle): Electron.Rectangle {
    const display = screen.getDisplayMatching(bounds) ?? screen.getPrimaryDisplay()
    const area = display.workArea
    const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width)
    const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height)
    return { ...bounds, x, y }
  }

  private persistPosition(): void {
    if (!this.focusBar || this.focusBar.isDestroyed()) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      if (!this.focusBar || this.focusBar.isDestroyed()) return
      const { x, y } = this.focusBar.getBounds()
      this.store.patch({ focusBarPosition: { x, y } })
    }, 200)
  }

  // --------------------------------------------------------------------- pin

  getPinned(): boolean {
    return this.store.get().window.pinned
  }

  setPinned(pinned: boolean): boolean {
    this.store.patch({ window: { ...this.store.get().window, pinned } })
    this.applyPinState(pinned)
    return pinned
  }

  togglePinned(): boolean {
    return this.setPinned(!this.getPinned())
  }

  private applyPinState(pinned: boolean): void {
    const win = this.focusBar
    if (!win || win.isDestroyed()) return
    if (pinned) {
      win.setAlwaysOnTop(true, 'floating')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } else {
      win.setAlwaysOnTop(false)
      win.setVisibleOnAllWorkspaces(false)
    }
  }

  // ------------------------------------------------------------------ expand

  getExpanded(): boolean {
    return this.store.get().window.expanded
  }

  setExpanded(expanded: boolean): boolean {
    this.store.patch({ window: { ...this.store.get().window, expanded } })
    const win = this.focusBar
    if (win && !win.isDestroyed()) {
      const bounds = win.getBounds()
      const { height } = this.scaledSize(expanded, this.getScale())
      const target = this.clampToVisibleDisplay({ ...bounds, height })
      // The ratio has to move before the bounds, or AppKit fights the new height.
      this.applyAspectRatio(win, expanded)
      // macOS animates the resize, which is what sells the "panel sliding open".
      win.setBounds(target, true)
    }
    return expanded
  }

  toggleExpanded(): boolean {
    return this.setExpanded(!this.getExpanded())
  }

  // ------------------------------------------------------------------- resize

  getScale(): number {
    return clampDeviceScale(this.store.get().window.scale)
  }

  /** Resizes the device around its current position and remembers the size. */
  setScale(scale: number): number {
    const next = clampDeviceScale(scale)
    this.applyScale(next)
    return next
  }

  private applyScale(scale: number): void {
    const previous = this.getScale()
    this.store.patch({ window: { ...this.store.get().window, scale } })

    const win = this.focusBar
    if (win && !win.isDestroyed()) {
      const expanded = this.store.get().window.expanded
      const size = this.scaledSize(expanded, scale)
      const bounds = win.getBounds()
      if (bounds.width !== size.width || bounds.height !== size.height) {
        win.setBounds(this.clampToVisibleDisplay({ ...bounds, ...size }))
      }
      win.webContents.setZoomFactor(scale)
    }

    if (scale !== previous) {
      this.persistPosition()
      this.broadcast()
    }
  }

  private scaledSize(expanded: boolean, scale: number): { width: number; height: number } {
    const base = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT
    return { width: Math.round(WINDOW_WIDTH * scale), height: Math.round(base * scale) }
  }

  /** Locks dragging to the device's proportions, so the artwork never stretches. */
  private applyAspectRatio(win: BrowserWindow, expanded: boolean): void {
    win.setAspectRatio(WINDOW_WIDTH / (expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT))
  }

  // ------------------------------------------------------- secondary windows

  openDashboard(): void {
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      this.dashboard.show()
      this.dashboard.focus()
      app.focus({ steal: true })
      return
    }
    const win = new BrowserWindow({
      width: 900,
      height: 640,
      minWidth: 720,
      minHeight: 520,
      show: false,
      title: 'Gerdoo Dashboard',
      backgroundColor: '#0b0d10',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
      webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true }
    })
    win.once('ready-to-show', () => {
      win.show()
      app.focus({ steal: true })
    })
    win.on('closed', () => {
      this.dashboard = null
    })
    loadPage(win, 'dashboard')
    this.dashboard = win
  }

  openSettings(): void {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.show()
      this.settings.focus()
      app.focus({ steal: true })
      return
    }
    const win = new BrowserWindow({
      width: 540,
      height: 660,
      minWidth: 460,
      minHeight: 540,
      show: false,
      title: 'Gerdoo Settings',
      backgroundColor: '#0b0d10',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
      webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true }
    })
    win.once('ready-to-show', () => {
      win.show()
      app.focus({ steal: true })
    })
    win.on('closed', () => {
      this.settings = null
    })
    loadPage(win, 'settings')
    this.settings = win
  }

  closeWindow(webContentsId: number): void {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.id === webContentsId)
    if (!win) return
    if (win === this.focusBar) this.hideIfUnpinned()
    else win.close()
  }

  // ------------------------------------------------------------- broadcasting

  broadcast(): void {
    if (!this.snapshotProvider) return
    const snapshot = this.snapshotProvider()
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(SNAPSHOT_CHANNEL, snapshot)
    }
  }

  playSound(cue: SoundCue): void {
    if (!this.store.get().settings.soundEnabled) return
    const win = this.focusBar
    if (win && !win.isDestroyed()) win.webContents.send(SOUND_CHANNEL, cue)
  }

  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
  }
}
