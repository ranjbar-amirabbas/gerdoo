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
| `npm run build:native` | Compiles the EventKit calendar helper (Swift, macOS only) |

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

Events come from the real **macOS Calendar** via EventKit. Electron has no
EventKit binding, so `native/StitchCalendar.swift` is compiled to a small helper
binary that prints JSON, and the main process spawns it on each refresh:

```bash
npm run build:native      # → resources/stitch-calendar (also run by `npm run dist`)
./resources/stitch-calendar --status     # permission state, no prompt
./resources/stitch-calendar --days 7     # events as JSON
```

The helper carries its `Info.plist` in a linked `__TEXT,__info_plist` section
(a CLI tool has no bundle for TCC to read usage strings from) and is ad-hoc
signed so macOS keeps a stable identity for the granted permission. It ships
**outside the asar** via `extraResources` — code inside an asar cannot be
executed.

### Granting access

macOS only shows the Calendar prompt when the request comes from a real app
bundle, so **use the packaged app** (`npm run dist`, then launch
`dist/mac-arm64/Stitch.app`). Stitch asks once, shortly after first launch;
Settings → Calendar access can ask again, or deep-link to Privacy & Security →
Calendars if the answer was no. Running `npm run dev` inherits Electron's own
bundle identity, which has no usage strings — expect `notDetermined` there and
either package the app or add the `NSCalendars*` keys to the dev Electron's
`Info.plist`.

Behaviour when a read fails: the last successful set of events is reused —
stale truth beats invented meetings — and only a machine that has never granted
access falls back to `MockCalendarProvider`'s sample schedule. The real reason
stays in `calendar.access` so Settings can explain itself. Events are cached in
`userData` so the panel shows your next meeting immediately at launch.

Swapping in a different source (an ICS feed, Google Calendar) means implementing
`CalendarProvider` in `src/main/calendar.ts` — nothing downstream knows where
events come from.

## Keyboard

| Key | Action |
| --- | --- |
| `Escape` | Hide the Focus Bar (ignored while pinned) |
| `⌘E` | Expand / collapse the control panel |
| `⌘P` | Pin / unpin |
| `⌘,` | Settings (from the tray menu) |

## Known gaps

- Calendar access needs the packaged app; `npm run dev` cannot prompt (above).
- The helper reads a seven-day window from the start of today
  (`CALENDAR_WINDOW_DAYS` in `src/main/calendar.ts`). Only today's events are
  listed in the Dashboard; the rest feed "now" and "next".
- The packaged app is unsigned; `npm run dist` produces a DMG that macOS will
  gatekeeper-warn about until you sign and notarise it.
- `npm audit` reports advisories in the `electron-builder` dependency tree only;
  nothing there ships inside the app.
