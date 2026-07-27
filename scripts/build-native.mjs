/**
 * Compiles the EventKit helper into `resources/stitch-calendar`.
 *
 * The Info.plist is linked into the binary (TCC reads the usage strings from
 * there — a CLI tool has no bundle to read them from), and the result is
 * ad-hoc signed so macOS can keep a stable identity for the granted permission.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native', 'StitchCalendar.swift')
const plist = join(root, 'native', 'Info.plist')
const output = join(root, 'resources', 'stitch-calendar')

if (process.platform !== 'darwin') {
  console.log('skipping the calendar helper: macOS only')
  process.exit(0)
}

const upToDate =
  existsSync(output) &&
  [source, plist].every((file) => statSync(file).mtimeMs <= statSync(output).mtimeMs)

if (upToDate && !process.argv.includes('--force')) {
  console.log('calendar helper is up to date — pass --force to rebuild')
  process.exit(0)
}

// `swiftc --version` exits 0 while printing the licence complaint, so check the
// output rather than the exit code.
let toolchain = ''
try {
  toolchain = execFileSync('swiftc', ['--version'], { encoding: 'utf8', stdio: 'pipe' })
} catch {
  console.error('swiftc not found — install the Xcode Command Line Tools:')
  console.error('  xcode-select --install')
  process.exit(1)
}

if (/license agreement/i.test(toolchain)) {
  console.error('the Xcode licence has not been accepted, so swiftc will not run:')
  console.error('  sudo xcodebuild -license accept')
  process.exit(1)
}

mkdirSync(dirname(output), { recursive: true })

const args = [
  '-O',
  '-swift-version',
  '5',
  '-target',
  'arm64-apple-macos13.0',
  '-framework',
  'EventKit',
  '-framework',
  'Foundation',
  '-Xlinker',
  '-sectcreate',
  '-Xlinker',
  '__TEXT',
  '-Xlinker',
  '__info_plist',
  '-Xlinker',
  plist,
  '-o',
  output,
  source
]

console.log('compiling the calendar helper…')
execFileSync('swiftc', args, { stdio: 'inherit' })
execFileSync('codesign', ['--force', '--sign', '-', output], { stdio: 'inherit' })

if (!existsSync(output)) {
  console.error('the helper was not produced')
  process.exit(1)
}
console.log(`built ${output}`)
