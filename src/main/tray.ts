import { Menu, Tray, app, nativeImage } from 'electron'
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

export class TrayController {
  private tray: Tray | null = null
  /** Last snapshot seen, so a tick can refresh the title without a full publish. */
  private snapshot: AppSnapshot | null = null

  constructor(private readonly actions: TrayActions) {}

  init(snapshot: AppSnapshot): void {
    // Packaged: inside the asar. Dev: two levels up from out/main.
    const base = app.isPackaged ? app.getAppPath() : join(__dirname, '..', '..')
    const iconPath = join(base, 'resources', 'trayTemplate.png')
    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) console.error(`[gerdoo] tray icon missing at ${iconPath}`)
    image.setTemplateImage(true)
    this.tray = new Tray(image)
    this.tray.setToolTip('Gerdoo')
    this.tray.on('click', (_event, bounds) => this.actions.toggleFocusBar(bounds))
    this.tray.on('right-click', () => this.tray?.popUpContextMenu())
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
      { label: 'Settings…', accelerator: 'Command+,', click: () => this.actions.openSettings() },
      { type: 'separator' },
      { label: 'Quit Gerdoo', accelerator: 'Command+Q', click: () => this.actions.quit() }
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
    // The leading space keeps the text off the icon.
    this.tray.setTitle(title ? ` ${title}` : '')

    const content = deriveLedContent(this.snapshot, now)
    const line = [content.label, content.big].filter(Boolean).join(' ')
    this.tray.setToolTip(content.sub ? `${line} — ${content.sub}` : line)
  }

  dispose(): void {
    this.tray?.destroy()
    this.tray = null
    this.snapshot = null
  }
}
