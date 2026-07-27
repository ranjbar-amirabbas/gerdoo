# Gerdoo

A focus companion that lives in the macOS menu bar and the Windows system tray.
The product is a **virtual focus device**: a small, hardware-styled window with a
dot-matrix LED panel that shows your timer, your status, and what is coming up
next.

<!-- Focus Bar: 520 × 230 collapsed, 520 × 490 expanded. -->

## What runs where

| | macOS | Windows |
| --- | --- | --- |
| Focus Bar, timer, statuses, Dashboard, Settings | ✅ | ✅ |
| Tray icon and menu | menu bar | system tray |
| Status / countdown text beside the icon | ✅ | tooltip only — Windows draws no text next to a tray icon |
| Calendar events from a subscribed **feed URL** | ✅ | ✅ |
| Calendar events from the **system calendar** | ✅ EventKit | ✖ macOS only |
| Launch at login, notifications, sounds | ✅ | ✅ |

## Installing a release

Both are on [Releases](https://github.com/ranjbar-amirabbas/gerdoo/releases).

**Windows** — take `Gerdoo-<version>-x64-setup.exe` (or the `arm64` one) and run
it. It installs into your user profile, so it never asks for an administrator.
The build is unsigned, so SmartScreen shows *Windows protected your PC*: click
**More info → Run anyway**. There is also a `-portable.exe` that runs from
anywhere without installing — note that Windows only attaches notifications to a
Start menu shortcut, so the portable build stays silent.

**macOS** — grab the `.dmg`, open it and drag Gerdoo to Applications. Apple
silicon (arm64) only.

### Getting past Gatekeeper on macOS

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

The app has no Dock icon and no taskbar button. Look for the mascot's head in the
menu bar (macOS, over by the system icons) or the system tray (Windows, behind
the `^` if Windows tucked it away) — click it to show the Focus Bar, click again
to hide it (while unpinned). Right-click opens the menu.

| Script | What it does |
| --- | --- |
| `npm run dev` | electron-vite dev server with HMR for all three renderers |
| `npm run build` | Bundles main, preload and renderers into `out/` |
| `npm run typecheck` | Type-checks the Node side and the web side separately |
| `npm run dist` | Builds and packages for the machine you are on, into `dist/` |
| `npm run dist:mac` | macOS arm64 DMG |
| `npm run dist:win` | Windows NSIS installer (x64 + arm64) and an x64 portable exe |
| `npm run icons` | Regenerates the tray images and app icons |
| `npm run build:native` | Compiles the EventKit calendar helper (Swift, macOS only; a no-op elsewhere) |

Each installer has to be built on its own platform: the macOS DMG needs
`codesign`, and NSIS needs Windows (or Wine).

## How it is put together

```
src/
  main/        Electron main process — the only place with privileges
    index.ts     app wiring, IPC handlers, session records, notifications
    windows.ts   the single Focus Bar window, pinning, expand, Dashboard/Settings
    timer.ts     authoritative timer (deadline-based, survives sleep)
    tray.ts      tray icon, dynamic context menu, live status/countdown title
    calendar.ts  CalendarProvider interface + the EventKit, feed and mock sources
    ics.ts       iCalendar reader: parsing and recurrence expansion
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

Only macOS draws text beside a tray icon — `Tray.setTitle` does nothing on
Windows. There the same line leads the tooltip instead, so the setting still
changes what Gerdoo tells you; it just takes a hover to read. Settings names the
row after the platform: *Menu bar* on macOS, *System tray* on Windows.

### Where the icon sits (macOS)

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

Windows has no equivalent: new tray icons go into the overflow flyout, and
whether one is promoted to the taskbar is the user's setting, not the app's.

### The tray icon

Both tray icons are the mascot's head — the same circle clusters as
`Mascot.tsx` — but they are two different drawings, because the platforms want
opposite things.

macOS takes a **template image**: alpha only, recoloured for light and dark bars.
So the face is punched out of the silhouette rather than drawn on top of it, and
it is drawn larger than a literal transcription would be — at 16 px an eye is two
pixels wide, and the mascot's real eyes disappear. The lowest ear circle is
dropped and a notch is cut on each side, or the ears read as a lump with feet.

Windows and Linux keep whatever colours they are given, on a taskbar that may be
light or dark, so there the dog is drawn in full colour and leans on his own
outline for contrast — thickened, since the mascot's 2.5-unit stroke lands well
under a pixel at tray sizes. Both eyes are open (the winking arc is a hairline
that vanishes below ~32 px) and the body, collar and tag are cropped away.
Windows gets an `.ico` holding seven independently drawn sizes so it can pick one
per DPI rather than scaling.

`scripts/generate-icons.mjs` draws every one of them as raw pixels and encodes
the PNG and ICO containers by hand — no image library, no binary art in the repo
that cannot be regenerated. `npm run icons`.

### Window chrome

The Dashboard and Settings windows hide the native title bar and draw their own,
which means placing the window controls by hand — and the platforms put them on
opposite sides. macOS gets `titleBarStyle: 'hiddenInset'` with the traffic lights
inset to match the 46 px bar; Windows gets `titleBarStyle: 'hidden'` plus a
`titleBarOverlay` of the same height, and the stylesheet reserves 148 px on the
right for it (plain `hidden` on Windows would leave a window with no way to close
it). `markPlatform()` stamps `data-platform` on `<html>` so the CSS can tell.

The Focus Bar is frameless and transparent on both, with `thickFrame: false` on
Windows — the 1 px chrome border it otherwise draws cuts a bright line across the
device's rounded corners. It hangs below the tray icon on macOS and above it on
Windows, where the taskbar is usually at the bottom.

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

Settings → System → Calendar source picks between three providers, all behind
the same `CalendarProvider` interface in `src/main/calendar.ts` — nothing
downstream knows where an event came from.

| Source | Where events come from |
| --- | --- |
| **macOS Calendar** | EventKit, through a bundled Swift helper. macOS only. |
| **Feed URL** | A subscribed `.ics` feed, fetched over HTTPS. Both platforms. |
| **Sample** | The built-in demo schedule. Needs nothing. |

A state file that asks for the system source on Windows is corrected to the
sample schedule on load, rather than left asking for access that can never
arrive. The cached events are tagged with the source that wrote them, so
switching feeds never shows the previous one's meetings while the new one loads.

### The system calendar (macOS)

Electron has no EventKit binding, so `native/GerdooCalendar.swift` is compiled to
a small helper binary that prints JSON, and the main process spawns it on each
refresh:

```bash
npm run build:native      # → resources/gerdoo-calendar (also run by `npm run dist`)
./resources/gerdoo-calendar --status     # permission state, no prompt
./resources/gerdoo-calendar --days 7     # events as JSON
```

The helper carries its `Info.plist` in a linked `__TEXT,__info_plist` section
(a CLI tool has no bundle for TCC to read usage strings from) and is ad-hoc
signed so macOS keeps a stable identity for the granted permission. It ships
**outside the asar** via `extraResources` — code inside an asar cannot be
executed — and that `extraResources` entry sits under `mac:` in
`electron-builder.yml`, so a Windows build never looks for a Mach-O binary that
was not compiled.

### Granting access

macOS only shows the Calendar prompt when the request comes from a real app
bundle, so **use the packaged app** (`npm run dist`, then launch
`dist/mac-arm64/Gerdoo.app`). Gerdoo asks once, shortly after first launch;
Settings → Calendar access can ask again, or deep-link to Privacy & Security →
Calendars if the answer was no. Running `npm run dev` inherits Electron's own
bundle identity, which has no usage strings — expect `notDetermined` there and
either package the app or add the `NSCalendars*` keys to the dev Electron's
`Info.plist`.

### Feed URL (any platform)

Every calendar worth the name publishes an iCalendar feed — Google's *secret
address in iCal format*, Outlook's *publish a calendar*, Fastmail and Apple's
*public calendar* links. Paste one into Settings and Gerdoo reads it directly.
This is how Windows gets real events, and it works just as well on a Mac that
would rather not hand over Calendar access.

`webcal://` is rewritten to `https://`; anything that is not HTTP(S) after that
is refused. The fetch goes through Electron's `net.fetch`, so it follows the
system proxy, and it is capped at 8 MB and 15 seconds. A response that is not an
iCalendar file — almost always a login page rather than the feed — is reported
as exactly that.

The feed is fetched at most every five minutes and the parsed result is cached;
the 30-second refresh re-expands it from memory, so "now" and "next" keep moving
without hammering somebody's server. The Refresh button skips the cache.

`src/main/ics.ts` is the reader: a deliberately small RFC 5545 subset covering
line folding, escaping, `DTSTART`/`DTEND`/`DURATION`, all-day dates, `STATUS`,
and the recurrence machinery that generates most of a real calendar —
`RRULE` (`DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY` with `INTERVAL`, `COUNT`, `UNTIL`,
`BYDAY` including ordinals like `-1FR`, `BYMONTHDAY`, `BYMONTH`, `BYSETPOS`),
`EXDATE`, and `RECURRENCE-ID` overrides for the one instance somebody moved.
VTODO, VJOURNAL and VALARM are skipped.

Two details worth knowing. **Timezones**: `VTIMEZONE` blocks are ignored and a
`TZID` is resolved as an IANA zone name through `Intl`, which is what modern
feeds emit; a name the runtime does not know falls back to the local clock
rather than failing the read. Recurrence is expanded over wall-clock fields and
converted to an instant per occurrence, so a 9 am standup stays at 9 am across a
daylight-saving change. **Cost**: a daily rule set up years ago would otherwise
be walked one day at a time on every refresh, so expansion fast-forwards
straight to the window when no `COUNT` makes the running total matter.

### When a read fails

The last successful set of events is reused — stale truth beats invented
meetings — and only a source that has never succeeded falls back to
`MockCalendarProvider`'s sample schedule, and then only when the failure is not
one the user has to fix (a bad feed URL shows the error, not fake meetings). The
real reason stays in `calendar.access`, with `calendar.detail` carrying the
message, so Settings can say what actually went wrong. Events are cached in
`userData` so the panel shows your next meeting immediately at launch.

Another source (Google's API, Windows' own `Windows.ApplicationModel.Appointments`)
means implementing `CalendarProvider` and adding a case to `CalendarService`.

## Keyboard

| Key | Action |
| --- | --- |
| `Escape` | Hide the Focus Bar (ignored while pinned) |
| `⌘E` / `Ctrl+E` | Expand / collapse the control panel |
| `⌘P` / `Ctrl+P` | Pin / unpin |
| `⌘,` / `Ctrl+,` | Settings (from the tray menu) |

The renderer reads `window.gerdoo.platform` and matches the right modifier —
`Ctrl+E` on a Mac must not expand the panel, and `⌘E` on Windows cannot.

## Known gaps

- Reading the *system* calendar is macOS only. Windows needs a feed URL, which
  means a calendar that publishes one.
- On Windows the status/countdown line lives in the tray tooltip, because
  Windows draws no text beside a tray icon.
- Calendar access needs the packaged app; `npm run dev` cannot prompt (above).
- Both sources read a seven-day window from the start of today
  (`CALENDAR_WINDOW_DAYS` in `src/main/calendar.ts`). Only today's events are
  listed in the Dashboard; the rest feed "now" and "next".
- The ICS reader covers what real calendars emit, not all of RFC 5545: no
  sub-daily frequencies, no `BYWEEKNO`/`BYYEARDAY`, and `VTIMEZONE` definitions
  are ignored in favour of IANA zone names.
- Neither packaged app is properly signed: the DMG is ad-hoc signed and
  gatekeeper-warns, and the Windows installer is unsigned and trips SmartScreen.
- `npm audit` reports advisories in the `electron-builder` dependency tree only;
  nothing there ships inside the app.
