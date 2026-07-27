# Gerdoo

A menu bar focus companion for macOS. The product is a **virtual focus device**:
a small, hardware-styled window with a dot-matrix LED panel that shows your
timer, your status, and what is coming up next.

<!-- Focus Bar: 520 × 230 collapsed, 520 × 490 expanded, at scale 1. Dragging an
     edge zooms the whole device between 0.7× and 2×; the ratio stays locked. -->

## Installing a release

Grab the `.dmg` from [Releases](https://github.com/ranjbar-amirabbas/gerdoo/releases),
open it and drag Gerdoo to Applications. Apple silicon (arm64) only.

The build is ad-hoc signed but **not notarized** — that needs a paid Apple
Developer account — so macOS blocks it the first time:

> "Gerdoo.app" Not Opened — Apple could not verify "Gerdoo.app" is free of
> malware that may harm your Mac or compromise your privacy.

The quickest way past it is to drop the quarantine flag your browser attached to
the download:

```bash
xattr -dr com.apple.quarantine /Applications/Gerdoo.app
```

Or, without the Terminal: open the app, dismiss the warning with **Done**, then
go to **System Settings → Privacy & Security**, scroll to *Security*, and click
**Open Anyway**.

On macOS 15 and later, right-clicking the app and choosing *Open* does **not**
work — Apple removed that bypass. If you instead see *"Gerdoo.app" is damaged and
can't be opened*, that is a different failure: the app reached you with a broken
signature. Releases before v1.1.1 have that problem; take a later one.

## Running it

```bash
npm install
npm run dev
```

The app has no Dock icon. Look for the mascot's head in the menu bar, over by the
system icons — click it to show the Focus Bar, click again to hide it (while
unpinned).

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
    tray.ts      menu bar icon, dynamic context menu, live status/countdown title
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
snapshot and call back through `window.gerdoo.*`. What the LED panel shows is
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

### The menu bar title

Next to the tray icon Gerdoo prints its current state — `On Call`, `In Meeting`,
`Do Not Disturb`, or `Focus 24:31` while a session runs. The text comes from
`deriveMenuBarTitle()` in `src/shared/display.ts`, which wraps
`deriveLedContent()`, so the menu bar cannot claim a state the panel disagrees
with. LED labels are shouted, menu bar labels are not, so they are title-cased —
except a custom status, which keeps the user's own capitalisation. Titles are
capped at 22 characters; the notch is shared property.

Settings → System → Menu bar picks between **Status** (the default), **Timer**
(the countdown, only while a session runs — the old behaviour) and **Icon only**.
Only the running countdown ticks per second; every other change rides the normal
snapshot publish. The tooltip always carries the full label, big line and
sub-label.

### Where the icon sits

A new status item is placed at the far left of the menu bar extras, which is the
first place macOS hides things when the bar runs out of room behind the notch —
a poor spot for something meant to be read at a glance. On its very first run
Gerdoo writes AppKit's own `NSStatusItem Preferred Position Item-0` default
(`seedMenuBarPosition()` in `src/main/tray.ts`) to claim a place beside the
system icons instead. AppKit reads that key only when the item is created, so
the write has to happen before the tray exists. It happens once ever, guarded by
`menuBarPositionSeeded` in the store: afterwards the key belongs to the user,
who can ⌘-drag the icon anywhere they like and have it stay there.

Measured on a 1512 pt menu bar, the value is points from the right: 250 lands
next to the system icons, 600 in the middle of the third-party ones, and no
value at all leaves the item leftmost.

### The tray icon

The menu bar icon is the mascot's head — the same circle clusters as
`Mascot.tsx`, stencilled. A template image is alpha only (macOS recolours it for
light and dark bars), so the face is punched out of the silhouette rather than
drawn on top of it, and it is drawn larger than a literal transcription: at
16 px an eye is two pixels wide, and the mascot's real eyes disappear. The
lowest ear circle is dropped, and a notch is cut on each side, or the ears read
as a lump with feet. Regenerate with `npm run icons`.

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
`GerdooApi` (`src/shared/ipc.ts`) — no `ipcRenderer`, no `require`, no
`BrowserWindow`.

## Calendar data

Events come from the real **macOS Calendar** via EventKit. Electron has no
EventKit binding, so `native/GerdooCalendar.swift` is compiled to a small helper
binary that prints JSON, and the main process spawns it on each refresh:

```bash
npm run build:native      # → resources/gerdoo-calendar (also run by `npm run dist`)
./resources/gerdoo-calendar --status     # permission state, no prompt
./resources/gerdoo-calendar --days 7     # events as JSON
```

The helper carries its `Info.plist` in a linked `__TEXT,__info_plist` section
(a CLI tool has no bundle for TCC to read usage strings from) and is ad-hoc
signed so macOS keeps a stable identity for the granted permission. It ships
**outside the asar** via `extraResources` — code inside an asar cannot be
executed.

### Granting access

macOS only shows the Calendar prompt when the request comes from a real app
bundle, so **use the packaged app** (`npm run dist`, then launch
`dist/mac-arm64/Gerdoo.app`). Gerdoo asks once, shortly after first launch;
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
| `⌘+` / `⌘−` | Grow / shrink the device |
| `⌘0` | Reset the device to its design size |
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
