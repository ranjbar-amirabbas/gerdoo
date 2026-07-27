import { Menu, Tray, app, nativeImage, systemPreferences } from 'electron'
import { join } from 'node:path'
import { STATUSES, STATUS_ORDER } from '@shared/status'
import { deriveLedContent, deriveMenuBarTitle } from '@shared/display'
import type { AppSnapshot, StatusId, TimerState } from '@shared/types'

export interface TrayActions {
  showFocusBar(trayBounds?: Electron.Rectangle): void
  toggleFocusBar(trayBounds?: Electron.Rectangle): void
  togglePinned(): void
  startFocus(): void
  toggleTimer(): void
  stopTimer(): void
  setStatus(id: StatusId): void
  openDashboard(): void
  openSettings(): void
  quit(): void
}

/**
 * AppKit stores where a status item sits under this key, named after the item's
 * autosave name — an unnamed item, which is what Electron creates, is `Item-0`.
 */
const POSITION_KEY = 'NSStatusItem Preferred Position Item-0'

/**
 * Points from the right of the menu bar. A brand new status item is placed at
 * the far left of the extras, which is exactly where macOS starts hiding things
 * when the bar runs out of room behind the notch — the worst spot for the one
 * item that is meant to be readable at a glance. Measured on a 1512 pt bar:
 * 250 lands Gerdoo just left of the system icons, 600 in the middle of the
 * third-party ones, and no value at all leaves it leftmost.
 */
const PREFERRED_POSITION = 250

/**
 * Claim a spot near the clock, once, before the status item is created — AppKit
 * reads this at creation and never again. Only ever done on the first run: after
 * that the key belongs to the user, who can ⌘-drag the icon wherever they like.
 */
export function seedMenuBarPosition(): void {
  if (process.platform !== 'darwin') return
  try {
    systemPreferences.setUserDefault(POSITION_KEY, 'float', PREFERRED_POSITION)
  } catch (error) {
    console.error('[gerdoo] could not set the menu bar position:', error)
  }
}

export class TrayController {
  private tray: Tray | null = null
  /** Last snapshot seen, so a tick can refresh the title without a full publish. */
  private snapshot: AppSnapshot | null = null

  constructor(private readonly actions: TrayActions) {}

  init(snapshot: AppSnapshot): void {
    // Packaged: inside the asar. Dev: two levels up from out/main.
    const base = app.isPackaged ? app.getAppPath() : join(__dirname, '..', '..')
    // Only macOS has template images. Elsewhere the icon keeps its colours, and
    // Windows wants an ICO so it can pick the size that fits the current DPI.
    const iconFile =
      process.platform === 'darwin'
        ? 'trayTemplate.png'
        : process.platform === 'win32'
          ? 'tray.ico'
          : 'tray.png'
    const iconPath = join(base, 'resources', iconFile)
    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) console.error(`[gerdoo] tray icon missing at ${iconPath}`)
    if (process.platform === 'darwin') image.setTemplateImage(true)
    this.tray = new Tray(image)
    this.tray.setToolTip('Gerdoo')
    this.tray.on('click', (_event, bounds) => this.actions.toggleFocusBar(bounds))
    // Windows pops the context menu itself on right-click once one is attached;
    // doing it here as well would open the menu twice.
    if (process.platform === 'darwin') {
      this.tray.on('right-click', () => this.tray?.popUpContextMenu())
    }
    this.update(snapshot)
  }

  /** Rebuilt on every state change so checkmarks and labels never go stale. */
  update(snapshot: AppSnapshot): void {
    if (!this.tray) return
    this.snapshot = snapshot
    const { timer, status, window } = snapshot
    const running = timer.phase === 'running'
    const paused = timer.phase === 'paused'
    const active = running || paused
    const presetMinutes = snapshot.settings.presets[snapshot.settings.selectedPresetIndex] ?? 25

    const menu = Menu.buildFromTemplate([
      { label: 'Show Focus Bar', click: () => this.actions.showFocusBar() },
      {
        label: 'Pin Focus Bar',
        type: 'checkbox',
        checked: window.pinned,
        click: () => this.actions.togglePinned()
      },
      { type: 'separator' },
      {
        label: `Start Focus (${presetMinutes} min)`,
        enabled: !active,
        click: () => this.actions.startFocus()
      },
      {
        label: running ? 'Pause' : paused ? 'Resume' : 'Pause',
        enabled: active,
        click: () => this.actions.toggleTimer()
      },
      {
        label: 'Stop Session',
        enabled: active || timer.phase === 'completed',
        click: () => this.actions.stopTimer()
      },
      { type: 'separator' },
      {
        label: 'Set Status',
        submenu: STATUS_ORDER.map((id) => ({
          label: id === 'custom' ? 'Custom…' : STATUSES[id].label,
          type: 'radio' as const,
          checked: status.id === id,
          click: () => this.actions.setStatus(id)
        }))
      },
      { type: 'separator' },
      { label: 'Open Dashboard', click: () => this.actions.openDashboard() },
      {
        label: 'Settings…',
        accelerator: 'CommandOrControl+,',
        click: () => this.actions.openSettings()
      },
      { type: 'separator' },
      {
        label: 'Quit Gerdoo',
        accelerator: 'CommandOrControl+Q',
        click: () => this.actions.quit()
      }
    ])

    this.tray.setContextMenu(menu)
    this.render()
  }

  /** Cheap per-second refresh: title only, no menu rebuild. */
  updateTimer(timer: TimerState): void {
    if (!this.snapshot) return
    this.snapshot = { ...this.snapshot, timer, now: Date.now() }
    this.render()
  }

  /** Title and tooltip, both derived from the panel's own content. */
  private render(): void {
    if (!this.tray || !this.snapshot) return
    const now = Date.now()
    const title = deriveMenuBarTitle(this.snapshot, now)

    if (process.platform === 'darwin') {
      // The leading space keeps the text off the icon.
      this.tray.setTitle(title ? ` ${title}` : '')
    }

    const content = deriveLedContent(this.snapshot, now)
    const line = [content.label, content.big].filter(Boolean).join(' ')
    const tooltip = content.sub ? `${line} — ${content.sub}` : line
    // Only macOS draws text beside a tray icon. Everywhere else the tooltip is
    // the whole of it, so the menu bar title leads — it is the line the user
    // chose in Settings — with the panel's own reading behind it.
    this.tray.setToolTip(
      process.platform === 'darwin' || !title ? tooltip : `${title} — ${tooltip}`
    )
  }

  dispose(): void {
    this.tray?.destroy()
    this.tray = null
    this.snapshot = null
  }
}
