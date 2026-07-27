import type { CalendarEvent, StatusState } from '@shared/types'

/**
 * What Gerdoo has to remember while it is driving the status itself: which
 * event put it On Call, and the status to hand back when that event ends.
 *
 * It is persisted, so a restart in the middle of a meeting still knows the
 * status is on loan rather than something the user chose.
 */
export interface AutoStatusHold {
  eventId: string
  /** The status in force before the event started. */
  previous: StatusState
}

export interface AutoStatusInput {
  /** The `autoOnCall` setting. */
  enabled: boolean
  /** The event happening right now, from `CalendarState.current`. */
  current: CalendarEvent | null
  /** The status as it stands. */
  status: StatusState
  /** The hold in force, or null when the status is the user's own. */
  hold: AutoStatusHold | null
  now: number
}

export interface AutoStatusDecision {
  /** The hold to persist — null gives the status back to the user. */
  hold: AutoStatusHold | null
  /** The status to apply, or null to leave it exactly as it is. */
  status: StatusState | null
}

/**
 * Decides what the status should be for the calendar as it stands right now.
 *
 * The rule is short: while an event is running the status is ON CALL, and when
 * it ends the previous status comes back. Everything else is bookkeeping around
 * that — back-to-back meetings hand the hold straight on rather than restoring
 * in between, and a meeting that is moved while it runs drags its `until` with
 * it.
 *
 * A manual status change drops the hold at the call site, so a hold reaching
 * this function always describes a status Gerdoo set itself; the user's own
 * choice is never overwritten mid-meeting.
 *
 * Pure on purpose — the caller owns the store, the clock and the calendar.
 */
export function resolveAutoStatus(input: AutoStatusInput): AutoStatusDecision {
  const { enabled, current, status, hold, now } = input

  // Turned off mid-meeting: give the status back rather than stranding it.
  if (!enabled) return hold ? release(hold, now) : { hold: null, status: null }

  if (!current) return hold ? release(hold, now) : { hold: null, status: null }

  if (hold?.eventId === current.id) {
    // Same meeting, but it may have been shortened or extended underneath us.
    if (status.id === 'oncall' && status.until !== current.endsAt) {
      return { hold, status: { ...status, until: current.endsAt } }
    }
    return { hold, status: null }
  }

  // A new event takes over. Straight from another meeting, what comes back at
  // the end is still whatever preceded the *first* one.
  const previous = hold ? hold.previous : status
  return {
    hold: { eventId: current.id, previous },
    status: { id: 'oncall', customLabel: status.customLabel, until: current.endsAt }
  }
}

function release(hold: AutoStatusHold, now: number): AutoStatusDecision {
  const previous = hold.previous
  return {
    hold: null,
    // An "until" from before the meeting has usually gone stale by now — a
    // BACK AT time in the past reads worse than none at all.
    status: {
      ...previous,
      until: previous.until !== null && previous.until <= now ? null : previous.until
    }
  }
}
