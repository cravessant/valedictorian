/**
 * Lifecycle removal/restore result serializer proofs (issue #304, stage 3).
 *
 * Pure. Proves the domain -> sparxie RemovalResult/RestoreResult mapping conforms
 * to the strict schemas: a tombstone's affected-dependent set (cascaded minus the
 * target, plus unlinked severables), the dependents-present block
 * (impossible_state + dependentIds + the three non-reject choices), the
 * target-only restore (every reported dependent remained_tombstoned), and the
 * failure -> HTTP-surface classification (blocked 200 vs 404 vs 4xx error).
 */
import { describe, expect, it } from 'vitest'
import { removalResultSchema, restoreResultSchema } from '@sparxie/sdk'
import type { RemoveLifecycleResult, RestoreLifecycleResult } from './removal.orchestration'
import {
  DEPENDENT_RESOLUTION_CHOICES,
  classifyRemovalFailure,
  toBlockedRemovalResult,
  toRemovedResult,
  toRestoredResult,
} from './removal.dto'

const actor = { id: 'u-1', type: 'user' as const }

describe('toRemovedResult', () => {
  it('reports cascaded-minus-target tombstones plus unlinked severables', () => {
    const domain: Extract<RemoveLifecycleResult, { ok: true }> = {
      ok: true,
      aggregate: 'capture',
      resourceId: 'cap-1',
      choice: 'cascade_tombstone',
      tombstoned: [
        { aggregate: 'capture', id: 'cap-1' },
        { aggregate: 'job', id: 'job-2' },
        { aggregate: 'opportunity', id: 'opp-3' },
      ],
      unlinked: [{ aggregate: 'job', id: 'job-9' }],
    }
    const result = toRemovedResult(domain, { removedAt: '2026-07-20T00:00:05.000Z', actor })
    expect(() => removalResultSchema.parse(result)).not.toThrow()
    expect(result).toMatchObject({ status: 'removed', id: 'cap-1', choice: 'cascade_tombstone' })
    // The target itself is excluded from the affected-dependent set.
    expect(result.status === 'removed' && result.affectedDependentIds).toEqual(['job-2', 'opp-3', 'job-9'])
    expect(result.status === 'removed' && result.audit.actor).toEqual({ id: 'u-1', type: 'user' })
  })
})

describe('toBlockedRemovalResult', () => {
  it('emits impossible_state with dependentIds and the three non-reject choices', () => {
    const result = toBlockedRemovalResult({
      id: 'cap-1',
      message: 'capture has active dependents; choose another removal strategy',
      dependentIds: ['job-2', 'job-3'],
    })
    expect(() => removalResultSchema.parse(result)).not.toThrow()
    expect(result).toMatchObject({ status: 'blocked', id: 'cap-1' })
    expect(result.status === 'blocked' && result.blocker.code).toBe('impossible_state')
    expect(result.status === 'blocked' && result.dependentIds).toEqual(['job-2', 'job-3'])
    expect(result.status === 'blocked' && result.supportedChoices).toEqual(DEPENDENT_RESOLUTION_CHOICES)
    expect(DEPENDENT_RESOLUTION_CHOICES).not.toContain('reject_if_dependents')
  })
})

describe('toRestoredResult', () => {
  it('maps every still-tombstoned dependent to remained_tombstoned', () => {
    const domain: Extract<RestoreLifecycleResult, { ok: true }> = {
      ok: true,
      aggregate: 'job',
      resourceId: 'job-1',
      restored: { aggregate: 'job', id: 'job-1' },
      remainedTombstoned: [{ aggregate: 'opportunity', id: 'opp-2' }],
    }
    const result = toRestoredResult(domain, { restoredAt: '2026-07-20T00:00:06.000Z', actor })
    expect(() => restoreResultSchema.parse(result)).not.toThrow()
    expect(result).toMatchObject({ status: 'restored', id: 'job-1', restoredAt: '2026-07-20T00:00:06.000Z' })
    expect(result.status === 'restored' && result.dependentLinks).toEqual([
      { dependentId: 'opp-2', state: 'remained_tombstoned' },
    ])
  })
})

describe('classifyRemovalFailure', () => {
  it('routes dependents blocks to a 200 blocked body, not_found to 404, others to typed HTTP errors', () => {
    expect(classifyRemovalFailure({ ok: false, code: 'dependents_present', message: 'x' })).toEqual({ surface: 'blocked' })
    expect(classifyRemovalFailure({ ok: false, code: 'dependent_choice_required', message: 'x' })).toEqual({ surface: 'blocked' })
    expect(classifyRemovalFailure({ ok: false, code: 'not_found', message: 'x' })).toEqual({ surface: 'not_found' })
    expect(classifyRemovalFailure({ ok: false, code: 'revision_conflict', message: 'x' })).toMatchObject({ surface: 'error', status: 409 })
    expect(classifyRemovalFailure({ ok: false, code: 'invalid_input', message: 'x' })).toMatchObject({ surface: 'error', status: 400 })
    expect(classifyRemovalFailure({ ok: false, code: 'bounded_data_violation', message: 'x' })).toMatchObject({ surface: 'error', status: 400 })
  })
})
