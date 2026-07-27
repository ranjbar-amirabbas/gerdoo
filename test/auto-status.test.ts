/**
 * The calendar-driven status hand-off: ON CALL while an event runs, and the
 * previous status back afterwards.
 *
 * `resolveAutoStatus` is pure, so every case here is a plain input/output pair —
 * no clock, no store, no calendar.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAutoStatus, type AutoStatusHold } from '../src/main/auto-status'
import type { CalendarEvent, StatusState } from '../src/shared/types'

const NOW = Date.UTC(2025, 2, 3, 10, 0)

const AVAILABLE: StatusState = { id: 'available', customLabel: '', until: null }

function event(id: string, endsAt = NOW + 30 * 60_000): CalendarEvent {
  return { id, title: 'TEAM SYNC', startsAt: NOW - 60_000, endsAt, isAllDay: false }
}

function resolve(
  options: {
    enabled?: boolean
    current?: CalendarEvent | null
    status?: StatusState
    hold?: AutoStatusHold | null
    now?: number
  } = {}
) {
  return resolveAutoStatus({
    enabled: options.enabled ?? true,
    current: options.current ?? null,
    status: options.status ?? AVAILABLE,
    hold: options.hold ?? null,
    now: options.now ?? NOW
  })
}

test('an event that has started takes the status to ON CALL until it ends', () => {
  const current = event('a')
  const decision = resolve({ current })
  assert.deepEqual(decision.status, { id: 'oncall', customLabel: '', until: current.endsAt })
  assert.deepEqual(decision.hold, { eventId: 'a', previous: AVAILABLE })
})

test('the status it replaced comes back when the event ends', () => {
  const dnd: StatusState = { id: 'dnd', customLabel: '', until: NOW + 60 * 60_000 }
  const decision = resolve({
    current: null,
    status: { id: 'oncall', customLabel: '', until: NOW },
    hold: { eventId: 'a', previous: dnd }
  })
  assert.deepEqual(decision.status, dnd)
  assert.equal(decision.hold, null)
})

test('a stale "until" is dropped on the way back', () => {
  const decision = resolve({
    current: null,
    status: { id: 'oncall', customLabel: '', until: NOW },
    hold: { eventId: 'a', previous: { id: 'dnd', customLabel: '', until: NOW - 60_000 } }
  })
  assert.deepEqual(decision.status, { id: 'dnd', customLabel: '', until: null })
})

test('nothing to do when no event is running and nothing is held', () => {
  assert.deepEqual(resolve(), { hold: null, status: null })
})

test('the same event mid-flight leaves the status alone', () => {
  const current = event('a')
  const decision = resolve({
    current,
    status: { id: 'oncall', customLabel: '', until: current.endsAt },
    hold: { eventId: 'a', previous: AVAILABLE }
  })
  assert.equal(decision.status, null)
  assert.deepEqual(decision.hold, { eventId: 'a', previous: AVAILABLE })
})

test('an event moved while it runs drags the "until" with it', () => {
  const current = event('a', NOW + 45 * 60_000)
  const decision = resolve({
    current,
    status: { id: 'oncall', customLabel: '', until: NOW + 30 * 60_000 },
    hold: { eventId: 'a', previous: AVAILABLE }
  })
  assert.deepEqual(decision.status, { id: 'oncall', customLabel: '', until: current.endsAt })
})

test('back-to-back meetings still restore what preceded the first one', () => {
  const second = event('b', NOW + 90 * 60_000)
  const custom: StatusState = { id: 'custom', customLabel: 'WRITING', until: null }
  const handOff = resolve({
    current: second,
    status: { id: 'oncall', customLabel: 'WRITING', until: NOW },
    hold: { eventId: 'a', previous: custom }
  })
  assert.deepEqual(handOff.hold, { eventId: 'b', previous: custom })
  assert.deepEqual(handOff.status, {
    id: 'oncall',
    customLabel: 'WRITING',
    until: second.endsAt
  })

  const end = resolve({ current: null, status: handOff.status!, hold: handOff.hold })
  assert.deepEqual(end.status, custom)
  assert.equal(end.hold, null)
})

test('turning the setting off mid-meeting hands the status back', () => {
  const decision = resolve({
    enabled: false,
    current: event('a'),
    status: { id: 'oncall', customLabel: '', until: NOW + 30 * 60_000 },
    hold: { eventId: 'a', previous: AVAILABLE }
  })
  assert.deepEqual(decision.status, AVAILABLE)
  assert.equal(decision.hold, null)
})

test('with the setting off a running event changes nothing', () => {
  assert.deepEqual(resolve({ enabled: false, current: event('a') }), { hold: null, status: null })
})
