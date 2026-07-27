# Gerdoo for iPhone and Apple Watch

The same virtual focus device, on a phone and a wrist. It is a native SwiftUI
app — Electron does not ship to iOS — but it is not a rewrite of the product:
the timer, the statuses, the colour system, the dot-matrix panel and the
calendar hand-off are ports of the files they came from, listed below, so the
two apps cannot drift into disagreeing about what a session or a status is.

The phone and the watch are **peers**, not a remote and a receiver. Each runs
the whole model; every change replicates over WatchConnectivity and the newer
snapshot wins. Either one keeps working with the other out of range or flat.
Neither talks to the desktop app.

## Layout

```
apple/
  Gerdoo.xcodeproj        four targets, one local package
  GerdooKit/              the shared package — model, panel, state, sync
    Sources/GerdooKit/
      Model/     Types, Status, Palette, Display, LedFont, AutoStatus, TimerEngine
      State/     GerdooModel (owns everything), SharedStore, Insights, Notifications, Feedback
      Sync/      WatchLink — phone ↔ watch replication
      Calendar/  EventKit and the sample schedule, behind one protocol
      UI/        LedPanelView, DeviceChrome, MascotView
      Widgets/   what an extension needs to draw itself
      Activity/  Live Activity attributes and controller
    Tests/                29 tests over the ported logic
  Gerdoo/                 iPhone app       com.gerdoo.focus
  GerdooWatch/            watch app        …focus.watchkitapp
  GerdooWidgets/          iOS widgets + Live Activity   …focus.widgets
  GerdooWatchWidgets/     watch complications           …focus.watchkitapp.complications
  Config/                 Info.plists and entitlements for all four
  scripts/typecheck.sh    every target against its real SDK, without Xcode
```

Source folders are Xcode 16-style *synchronized groups*: a file added to
`Gerdoo/` is in the target the moment it is saved, and `project.pbxproj` never
has to be touched to add one.

## What each surface shows

| | iPhone | Apple Watch |
| --- | --- | --- |
| Dot-matrix panel, timer, presets | ✅ 140 × 34 grid | ✅ 64 × 24 grid |
| Statuses, custom label, "back at" | ✅ | ✅ (no custom label) |
| Calendar, On Call during meetings | ✅ EventKit | ✅ over the link |
| Insights — streak, 7 days, heatmap | ✅ | ✖ |
| Home / Lock Screen widgets | ✅ | — |
| Watch face complications | — | ✅ circular, corner, inline, rectangular |
| Live Activity + Dynamic Island | ✅ | — |
| Notification when a session ends | ✅ | ✅ |

## Building

```bash
open apple/Gerdoo.xcodeproj
```

Then run the **Gerdoo** scheme for the phone or **GerdooWatch** for the watch.
The watch app is embedded in the phone app, so building Gerdoo builds both.

From the command line:

```bash
xcodebuild -project apple/Gerdoo.xcodeproj -scheme Gerdoo -destination 'platform=iOS Simulator,name=iPhone 17' build
```

### Tests

```bash
cd apple/GerdooKit && swift test
```

The package declares macOS as a platform for exactly this reason: the ported
logic — LED derivation, palette maths, deadline arithmetic, the calendar status
hand-off — is testable from the command line without booting a simulator. The
SwiftUI views are not covered, the same line the desktop suite draws.

```bash
apple/scripts/typecheck.sh
```

`swift test` builds for macOS, so it never compiles the UIKit, WatchKit,
WidgetKit or ActivityKit paths. This type-checks all four targets against the
SDK each one actually ships on. It needs only the toolchain — useful on a
machine where `xcodebuild` itself is not usable yet.

### Signing, and putting it on a real device

Everything is `CODE_SIGN_STYLE = Automatic` with no team, which is enough for
the simulator. For a device:

1. Xcode → Settings → Accounts, add your Apple ID. Then set the Team on all four
   targets under Signing & Capabilities.
2. Bundle IDs are `com.amirabbasranjbar.gerdoo{,.watchkitapp,.widgets,
   .watchkitapp.complications}`. They have to be unique across the App Store, so
   change the prefix if you are not that person — in the four
   `PRODUCT_BUNDLE_IDENTIFIER` pairs *and* in `WKCompanionAppBundleIdentifier`
   in `Config/GerdooWatch-Info.plist`, which is how the watch app finds its
   companion.
3. Turn on **Developer Mode** on the iPhone *and* the watch
   (Settings → Privacy & Security → Developer Mode), then reboot each.
4. Run the **Gerdoo** scheme with the iPhone selected. First launch is blocked
   until you trust the certificate: Settings → General → VPN & Device Management.
5. The watch app rides along inside the phone app. If it does not appear by
   itself, open the **Watch** app on the iPhone → Available Apps → Install.

**App Groups is off.** A free Apple ID cannot sign that capability, so the
targets carry no entitlements file. Everything works except that the widgets and
complications cannot see the app's state — they are separate processes, and the
App Group is the only thing that would let them read it — so they show the
placeholder session. The entitlement files are still in `Config/`: with a paid
account, point each target's `CODE_SIGN_ENTITLEMENTS` back at its file and they
come to life. Nothing else has to change.

## What was ported, and from where

| Here | From |
| --- | --- |
| `Model/Types.swift` | `src/shared/types.ts` |
| `Model/Status.swift` | `src/shared/status.ts` |
| `Model/Palette.swift` | `src/shared/palette.ts` |
| `Model/Display.swift` | `src/shared/display.ts` |
| `Model/LedFont.swift` | `src/shared/led-font.ts` (glyph for glyph) |
| `Model/AutoStatus.swift` | `src/main/auto-status.ts` |
| `Model/TimerEngine.swift` | `src/main/timer.ts` |
| `UI/LedPanelView.swift` | `src/renderer/src/led/{engine.ts,LedPanel.tsx}` |
| `UI/MascotView.swift` | `src/renderer/src/components/Mascot.tsx` |
| `UI/DeviceChrome.swift` | `src/renderer/src/styles/{tokens,device}.css` |
| `State/Insights.swift` | `src/renderer/src/dashboard/Dashboard.tsx` |
| `Calendar/CalendarService.swift` | `src/main/calendar.ts` |
| `State/SharedStore.swift` | `src/main/store.ts` |

### Where it deliberately differs

- **Milliseconds became `Date`.** watchOS builds for `arm64_32`, where `Int` is
  32 bits and an epoch in milliseconds overflows it.
- **No ICS feed.** The desktop needs one because Windows has no system calendar
  API. iOS subscribes to feeds at the OS level, so a feed the user cares about
  is already an EventKit calendar; a second iCalendar parser would only be a
  worse one.
- **State lives in `UserDefaults`, not a JSON file.** Widgets and complications
  have to read it without launching the app.
- **The panel does not tick in a widget.** A dot grid cannot count seconds the
  way `Text(_:style: .timer)` can, so widgets draw the countdown to the minute
  and re-render on the minute rather than claiming a precision they cannot keep.
  Complications and the Live Activity, which are plain type, do count seconds.
- **Gone, because they mean nothing here:** launch at login, hide on blur,
  window pinning and scale, the menu bar title row.
- **New, because the hardware has them:** haptics, keeping the screen awake, and
  the Digital Crown setting a session length off the preset dial.
- **Notification permission is asked for at the first session**, not at launch:
  the first thing a new user sees should be the device, not a system alert about
  a feature they have not used yet. `SessionAlert.schedule` asks when it has an
  actual bell to book.

## Sync, in one paragraph

`WatchLink` sends the whole `AppSnapshot` through `updateApplicationContext`,
which keeps only the newest value and is delivered even if the other side is
asleep — the exact semantics of "here is the current state". A receiver adopts a
snapshot only when its `updatedAt` is newer, so an old one cannot ping-pong back
and forth. Presses also send a `SyncCommand`, so a tap on the watch starts the
session on the phone even before the snapshot lands, and the snapshot that comes
back settles any disagreement.
