/**
 * Runs the test suites: `npm test`.
 *
 * The tests are TypeScript that imports straight out of `src/`, so each file is
 * bundled with esbuild into `.test-build/` first — the same transform the app
 * itself gets, rather than a second opinion about what the source means.
 *
 * Two runners, because the suites need different hosts:
 *
 *   `*.test.ts`           plain Node, under `node --test`.
 *   `*.electron.test.ts`  Electron, because the code under test uses `net.fetch`.
 *                         `node --test` cannot launch these; they register their
 *                         own `node:test` cases and exit the app themselves.
 *
 * Anything that depends on the local clock is run under several timezones — the
 * calendar bugs worth catching are the ones that only appear off UTC. Pass
 * `--tz=UTC` (or any zone list) to narrow that down while iterating.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = join(root, 'test')
const outDir = join(root, '.test-build')

/**
 * Zones chosen to break different assumptions: UTC (where a naive
 * implementation passes), a zone behind it with DST, one at a half-hour offset,
 * and one ahead of it whose DST runs the other way round.
 */
const DEFAULT_ZONES = ['UTC', 'America/New_York', 'Asia/Tehran', 'Australia/Sydney']

const zoneArg = process.argv.find((arg) => arg.startsWith('--tz='))
const zones = zoneArg ? zoneArg.slice('--tz='.length).split(',') : DEFAULT_ZONES

const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
if (files.length === 0) {
  console.error('no test files in test/')
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const nodeTests = []
const electronTests = []

for (const file of files) {
  const isElectron = file.endsWith('.electron.test.ts')
  const output = join(outDir, file.replace(/\.ts$/, '.cjs'))
  execFileSync(
    'npx',
    [
      'esbuild',
      join(testDir, file),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=node22',
      // Electron is provided by the host, and the alias mirrors the one in
      // `electron.vite.config.ts` so imports resolve the same way they do in
      // the app.
      '--external:electron',
      '--alias:@shared=./src/shared',
      `--outfile=${output}`,
      '--log-level=warning'
    ],
    { cwd: root, stdio: 'inherit' }
  )
  ;(isElectron ? electronTests : nodeTests).push(output)
}

let failed = false

function run(label, command, args, env) {
  console.log(`\n── ${label}`)
  try {
    execFileSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  } catch {
    failed = true
  }
}

for (const zone of zones) {
  if (nodeTests.length > 0) {
    run(`node --test  TZ=${zone}`, process.execPath, ['--test', ...nodeTests], { TZ: zone })
  }
}

// The Electron suite talks to a local socket, not to the clock, so once is enough.
for (const file of electronTests) {
  // `--log-level=3` is Chromium's: fatal only. Without it the suite's expected
  // failures — a webcal:// URL rewritten to https:// and pointed at a plain
  // HTTP server — bury the results under TLS handshake errors.
  run(`electron     ${file.replace(`${root}/`, '')}`, 'npx', [
    'electron',
    file,
    '--log-level=3'
  ])
}

console.log(failed ? '\ntests failed' : '\nall tests passed')
process.exit(failed ? 1 : 0)
