/**
 * Lifecycle mutation-result serializer proofs (issue #304, stage 3) — pure.
 *
 * Proves the generic `succeeded`/`blocked` mappers produce output that a concrete
 * aggregate schema (`captureMutationResultSchema`, strict) accepts, that the audit
 * envelope surfaces the contract actor (null-id actor -> type as identity) and
 * carries optional revision extras, and that `classifyMutationFailure` routes
 * existence/concurrency codes to typed HTTP errors while every lifecycle blocker
 * code (including deterministic_duplicate) becomes a 200 `blocked` body.
 */
import { describe, expect, it } from 'vitest'
import { captureMutationResultSchema, lifecycleBlockerCodes } from '@sparxie/sdk'
import { toCaptureResource, type CaptureHeadRow } from '@sparxie/valedictorian-local-runtime/testing/modules/capture/capture.dto'
import {
  classifyMutationFailure,
  toBlockedMutationResult,
  toSucceededMutationResult,
} from '@sparxie/valedictorian-local-runtime/testing/modules/lifecycle/mutation.dto'

const head: CaptureHeadRow = {
  id: 'cap-1',
  workspaceId: 'ws-a',
  evidenceMode: 'reported',
  adapterId: 'jobright.resolver',
  adapterKind: 'connector',
  adapterVersion: '1.4.0',
  observedAt: '2026-07-20T00:00:00.000Z',
  receivedAt: '2026-07-20T00:00:01.000Z',
  providerRecordId: 'prov-9',
  providerSchema: 'v2',
  payloadJson: JSON.stringify({ title: 'Staff Engineer' }),
  revision: 2,
  createdAt: '2026-07-20T00:00:01.000Z',
  updatedAt: '2026-07-20T00:00:09.000Z',
  removedAt: null,
}

describe('toSucceededMutationResult', () => {
  it('wraps the resource in a schema-valid succeeded body with a minimal audit', () => {
    const resource = toCaptureResource(head, [])
    const result = toSucceededMutationResult(resource, {
      actor: { type: 'user', id: 'u-1', displayName: 'Kai' },
      timestamp: '2026-07-20T00:00:09.000Z',
    })
    expect(() => captureMutationResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe('succeeded')
    expect(result.duplicateResolution).toBeNull()
    expect(result.audit).toEqual({
      actor: { id: 'u-1', type: 'user', displayName: 'Kai' },
      timestamp: '2026-07-20T00:00:09.000Z',
    })
  })

  it('surfaces a null-id actor type as identity and carries revision + duplicate extras', () => {
    const resource = toCaptureResource(head, [])
    const result = toSucceededMutationResult(resource, {
      actor: { type: 'system' },
      timestamp: '2026-07-20T00:00:09.000Z',
      // Contract quirk (#304): on a succeeded mutation the applied duplicate
      // target must equal the surviving resource id, since attach/merge collapse
      // the duplicate onto the returned resource.
      duplicateResolution: { action: 'attach', targetResourceId: 'cap-1' },
      audit: { priorRevision: 1, newRevision: 2 },
    })
    expect(() => captureMutationResultSchema.parse(result)).not.toThrow()
    // Null actor id -> the actor type is the identity (ratified #304).
    expect(result.audit.actor).toEqual({ id: 'system', type: 'system' })
    expect(result.audit).toMatchObject({ priorRevision: 1, newRevision: 2 })
    expect(result.duplicateResolution).toEqual({ action: 'attach', targetResourceId: 'cap-1' })
  })
})

describe('toBlockedMutationResult', () => {
  it('emits a schema-valid blocked body carrying the lifecycle blocker', () => {
    const result = toBlockedMutationResult({
      code: 'bounded_data_violation',
      message: 'payload exceeds the capture bound',
      field: 'payload',
    })
    expect(() => captureMutationResultSchema.parse(result)).not.toThrow()
    expect(result).toMatchObject({
      status: 'blocked',
      blocker: { code: 'bounded_data_violation', message: 'payload exceeds the capture bound', field: 'payload' },
    })
  })
})

describe('classifyMutationFailure', () => {
  it('routes existence and concurrency codes to typed HTTP errors', () => {
    expect(classifyMutationFailure('not_found')).toEqual({ surface: 'error', status: 404, code: 'not_found' })
    expect(classifyMutationFailure('revision_conflict')).toEqual({
      surface: 'error',
      status: 409,
      code: 'revision_conflict',
    })
    expect(classifyMutationFailure('evidence_mode_conflict')).toEqual({
      surface: 'error',
      status: 409,
      code: 'evidence_mode_conflict',
    })
  })

  it('routes every lifecycle blocker code to a 200 blocked body', () => {
    for (const code of lifecycleBlockerCodes) {
      expect(classifyMutationFailure(code)).toEqual({ surface: 'blocked', code })
    }
  })

  it('conservatively surfaces an unknown code as a 400 error, never an unrepresentable blocker', () => {
    expect(classifyMutationFailure('teapot')).toEqual({ surface: 'error', status: 400, code: 'teapot' })
  })
})
