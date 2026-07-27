/**
 * `IcsCalendarProvider`, against a throwaway HTTP server on localhost.
 *
 * Runs under Electron rather than plain Node: the provider fetches through
 * `net.fetch` so that it follows the system proxy, and that only exists in a
 * real Electron process. `scripts/test.mjs` launches it — `node --test` cannot.
 */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import test from 'node:test'
import { app } from 'electron'
import { IcsCalendarProvider } from '../src/main/calendar'

const NOW = Date.now()

/** One event a few hours out, so it always lands inside the seven-day window. */
function feedText(): string {
  const at = new Date(NOW + 3 * 3600_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}00Z`
  return [
    'BEGIN:VCALENDAR',
    'X-WR-CALNAME:Test feed',
    'BEGIN:VEVENT',
    'UID:live-1',
    'SUMMARY:Live event',
    `DTSTART:${stamp}`,
    'DURATION:PT1H',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
}

interface Harness {
  base: string
  /** How many times the feed itself has actually been served. */
  hits(): number
  close(): void
}

async function serve(): Promise<Harness> {
  let hits = 0
  const server: Server = createServer((request, response) => {
    if (request.url?.startsWith('/ok.ics')) {
      hits++
      response.writeHead(200, { 'content-type': 'text/calendar' })
      response.end(feedText())
    } else if (request.url === '/login') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<html>sign in first</html>')
    } else {
      response.writeHead(404)
      response.end('nope')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    base: `http://127.0.0.1:${port}`,
    hits: () => hits,
    close: () => server.close()
  }
}

const SCHEME_REFUSED = 'The URL has to start with https://, http:// or webcal://.'

let failures = 0

/**
 * A subtest whose failure this file can see.
 *
 * `node:test` records a failed run by setting `process.exitCode` from its own
 * `exit` handler — which never runs here, because an Electron app has to be
 * stopped with `app.exit(code)` and that code is decided before the handler
 * would fire. So the failure is counted on the way past and rethrown, leaving
 * the reporter's output exactly as it was.
 */
async function step(
  t: import('node:test').TestContext,
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  await t.test(name, async () => {
    try {
      await fn()
    } catch (error) {
      failures++
      throw error
    }
  })
}

async function main(): Promise<void> {
  await app.whenReady()
  // Otherwise every expected failure below prints a stack to the test output.
  const quiet = console.error
  console.error = () => {}
  const harness = await serve()

  await test('the ICS provider', async (t) => {
    const provider = new IcsCalendarProvider()

    await step(t, 'says so when no URL has been given', async () => {
      assert.deepEqual(await provider.listEvents(NOW), {
        access: 'notConfigured',
        events: [],
        detail: null
      })
    })

    await step(t, 'rejects something that is not a URL', async () => {
      provider.setUrl('not a url')
      const result = await provider.listEvents(NOW)
      assert.equal(result.access, 'error')
      assert.equal(result.detail, 'That is not a valid URL.')
    })

    await step(t, 'refuses a scheme that is not HTTP', async () => {
      provider.setUrl('file:///etc/passwd')
      assert.equal((await provider.listEvents(NOW)).detail, SCHEME_REFUSED)
    })

    await step(t, 'rewrites webcal:// rather than refusing it', async () => {
      // Rewritten to https://, which this plain HTTP server cannot answer — the
      // point is only that it got past the scheme check.
      provider.setUrl(harness.base.replace('http://', 'webcal://') + '/ok.ics')
      assert.notEqual((await provider.listEvents(NOW)).detail, SCHEME_REFUSED)
    })

    await step(t, 'reports the status of a feed that is not there', async () => {
      provider.setUrl(`${harness.base}/missing.ics`)
      const result = await provider.listEvents(NOW)
      assert.equal(result.access, 'error')
      assert.equal(result.detail, 'The feed answered 404 Not Found.')
    })

    await step(t, 'recognises a login page as not being a calendar', async () => {
      provider.setUrl(`${harness.base}/login`)
      const result = await provider.listEvents(NOW)
      assert.equal(result.access, 'error')
      assert.equal(result.detail, 'That URL did not return an iCalendar file.')
    })

    await step(t, 'reads a real feed', async () => {
      provider.setUrl(`${harness.base}/ok.ics`)
      const result = await provider.listEvents(NOW)
      assert.equal(result.access, 'authorized')
      assert.equal(result.events.length, 1)
      assert.equal(result.events[0].title, 'Live event')
      assert.equal(result.events[0].calendar, 'Test feed', 'uses X-WR-CALNAME')
      assert.equal(harness.hits(), 1)
    })

    await step(t, 'serves a second read from its cache', async () => {
      await provider.listEvents(NOW)
      assert.equal(harness.hits(), 1)
    })

    await step(t, 'fetches again when the read is forced', async () => {
      await provider.listEvents(NOW, { force: true })
      assert.equal(harness.hits(), 2)
    })

    await step(t, 'fetches again when the URL changes', async () => {
      provider.setUrl(`${harness.base}/ok.ics?calendar=other`)
      await provider.listEvents(NOW)
      assert.equal(harness.hits(), 3)
    })
  })

  console.error = quiet
  harness.close()
  app.exit(failures === 0 ? 0 : 1)
}

void main().catch((error) => {
  console.error(error)
  app.exit(1)
})
