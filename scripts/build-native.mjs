/**
 * Compiles the EventKit helper into `resources/stitch-calendar`.
 *
 * The Info.plist is linked into the binary (TCC reads the usage strings from
 * there — a CLI tool has no bundle to read them from), and the result is
 * ad-hoc signed so macOS can keep a stable identity for the granted permission.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
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

try {
  execFileSync('swiftc', ['--version'], { stdio: 'ignore' })
} catch {
  console.error('swiftc not found — install the Xcode Command Line Tools:')
  console.error('  xcode-select --install')
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
