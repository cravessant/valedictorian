import { describe, expect, it } from 'vitest'
import {
  occurrenceOutcomeForRunStatus,
} from './connector-schedule.occurrence-outcome'

describe('occurrenceOutcomeForRunStatus', () => {
  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
    ['skipped', 'skipped'],
    ['queued', 'admitted'],
    ['running', 'admitted'],
  ] as const)('maps run status %s to occurrence outcome %s', (status, outcome) => {
    expect(occurrenceOutcomeForRunStatus(status)).toBe(outcome)
  })
})
