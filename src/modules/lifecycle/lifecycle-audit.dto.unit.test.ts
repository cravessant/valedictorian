/**
 * Shared lifecycle audit/actor/blocker serializer proofs (issue #304, stage 3).
 *
 * Pure. Proves the ratified null-id actor convention (type-as-id), that stored
 * audit JSON round-trips into the strict `lifecycleAuditEvidenceSchema`, and that
 * blockers assemble against `lifecycleBlockerSchema` omitting absent optionals.
 */
import { describe, expect, it } from 'vitest'
import { lifecycleActorSchema, lifecycleAuditEvidenceSchema, lifecycleBlockerSchema } from '@sparxie/sdk'
import {
  toContractActor,
  toLifecycleAudit,
  toLifecycleAuditFromJson,
  toLifecycleBlocker,
} from '@sparxie/valedictorian-local-runtime/testing/modules/lifecycle/lifecycle-audit.dto'

describe('toContractActor', () => {
  it('surfaces the actor type as the id when none was recorded (ratified convention)', () => {
    const actor = toContractActor({ type: 'system', id: null })
    expect(() => lifecycleActorSchema.parse(actor)).not.toThrow()
    expect(actor).toEqual({ id: 'system', type: 'system' })
    expect(toContractActor({ type: 'agent' })).toEqual({ id: 'agent', type: 'agent' })
  })

  it('preserves a recorded id + displayName and defaults malformed actors to system', () => {
    expect(toContractActor({ type: 'user', id: 'u-1', displayName: 'Ada' })).toEqual({
      id: 'u-1',
      type: 'user',
      displayName: 'Ada',
    })
    expect(toContractActor(null)).toEqual({ id: 'system', type: 'system' })
    expect(toContractActor({ type: 'root' })).toEqual({ id: 'system', type: 'system' })
  })
})

describe('lifecycle audit envelope', () => {
  it('builds a schema-valid audit from a live actor', () => {
    const audit = toLifecycleAudit({ type: 'user', id: 'u-1' }, '2026-07-20T00:00:01.000Z')
    expect(() => lifecycleAuditEvidenceSchema.parse(audit)).not.toThrow()
    expect(audit).toEqual({ actor: { id: 'u-1', type: 'user' }, timestamp: '2026-07-20T00:00:01.000Z' })
  })

  it('builds a schema-valid audit from stored JSON and tolerates malformed JSON', () => {
    const good = toLifecycleAuditFromJson('{"actor":{"type":"system","id":null}}', '2026-07-20T00:00:02.000Z')
    expect(() => lifecycleAuditEvidenceSchema.parse(good)).not.toThrow()
    expect(good.actor).toEqual({ id: 'system', type: 'system' })

    const broken = toLifecycleAuditFromJson('{not json', '2026-07-20T00:00:03.000Z')
    expect(() => lifecycleAuditEvidenceSchema.parse(broken)).not.toThrow()
    expect(broken.actor).toEqual({ id: 'system', type: 'system' })
  })
})

describe('toLifecycleBlocker', () => {
  it('assembles a minimal schema-valid blocker', () => {
    const blocker = toLifecycleBlocker({ code: 'impossible_state', message: 'has active dependents' })
    expect(() => lifecycleBlockerSchema.parse(blocker)).not.toThrow()
    expect(blocker).toEqual({ code: 'impossible_state', message: 'has active dependents' })
  })

  it('includes present optionals and omits absent ones', () => {
    // The contract binds allowedDuplicateResolutions to the deterministic_duplicate code.
    const duplicate = toLifecycleBlocker({
      code: 'deterministic_duplicate',
      message: 'duplicate provenance',
      conflictingResourceId: 'job-9',
      allowedDuplicateResolutions: ['attach', 'merge'],
    })
    expect(() => lifecycleBlockerSchema.parse(duplicate)).not.toThrow()
    expect(duplicate.conflictingResourceId).toBe('job-9')
    expect(duplicate.allowedDuplicateResolutions).toEqual(['attach', 'merge'])
    expect('field' in duplicate).toBe(false)

    const minimal = toLifecycleBlocker({ code: 'workspace_ownership', message: 'not your workspace' })
    expect(() => lifecycleBlockerSchema.parse(minimal)).not.toThrow()
    expect('conflictingResourceId' in minimal).toBe(false)
    expect('allowedDuplicateResolutions' in minimal).toBe(false)
  })
})
