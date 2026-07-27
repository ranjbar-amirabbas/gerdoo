/**
 * The few places the UI has to know which desktop it is on: the modifier key it
 * names in tooltips, and which side of a frameless title bar the window
 * controls take up.
 */
const platform = window.gerdoo.platform

export const IS_MAC = platform === 'darwin'
export const IS_WINDOWS = platform === 'win32'

/** `⌘E` on a Mac, `Ctrl+E` everywhere else. */
export function shortcut(key: string): string {
  return IS_MAC ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`
}

/** True when the accelerator modifier for this platform is held. */
export function hasAccelerator(event: KeyboardEvent): boolean {
  return IS_MAC ? event.metaKey : event.ctrlKey
}

/**
 * Lets the stylesheets pad a hand-drawn title bar around the native window
 * controls, which sit left on macOS and right on Windows.
 */
export function markPlatform(): void {
  document.documentElement.dataset.platform = platform
}
