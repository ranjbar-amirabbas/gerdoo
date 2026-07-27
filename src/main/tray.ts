import { Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'node:path'
import { STATUSES, STATUS_ORDER } from '@shared/status'
import { formatDuration } from '@shared/display'
import type { AppSnapshot, StatusId } from '@shared/types'

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

  constructor(private readonly actions: TrayActions) {}

  init(snapshot: AppSnapshot): void {
    // Packaged: inside the asar. Dev: two levels up from out/main.
    const base = app.isPackaged ? app.getAppPath() : join(__dirname, '..', '..')
    const iconPath = join(base, 'resources', 'trayTemplate.png')
    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) console.error(`[stitch] tray icon missing at ${iconPath}`)
    image.setTemplateImage(true)
    this.tray = new Tray(image)
    this.tray.setToolTip('Stitch')
    this.tray.on('click', (_event, bounds) => this.actions.toggleFocusBar(bounds))
    this.tray.on('right-click', () => this.tray?.popUpContextMenu())
    this.update(snapshot)
  }

  /** Rebuilt on every state change so checkmarks and labels never go stale. */
  update(snapshot: AppSnapshot): void {
    if (!this.tray) return
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
      { label: 'Quit Stitch', accelerator: 'Command+Q', click: () => this.actions.quit() }
    ])

    this.tray.setContextMenu(menu)
    this.updateCountdown(timer)
  }

  /** Cheap per-second refresh: title only, no menu rebuild. */
  updateCountdown(timer: AppSnapshot['timer']): void {
    if (!this.tray) return
    this.tray.setTitle(timer.phase === 'running' ? ` ${formatDuration(timer.remainingMs)}` : '')
  }

  dispose(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
