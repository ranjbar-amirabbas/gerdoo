// electron-builder `afterPack` hook: give the packaged bundle a real ad-hoc
// signature.
//
// Without a Developer ID certificate, electron-builder skips signing entirely.
// What is left is the linker-signed ad-hoc signature Electron shipped with,
// which names `Electron` as its identifier, does not bind our Info.plist and
// carries no resource seal. On Apple silicon that signature no longer matches
// the repacked bundle, and macOS refuses to launch it with "Gerdoo.app is
// damaged and can't be opened" — which reads as a corrupt download but is a
// signature failure.
//
// Signing ad-hoc ourselves fixes that. The app is still not notarized, so
// Gatekeeper stops a quarantined copy on first launch, but it stops it with the
// ordinary unidentified-developer prompt that right-click → Open clears.
//
// This runs before electron-builder's own signing step, so a real Developer ID
// signature would simply replace what we do here.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** @type {(context: import('app-builder-lib').AfterPackContext) => Promise<void>} */
export default async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )
  if (!existsSync(appPath)) {
    throw new Error(`adhoc-sign: no bundle at ${appPath}`)
  }

  // Nested Mach-O binaries first — an outer signature seals whatever the inner
  // ones already have. `--deep` reaches the frameworks and helper apps, but not
  // a loose executable in Resources, so that one is signed by hand.
  const helper = join(appPath, 'Contents', 'Resources', 'gerdoo-calendar')
  if (existsSync(helper)) {
    sign(helper, ['--identifier', 'com.gerdoo.focusbar.calendar-helper'])
  }

  sign(appPath, ['--deep'])

  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'pipe',
  })
  console.log(`  • ad-hoc signed  file=${appPath}`)
}

function sign(target, extraArgs) {
  execFileSync(
    'codesign',
    ['--force', ...extraArgs, '--sign', '-', '--timestamp=none', target],
    { stdio: 'pipe' }
  )
}
