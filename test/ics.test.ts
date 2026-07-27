/**
 * The iCalendar reader, exercised against hand-written feeds.
 *
 * Everything here is deterministic: a fixed window in March 2025, chosen because
 * it straddles the US daylight-saving change on the 9th. The suite is run under
 * four timezones by `scripts/test.mjs` — several of these assertions only fail
 * when the machine's own clock is not UTC, which is most machines.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { expandIcs, parseIcs } from '../src/main/ics'

/** Monday 3 March 2025, 00:00 UTC, through the following Monday. */
const WINDOW_START = Date.UTC(2025, 2, 3)
const WINDOW_END = Date.UTC(2025, 2, 10)

const iso = (ms: number): string => new Date(ms).toISOString()

function feed(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n')
}

function event(...lines: string[]): string {
  return feed('BEGIN:VEVENT', ...lines, 'END:VEVENT')
}

function occurrences(
  text: string,
  from: number = WINDOW_START,
  to: number = WINDOW_END
): ReturnType<typeof expandIcs> {
  return expandIcs(parseIcs(text), from, to)
}

const startTimes = (text: string, from?: number, to?: number): string[] =>
  occurrences(text, from, to).map((o) => iso(o.startsAt))

// ------------------------------------------------------------------- basics

test('reads a single event, unfolding and unescaping as it goes', () => {
  const calendar = parseIcs(
    feed(
      'X-WR-CALNAME:Work',
      'BEGIN:VEVENT',
      'UID:simple-1',
      'SUMMARY:Design rev',
      ' iew',
      'DTSTART:20250304T140000Z',
      'DTEND:20250304T144500Z',
      'LOCATION:Room 2\\, floor 3',
      'END:VEVENT'
    )
  )
  assert.equal(calendar.name, 'Work')

  const [only, ...rest] = expandIcs(calendar, WINDOW_START, WINDOW_END)
  assert.equal(rest.length, 0)
  assert.equal(only.title, 'Design review')
  assert.equal(only.location, 'Room 2, floor 3')
  assert.equal(iso(only.startsAt), '2025-03-04T14:00:00.000Z')
  assert.equal(only.endsAt - only.startsAt, 45 * 60_000)
})

test('takes the length from DURATION when there is no DTEND', () => {
  const [only] = occurrences(
    event('UID:d', 'SUMMARY:D', 'DTSTART:20250304T090000Z', 'DURATION:PT1H30M')
  )
  assert.equal(only.endsAt - only.startsAt, 90 * 60_000)
})

test('reads an all-day event as whole local days', () => {
  const [only] = occurrences(
    event(
      'UID:ad',
      'SUMMARY:Holiday',
      'DTSTART;VALUE=DATE:20250305',
      'DTEND;VALUE=DATE:20250307'
    )
  )
  assert.equal(only.isAllDay, true)
  assert.equal(new Date(only.startsAt).getHours(), 0, 'starts at local midnight')
  assert.equal((only.endsAt - only.startsAt) / 86_400_000, 2)
})

test('flags a cancelled event rather than dropping it', () => {
  const [only] = occurrences(
    event('UID:x', 'SUMMARY:Gone', 'DTSTART:20250304T090000Z', 'DURATION:PT1H', 'STATUS:CANCELLED')
  )
  assert.equal(only.isCancelled, true)
})

test('ignores a VALARM nested inside the event', () => {
  assert.deepEqual(
    startTimes(
      feed(
        'BEGIN:VEVENT',
        'UID:al',
        'SUMMARY:With alarm',
        'DTSTART:20250304T090000Z',
        'DURATION:PT1H',
        'BEGIN:VALARM',
        'TRIGGER:-PT15M',
        'DTSTART:19000101T000000Z',
        'END:VALARM',
        'END:VEVENT'
      )
    ),
    ['2025-03-04T09:00:00.000Z']
  )
})

// ---------------------------------------------------------------- timezones

test('resolves a TZID through the IANA database', () => {
  // 09:00 in New York on 4 March is EST, five hours behind UTC.
  assert.deepEqual(
    startTimes(
      event(
        'UID:tz',
        'SUMMARY:NY',
        'DTSTART;TZID=America/New_York:20250304T090000',
        'DTEND;TZID=America/New_York:20250304T093000'
      )
    ),
    ['2025-03-04T14:00:00.000Z']
  )
})

test('keeps a recurring event at the same wall-clock hour across a DST change', () => {
  // New York moves to EDT on 9 March: the same 09:00 is now four hours behind.
  assert.deepEqual(
    startTimes(
      event(
        'UID:tz2',
        'SUMMARY:NY',
        'DTSTART;TZID=America/New_York:20250304T090000',
        'DURATION:PT30M',
        'RRULE:FREQ=DAILY'
      ),
      Date.UTC(2025, 2, 10),
      Date.UTC(2025, 2, 12)
    ),
    ['2025-03-10T13:00:00.000Z', '2025-03-11T13:00:00.000Z']
  )
})

test('falls back to the local clock for a zone name it cannot resolve', () => {
  // Older Outlook feeds still emit Windows zone names, which `Intl` rejects.
  const [only] = occurrences(
    event(
      'UID:tz3',
      'SUMMARY:X',
      'DTSTART;TZID=W. Europe Standard Time:20250304T090000',
      'DURATION:PT1H'
    )
  )
  assert.equal(new Date(only.startsAt).getHours(), 9)
})

// --------------------------------------------------------------- recurrence

test('expands a weekly rule over its BYDAY list', () => {
  assert.deepEqual(
    startTimes(
      event(
        'UID:w',
        'SUMMARY:Standup',
        'DTSTART:20240101T093000Z',
        'DURATION:PT15M',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'
      )
    ),
    [
      '2025-03-03T09:30:00.000Z',
      '2025-03-05T09:30:00.000Z',
      '2025-03-07T09:30:00.000Z'
    ]
  )
})

test('honours INTERVAL on a weekly rule', () => {
  // Every second Monday from 17 February: the 3rd is in, the 10th is not.
  assert.deepEqual(
    startTimes(
      event(
        'UID:wi',
        'SUMMARY:Biweekly',
        'DTSTART:20250217T100000Z',
        'DURATION:PT30M',
        'RRULE:FREQ=WEEKLY;INTERVAL=2'
      )
    ),
    ['2025-03-03T10:00:00.000Z']
  )
})

test('removes the instances named by EXDATE', () => {
  assert.deepEqual(
    occurrences(
      event(
        'UID:e',
        'SUMMARY:Daily',
        'DTSTART:20250303T080000Z',
        'DURATION:PT30M',
        'RRULE:FREQ=DAILY',
        'EXDATE:20250304T080000Z,20250305T080000Z'
      )
    ).map((o) => iso(o.startsAt).slice(0, 10)),
    ['2025-03-03', '2025-03-06', '2025-03-07', '2025-03-08', '2025-03-09']
  )
})

test('stops a rule at COUNT', () => {
  assert.equal(
    occurrences(
      event(
        'UID:c',
        'SUMMARY:Three',
        'DTSTART:20250303T080000Z',
        'DURATION:PT30M',
        'RRULE:FREQ=DAILY;COUNT=3'
      )
    ).length,
    3
  )
})

test('treats UNTIL as inclusive', () => {
  assert.deepEqual(
    occurrences(
      event(
        'UID:u',
        'SUMMARY:Until',
        'DTSTART:20250303T080000Z',
        'DURATION:PT30M',
        'RRULE:FREQ=DAILY;UNTIL=20250305T080000Z'
      )
    ).map((o) => iso(o.startsAt).slice(0, 10)),
    ['2025-03-03', '2025-03-04', '2025-03-05']
  )
})

test('expands an ordinal BYDAY: the first Tuesday of the month', () => {
  assert.deepEqual(
    startTimes(
      event(
        'UID:m',
        'SUMMARY:FirstTue',
        'DTSTART:20240102T160000Z',
        'DURATION:PT1H',
        'RRULE:FREQ=MONTHLY;BYDAY=1TU'
      )
    ),
    ['2025-03-04T16:00:00.000Z']
  )
})

test('counts a negative BYDAY ordinal back from the end of the month', () => {
  const rule = event(
    'UID:m2',
    'SUMMARY:LastFri',
    'DTSTART:20240126T160000Z',
    'DURATION:PT1H',
    'RRULE:FREQ=MONTHLY;BYDAY=-1FR'
  )
  assert.equal(occurrences(rule).length, 0, 'the 28th is outside the window')
  assert.deepEqual(startTimes(rule, Date.UTC(2025, 2, 24), Date.UTC(2025, 2, 31)), [
    '2025-03-28T16:00:00.000Z'
  ])
})

test('applies BYSETPOS: the last weekday of the month', () => {
  assert.deepEqual(
    startTimes(
      event(
        'UID:sp',
        'SUMMARY:LastWeekday',
        'DTSTART:20240131T170000Z',
        'DURATION:PT1H',
        'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'
      ),
      Date.UTC(2025, 2, 24),
      Date.UTC(2025, 3, 1)
    ),
    ['2025-03-31T17:00:00.000Z']
  )
})

test('skips a BYMONTHDAY the month does not have, rather than clamping it', () => {
  const rule = event(
    'UID:md',
    'SUMMARY:Rent',
    'DTSTART:20240131T090000Z',
    'DURATION:PT30M',
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=31'
  )
  assert.equal(occurrences(rule, Date.UTC(2025, 1, 1), Date.UTC(2025, 2, 1)).length, 0)
  assert.deepEqual(startTimes(rule, Date.UTC(2025, 2, 1), Date.UTC(2025, 3, 1)), [
    '2025-03-31T09:00:00.000Z'
  ])
})

test('expands a yearly rule', () => {
  const found = occurrences(
    event('UID:y', 'SUMMARY:Birthday', 'DTSTART;VALUE=DATE:20000305', 'RRULE:FREQ=YEARLY')
  )
  assert.equal(found.length, 1)
  assert.equal(found[0].title, 'Birthday')
})

test('lets a RECURRENCE-ID event replace the instance it names', () => {
  const found = occurrences(
    feed(
      'BEGIN:VEVENT',
      'UID:r',
      'SUMMARY:Weekly sync',
      'DTSTART:20250303T110000Z',
      'DURATION:PT1H',
      'RRULE:FREQ=DAILY;COUNT=5',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:r',
      'RECURRENCE-ID:20250305T110000Z',
      'SUMMARY:Weekly sync (moved)',
      'DTSTART:20250305T150000Z',
      'DURATION:PT1H',
      'END:VEVENT'
    )
  )
  assert.deepEqual(
    found.map((o) => `${o.title} @ ${iso(o.startsAt)}`),
    [
      'Weekly sync @ 2025-03-03T11:00:00.000Z',
      'Weekly sync @ 2025-03-04T11:00:00.000Z',
      'Weekly sync (moved) @ 2025-03-05T15:00:00.000Z',
      'Weekly sync @ 2025-03-06T11:00:00.000Z',
      'Weekly sync @ 2025-03-07T11:00:00.000Z'
    ]
  )
})

// ------------------------------------------------------------ window edges

test('keeps an event that began before the window but runs into it', () => {
  assert.equal(
    occurrences(
      event('UID:ov', 'SUMMARY:Spans', 'DTSTART:20250302T230000Z', 'DTEND:20250303T010000Z')
    ).length,
    1
  )
})

test('drops an event that finished before the window', () => {
  assert.equal(
    occurrences(
      event('UID:be', 'SUMMARY:Before', 'DTSTART:20250301T090000Z', 'DTEND:20250301T100000Z')
    ).length,
    0
  )
})

test('fast-forwards a decades-old daily rule instead of walking it', () => {
  const rule = event(
    'UID:old',
    'SUMMARY:Ancient',
    'DTSTART:19900101T080000Z',
    'DURATION:PT30M',
    'RRULE:FREQ=DAILY'
  )
  const began = process.hrtime.bigint()
  const found = occurrences(rule)
  const ms = Number(process.hrtime.bigint() - began) / 1e6
  assert.equal(found.length, 7)
  // Walking 1990 to now one day at a time would be ~13,000 steps per refresh.
  assert.ok(ms < 50, `expansion took ${ms.toFixed(1)}ms`)
})

// -------------------------------------------------------------- bad input

test('survives text that is not a calendar at all', () => {
  assert.deepEqual(occurrences(''), [])
  assert.deepEqual(occurrences('not a calendar at all'), [])
})

test('drops an event with no DTSTART', () => {
  assert.equal(parseIcs(event('UID:n', 'SUMMARY:S')).events.length, 0)
})

test('gives an event with no SUMMARY a usable title', () => {
  const [only] = occurrences(event('UID:ns', 'DTSTART:20250304T090000Z'))
  assert.equal(only.title, 'Busy')
})

test('ignores a sub-daily frequency but keeps the event itself', () => {
  // Expanding SECONDLY over a week would produce hundreds of thousands of rows.
  assert.equal(
    occurrences(
      event(
        'UID:bf',
        'SUMMARY:S',
        'DTSTART:20250304T090000Z',
        'DURATION:PT1H',
        'RRULE:FREQ=SECONDLY;COUNT=100'
      )
    ).length,
    1
  )
})
