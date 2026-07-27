import { BrowserWindow, app, screen, shell } from 'electron'
import { join } from 'node:path'
import type { AppSnapshot } from '@shared/types'
import { SNAPSHOT_CHANNEL, SOUND_CHANNEL, type SoundCue } from '@shared/types'
import type { Store } from './store'

/** Device artwork size. The window adds padding so CSS can cast a real shadow. */
export const DEVICE_WIDTH = 520
export const DEVICE_COLLAPSED_HEIGHT = 230
export const DEVICE_EXPANDED_HEIGHT = 490
export const SHADOW_PAD = 14

export const WINDOW_WIDTH = DEVICE_WIDTH + SHADOW_PAD * 2
export const COLLAPSED_HEIGHT = DEVICE_COLLAPSED_HEIGHT + SHADOW_PAD * 2
export const EXPANDED_HEIGHT = DEVICE_EXPANDED_HEIGHT + SHADOW_PAD * 2

const PRELOAD = join(__dirname, '../preload/index.js')

const IS_MAC = process.platform === 'darwin'
const IS_WINDOWS = process.platform === 'win32'

/** Chrome of the Dashboard and Settings windows: a frameless bar the app draws. */
const APP_TITLEBAR_HEIGHT = 46

/**
 * Both secondary windows hide the native title bar and draw their own, so the
 * window controls have to be placed by hand — and the two platforms put them on
 * opposite sides. macOS insets the traffic lights; Windows overlays its own
 * buttons on the right, which needs `titleBarOverlay` (plain `hidden` there
 * leaves a window with no way to close it). Anywhere else, keep the frame.
 */
function titleBarOptions(): Electron.BrowserWindowConstructorOptions {
  if (IS_MAC) {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
  }
  if (IS_WINDOWS) {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#0b0d10',
        symbolColor: '#9aa2ad',
        height: APP_TITLEBAR_HEIGHT
      }
    }
  }
  return {}
}

/**
 * Windows and Linux take a window's icon from the window itself, not the
 * bundle. A packaged build gets it from the executable; a dev run has no
 * executable of its own, so without this it shows the stock Electron logo.
 */
function windowIcon(): string | undefined {
  if (IS_MAC || app.isPackaged) return undefined
  return join(__dirname, '..', '..', 'build', IS_WINDOWS ? 'icon.ico' : 'icon.png')
}

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
    const height = windowState.expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT

    const win = new BrowserWindow({
      width: WINDOW_WIDTH,
      height,
      minWidth: WINDOW_WIDTH,
      maxWidth: WINDOW_WIDTH,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false, // the device casts its own shadow in CSS
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      acceptFirstMouse: true,
      roundedCorners: false,
      // Windows draws a 1 px chrome border around a frameless window, which
      // cuts a bright line across the device's own rounded corners.
      thickFrame: false,
      icon: windowIcon(),
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

    win.once('ready-to-show', () => {
      this.applyPinState(this.store.get().window.pinned)
      this.positionFocusBar(win)
      win.show()
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
      // The bar hangs off the tray icon — below a menu bar at the top of the
      // screen, above a taskbar at the bottom, which is where Windows usually
      // puts it. Either way it never covers the icon it belongs to.
      const display = screen.getDisplayMatching(trayBounds) ?? screen.getPrimaryDisplay()
      const trayMiddle = trayBounds.y + trayBounds.height / 2
      const trayIsAtTop = trayMiddle < display.bounds.y + display.bounds.height / 2
      y = trayIsAtTop
        ? Math.round(trayBounds.y + trayBounds.height + 2)
        : Math.round(trayBounds.y - bounds.height - 2)
    } else {
      // No tray bounds: the corner the tray icon would have been in.
      const area = screen.getPrimaryDisplay().workArea
      x = Math.round(area.x + area.width - bounds.width - 24)
      y = IS_MAC
        ? Math.round(area.y + 16)
        : Math.round(area.y + area.height - bounds.height - 16)
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
      const height = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT
      const target = this.clampToVisibleDisplay({ ...bounds, height })
      // macOS animates the resize, which is what sells the "panel sliding
      // open". Windows ignores the flag and snaps, which is its own convention.
      win.setBounds(target, true)
    }
    return expanded
  }

  toggleExpanded(): boolean {
    return this.setExpanded(!this.getExpanded())
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
      icon: windowIcon(),
      ...titleBarOptions(),
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
      icon: windowIcon(),
      ...titleBarOptions(),
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
