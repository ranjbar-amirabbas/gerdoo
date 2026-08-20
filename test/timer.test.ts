/**
 * What a length change is allowed to do to the timer.
 *
 * The deadline is the whole point of `TimerService`, so a session already
 * counting down keeps the length it started with: a pick made mid-session is
 * held by the app and spent on the next one. Everything here drives the service
 * directly — no Electron, no store.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { TimerService } from '../src/main/timer'
import type { TimerState } from '../src/shared/types'

const MINUTE = 60_000

function idleTimer(minutes = 25): TimerService {
  return new TimerService(null, minutes, 'DEEP WORK')
}

test('a running session keeps the length it started with', () => {
  const timer = idleTimer()
  timer.start({ mode: 'focus', minutes: 25 })
  const before = timer.getState()

  timer.setDurationMinutes(50)

  const after = timer.getState()
  assert.equal(after.durationMs, 25 * MINUTE)
  assert.equal(after.endsAt, before.endsAt)
  timer.dispose()
})

test('a paused session keeps what is left of its own length', () => {
  const timer = idleTimer()
  timer.start({ mode: 'focus', minutes: 25 })
  timer.pause()
  const paused = timer.getState().remainingMs

  timer.setDurationMinutes(50)

  const after = timer.getState()
  assert.equal(after.durationMs, 25 * MINUTE)
  assert.equal(after.remainingMs, paused)
  timer.dispose()
})

test('an idle timer takes the new length', () => {
  const timer = idleTimer()

  timer.setDurationMinutes(50)

  const state = timer.getState()
  assert.equal(state.durationMs, 50 * MINUTE)
  assert.equal(state.remainingMs, 50 * MINUTE)
  timer.dispose()
})

test('a completed session has nothing left to protect', () => {
  // Restoring a session whose deadline has passed lands in `completed` without
  // having to wait a real interval out.
  const finished: TimerState = {
    mode: 'focus',
    phase: 'running',
    durationMs: 25 * MINUTE,
    remainingMs: 0,
    endsAt: Date.now() - 1000,
    startedAt: Date.now() - 26 * MINUTE,
    title: 'DEEP WORK'
  }
  const timer = new TimerService(finished, 25, 'DEEP WORK')
  assert.equal(timer.getState().phase, 'completed')

  timer.setDurationMinutes(50)

  assert.equal(timer.getState().durationMs, 50 * MINUTE)
  timer.acknowledgeCompletion()
  assert.equal(timer.getState().remainingMs, 50 * MINUTE)
  timer.dispose()
})
