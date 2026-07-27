# Stitch

A menu bar focus companion for macOS. The product is a **virtual focus device**:
a small, hardware-styled window with a dot-matrix LED panel that shows your
timer, your status, and what is coming up next.

<!-- Focus Bar: 520 × 230 collapsed, 520 × 490 expanded. -->

## Running it

```bash
npm install
npm run dev
```

The app has no Dock icon. Look for the LED-bar glyph in the menu bar — click it
to show the Focus Bar, click again to hide it (while unpinned).

| Script | What it does |
| --- | --- |
| `npm run dev` | electron-vite dev server with HMR for all three renderers |
| `npm run build` | Bundles main, preload and renderers into `out/` |
| `npm run typecheck` | Type-checks the Node side and the web side separately |
| `npm run dist` | Builds and packages a macOS arm64 DMG into `dist/` |
| `npm run icons` | Regenerates the tray template images and app icon |

## How it is put together

```
src/
  main/        Electron main process — the only place with privileges
    index.ts     app wiring, IPC handlers, session records, notifications
    windows.ts   the single Focus Bar window, pinning, expand, Dashboard/Settings
    timer.ts     authoritative timer (deadline-based, survives sleep)
    tray.ts      menu bar icon, dynamic context menu, live countdown title
    calendar.ts  CalendarProvider interface + the current mock source
    store.ts     atomic JSON persistence in userData
  preload/     contextBridge surface — the renderer's entire API
  renderer/    three windows: focusbar, dashboard, settings
    src/led/     canvas dot-matrix engine + <LedPanel>
  shared/      types, IPC channel names, LED fonts, display derivation
```

### State flow

The main process owns all state and pushes a full `AppSnapshot` to every window
on each change. Renderers never hold authoritative state; they render the
snapshot and call back through `window.stitch.*`. What the LED panel shows is
derived in one place — `deriveLedContent()` in `src/shared/display.ts` — so the
panel, the tray title and the Dashboard can never disagree.

### The timer

`TimerService` stores a wall-clock **deadline**, not a countdown. A dropped
interval, a hidden window, or a Mac that slept for an hour cannot make it drift;
on `powerMonitor` resume it re-checks the deadline immediately. The running
session is persisted, so quitting mid-session and reopening resumes it.

### The LED panel

`src/renderer/src/led/engine.ts` rasterises hand-authored bitmap fonts
(`src/shared/led-font.ts`: 5×7 for labels, 8×14 for the countdown) into a
140 × 34 dot grid and paints it on a canvas at device pixel ratio. No third-party
font is involved. The unlit grid is pre-rendered once and blitted; only lit dots
cost anything per frame. Mode changes play a ~260 ms column sweep, label changes
a ~150 ms crossfade, and the ticking countdown repaints instantly — physical
panels do not fade their digits. Reduced motion drops all three to an instant
repaint.

Colours are semantic tokens (`src/shared/status.ts`), not literals: focus is
cyan, break amber, on call red, in meeting violet, available deep blue, paused
neutral amber, do not disturb red-orange. The accent flows into the shell — the
brand dot, the primary key, the dial ticks — through the `--accent` variable.

### Pinning

Pin state lives in the main process and is persisted.

- **Unpinned** — behaves like a menu bar panel: hides on blur, Escape hides it.
- **Pinned** — `setAlwaysOnTop(true, 'floating')` plus
  `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`. Escape is
  ignored, blur is ignored, and the tray icon only raises it.

Window position is saved on move and clamped back onto a connected display at
startup, so unplugging a monitor cannot strand the window offscreen.

### Security

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a strict CSP
in each HTML file, and `setWindowOpenHandler` sending any external URL to the
system browser. The renderer sees exactly the methods declared in
`StitchApi` (`src/shared/ipc.ts`) — no `ipcRenderer`, no `require`, no
`BrowserWindow`.

## Calendar data

Calendar events currently come from `MockCalendarProvider` — today's and
tomorrow's sample schedule. To use real data, implement `CalendarProvider`:

```ts
export interface CalendarProvider {
  listEvents(now: number): Promise<CalendarEvent[]>
}
```

and pass it to `CalendarService` in `src/main/index.ts`. Nothing downstream of
that file knows where events come from. Realistic options: a small Swift
EventKit helper binary, an ICS feed URL, or Google Calendar OAuth.

## Keyboard

| Key | Action |
| --- | --- |
| `Escape` | Hide the Focus Bar (ignored while pinned) |
| `⌘E` | Expand / collapse the control panel |
| `⌘P` | Pin / unpin |
| `⌘,` | Settings (from the tray menu) |

## Known gaps

- Calendar events are mock data (see above).
- The packaged app is unsigned; `npm run dist` produces a DMG that macOS will
  gatekeeper-warn about until you sign and notarise it.
- `npm audit` reports advisories in the `electron-builder` dependency tree only;
  nothing there ships inside the app.
