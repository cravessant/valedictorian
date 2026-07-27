/**
 * Representation boundary proof for the shared lifecycle admission seam (issue #389).
 *
 *  1. BOUNDARY — each fixed-purpose constructor accepts the existing lower/upper bound
 *     and rejects just outside it with the SAME code and message the aggregate
 *     published before consolidation, through that aggregate's OWN error class.
 *  2. TYPE BOUNDARY — a raw string or raw actor is NOT assignable to a narrowed port,
 *     while an admitted value is. Asserted with a compile-time assignability table
 *     (this repository uses no `@ts-expect-error`, so no suppression is introduced).
 *  3. PROVENANCE — the trusted actor type has exactly one constructor; nothing casts
 *     into it, and internally originated audit writers keep a separate envelope.
 *
 * Cross-aggregate production consumption is proved behaviourally in
 * `lifecycle-representation.consumption.pglite.test.ts` and by the aggregate suites.
 */
import { describe, expect, it } from 'vitest'
import {
  type BoundedJson,
  LIFECYCLE_AUDIT_MAX,
  LIFECYCLE_ID_MAX,
  LIFECYCLE_SNAPSHOT_MAX,
  actorAuditJson,
  admitBoundedJson,
  admitCommandActor,
  admitLifecycleId,
  containsSensitiveJsonKey,
  owning,
} from './lifecycle-representation'
import * as typeBoundary from './lifecycle-representation.type-boundary'
import * as jobSeam from '../job/job.validation'
import * as opportunitySeam from '../opportunity/opportunity.validation'
import * as applicationSeam from '../applications/application.aggregate.validation'

const seams = [
  { name: 'job', seam: jobSeam, errorName: 'JobInputError', error: jobSeam.JobInputError },
  { name: 'opportunity', seam: opportunitySeam, errorName: 'OpportunityInputError', error: opportunitySeam.OpportunityInputError },
  { name: 'application', seam: applicationSeam, errorName: 'ApplicationInputError', error: applicationSeam.ApplicationInputError },
] as const

function thrown(run: () => unknown): { code: string; message: string; name: string; instance: unknown } {
  try {
    run()
  } catch (error) {
    const typed = error as Error & { code: string }
    return { code: typed.code, message: typed.message, name: typed.name, instance: error }
  }
  throw new Error('expected the constructor to reject')
}

describe('lifecycle id admission', () => {
  for (const { name, seam, errorName, error } of seams) {
    it(`${name} admits 1..${LIFECYCLE_ID_MAX} and rejects just outside it`, () => {
      expect(seam.requireId('a', 'workspaceId')).toBe('a')
      expect(seam.requireId(`  ${'x'.repeat(LIFECYCLE_ID_MAX)}  `, 'workspaceId')).toBe('x'.repeat(LIFECYCLE_ID_MAX))

      const over = thrown(() => seam.requireId('x'.repeat(LIFECYCLE_ID_MAX + 1), 'workspaceId'))
      expect(over.code).toBe('bounded_data_violation')
      expect(over.message).toBe(`workspaceId exceeds ${LIFECYCLE_ID_MAX} characters`)
      expect(over.name).toBe(errorName)
      expect(over.instance).toBeInstanceOf(error)

      expect(thrown(() => seam.requireId('   ', 'workspaceId')).message).toBe('workspaceId must not be empty')
      expect(thrown(() => seam.requireId(7, 'workspaceId')).message).toBe('workspaceId must be a string')
    })
  }
})

describe('bounded JSON admission', () => {
  for (const { name, seam } of seams) {
    it(`${name} bounds serialized JSON at the caller's own limit`, () => {
      const exact = JSON.stringify({ a: 'b' })
      expect(seam.boundedJson({ a: 'b' }, 'payload', exact.length)).toBe(exact)
      const over = thrown(() => seam.boundedJson({ a: 'b' }, 'payload', exact.length - 1))
      expect(over.code).toBe('bounded_data_violation')
      expect(over.message).toBe(`payload exceeds ${exact.length - 1} bytes`)
    })

    it(`${name} rejects sensitive JSON keys identically`, () => {
      for (const key of ['authorization', 'access_token', 'apiKey', 'X-Auth-Token', 'clientSecret', 'privateKey']) {
        const rejected = thrown(() => seam.boundedJson({ [key]: 'v' }, 'payload', LIFECYCLE_AUDIT_MAX))
        expect(rejected.code).toBe('security_violation')
        expect(rejected.message).toBe('payload contains a forbidden sensitive key')
      }
      // The denylist is deliberately SUBSTRING-based (stricter than the SDK's exact-key rule).
      expect(thrown(() => seam.boundedJson({ tokenizer: 'v' }, 'payload', LIFECYCLE_AUDIT_MAX)).code).toBe('security_violation')
      expect(seam.boundedJson({ company: 'Acme' }, 'payload', LIFECYCLE_AUDIT_MAX)).toBe('{"company":"Acme"}')
    })

    it(`${name} reports an unserializable payload as invalid input`, () => {
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      const rejected = thrown(() => seam.boundedJson(cyclic as never, 'payload', LIFECYCLE_AUDIT_MAX))
      expect(rejected.code).toBe('invalid_input')
      expect(rejected.message).toBe('payload is not serializable JSON')
    })
  }

  it('exposes the same sensitive-key predicate the non-throwing sanitizers use', () => {
    expect(containsSensitiveJsonKey('{"access_token":"x"}')).toBe(true)
    expect(containsSensitiveJsonKey('{"company":"Acme"}')).toBe(false)
  })
})

describe('command actor admission', () => {
  for (const { name, seam, errorName } of seams) {
    it(`${name} admits a command actor and rejects an out-of-vocabulary type`, () => {
      expect(seam.requireActor({ type: 'user', id: ' u-1 ' })).toEqual({ type: 'user', id: 'u-1' })
      const badType = thrown(() => seam.requireActor({ type: 'robot' }))
      expect(badType.code).toBe('invalid_input')
      expect(badType.message).toBe('actor.type is invalid')
      expect(badType.name).toBe(errorName)
      expect(thrown(() => seam.requireActor(null)).message).toBe('actor is required')
    })

    it(`${name} bounds actor.id at the lifecycle id limit`, () => {
      expect(seam.requireActor({ type: 'agent', id: 'x'.repeat(LIFECYCLE_ID_MAX) }).id).toBe('x'.repeat(LIFECYCLE_ID_MAX))
      const over = thrown(() => seam.requireActor({ type: 'agent', id: 'x'.repeat(LIFECYCLE_ID_MAX + 1) }))
      expect(over.code).toBe('bounded_data_violation')
      expect(over.message).toBe(`actor.id exceeds ${LIFECYCLE_ID_MAX} characters`)
    })

    it(`${name} returns a detached, immutable actor`, () => {
      const source = { type: 'user' as const, id: 'u-1' }
      const admitted = seam.requireActor(source)
      expect(Object.isFrozen(admitted)).toBe(true)
      expect(admitted).not.toBe(source)
    })
  }

  it('keeps the app nullable actor-id semantics the SDK external actor does not have', () => {
    expect(jobSeam.requireActor({ type: 'system' })).toEqual({ type: 'system', id: null })
    expect(jobSeam.requireActor({ type: 'agent', id: null })).toEqual({ type: 'agent', id: null })
    expect(actorAuditJson(jobSeam.requireActor({ type: 'system' }))).toBe('{"actor":{"type":"system","id":null}}')
  })

  it('bounds every actor id it will serialize — a system type is no exemption', () => {
    // Regression: an internal-looking actor must not smuggle an unbounded id into audit_json.
    for (const type of ['user', 'agent', 'system'] as const) {
      expect(thrown(() => admitCommandActor({ type, id: 'x'.repeat(LIFECYCLE_ID_MAX + 1) })).code)
        .toBe('bounded_data_violation')
    }
  })

  it('rejects an actor whose id would violate the audit_json sensitive-key CHECK', () => {
    expect(admitCommandActor({ type: 'user', id: 'u-1' }).id).toBe('u-1')
    expect(actorAuditJson(admitCommandActor({ type: 'user', id: 'u-1' }))).toBe('{"actor":{"type":"user","id":"u-1"}}')
  })
})

describe('trusted-value type boundary', () => {
  // The assignability table lives in typechecked source (test files are excluded from
  // tsconfig), so `pnpm typecheck` — not this assertion — is what enforces it.
  it('refuses raw strings and raw actors where an admitted value is required', () => {
    expect([
      typeBoundary.rawStringIntoIdPort,
      typeBoundary.rawStringIntoSnapshotPort,
      typeBoundary.rawActorIntoAuditPort,
      typeBoundary.auditJsonIntoSnapshotPort,
    ]).toEqual([false, false, false, false])
  })

  it('lets an admitted value flow into the plain-string sinks it already satisfied', () => {
    expect([typeBoundary.admittedIdIntoStringSink, typeBoundary.admittedJsonIntoStringSink]).toEqual([true, true])
  })

  it('keeps the admitted bound attached to the value', () => {
    const audit: BoundedJson<typeof LIFECYCLE_AUDIT_MAX> = admitBoundedJson({ a: 1 }, 'audit', LIFECYCLE_AUDIT_MAX)
    const snapshot: BoundedJson<typeof LIFECYCLE_SNAPSHOT_MAX> = admitBoundedJson({ a: 1 }, 'snapshot', LIFECYCLE_SNAPSHOT_MAX)
    expect([audit, snapshot]).toEqual(['{"a":1}', '{"a":1}'])
  })
})

describe('actor provenance stays distinct', () => {
  it('offers exactly one constructor for the trusted command actor', () => {
    // There is no `systemActor`-style constructor that casts unchecked data into the
    // brand: internal audit writers use their own envelope (see the boundary matrix).
    const seam = jobSeam as Record<string, unknown>
    for (const absent of ['systemActor', 'synthesizeSystemActor', 'readRecordedActor']) {
      expect(absent in seam).toBe(false)
    }
  })

  it('serializes the command-actor envelope, not the internal-origin envelope', () => {
    // Capture materialization / initial Company assignment persist `{id,type}` into
    // their own columns; the lifecycle audit envelope is `{actor:{type,id}}` and stays separate.
    expect(actorAuditJson(admitCommandActor({ type: 'agent', id: 'a-1' }))).toBe('{"actor":{"type":"agent","id":"a-1"}}')
    expect(JSON.stringify({ id: 'capture-materializer', type: 'system' })).not.toContain('"actor"')
  })
})

describe('owning translation', () => {
  it('reports a narrow representation failure through the supplied error class', () => {
    class OwnerError extends Error {
      constructor(readonly code: string, message: string) {
        super(message)
        this.name = 'OwnerError'
      }
    }
    const admit = owning(admitLifecycleId, OwnerError)
    const rejected = thrown(() => admit('x'.repeat(LIFECYCLE_ID_MAX + 1), 'f'))
    expect(rejected.instance).toBeInstanceOf(OwnerError)
    expect(rejected.code).toBe('bounded_data_violation')
  })

  it('preserves a bound-carrying generic signature through the rebinding', () => {
    const admit = owning(admitBoundedJson, jobSeam.JobInputError)
    const bounded: BoundedJson<typeof LIFECYCLE_SNAPSHOT_MAX> = admit({ a: 1 }, 'snapshot', LIFECYCLE_SNAPSHOT_MAX)
    expect(bounded).toBe('{"a":1}')
  })

  it('lets a non-representation error pass through untouched', () => {
    const boom = new RangeError('unrelated')
    const admit = owning((() => { throw boom }) as () => never, jobSeam.JobInputError)
    expect(() => admit()).toThrow(boom)
  })
})

describe('preserved app/SDK disagreements', () => {
  it('keeps the Job external-identity value bound at the app 2,048, not the SDK 2,000', () => {
    expect(jobSeam.requireText('x'.repeat(2_048), 'identity.value', 1, 2_048)).toHaveLength(2_048)
    expect(thrown(() => jobSeam.requireText('x'.repeat(2_049), 'identity.value', 1, 2_048)).code).toBe('bounded_data_violation')
  })

  it('keeps Application links as trimmed bounded text, not HTTP(S) URLs', () => {
    expect(applicationSeam.LINK_URL_MAX).toBe(4_096)
    expect(applicationSeam.requireText('mailto:careers@acme.test', 'link.url', 1, applicationSeam.LINK_URL_MAX)).toBe('mailto:careers@acme.test')
    expect(applicationSeam.requireText('/local/path', 'link.url', 1, applicationSeam.LINK_URL_MAX)).toBe('/local/path')
  })

  it('keeps the Opportunity override rationale bound at the app 2,000, not the SDK 1,000', () => {
    expect(opportunitySeam.RATIONALE_MAX).toBe(2_000)
    expect(opportunitySeam.requireText('x'.repeat(2_000), 'rationale', 1, opportunitySeam.RATIONALE_MAX)).toHaveLength(2_000)
  })

  it('leaves instant strings as bounded text rather than offset ISO datetimes', () => {
    expect(applicationSeam.TIMESTAMP_MAX).toBe(100)
    expect(jobSeam.requireText('whenever', 'observedAt', 1, 100)).toBe('whenever')
  })
})

describe('aggregate-owned rules stay in the owning module', () => {
  it('keeps free text, vocabularies, ranks and cardinality out of the shared seam', () => {
    expect('optionalRank' in jobSeam).toBe(false)
    expect('optionalRank' in applicationSeam).toBe(false)
    expect('requireOneOf' in jobSeam).toBe(false)
    expect(opportunitySeam.optionalRank(1_000_000, 'rank')).toBe(1_000_000)
    expect(thrown(() => opportunitySeam.optionalRank(1_000_001, 'rank')).code).toBe('bounded_data_violation')
    expect('LINKS_LIMIT' in opportunitySeam).toBe(false)
    expect(applicationSeam.LINKS_LIMIT).toBe(100)
  })

  it('gives each aggregate its own free-text constructor and error identity', () => {
    expect(jobSeam.requireText).not.toBe(opportunitySeam.requireText)
    expect(thrown(() => jobSeam.requireText('', 'f', 1, 5)).name).toBe('JobInputError')
    expect(thrown(() => applicationSeam.requireText('', 'f', 1, 5)).name).toBe('ApplicationInputError')
  })

  it('agrees on the lifecycle id and audit bounds the schema CHECKs encode', () => {
    expect(LIFECYCLE_ID_MAX).toBe(200)
    expect(LIFECYCLE_AUDIT_MAX).toBe(16_384)
    expect(LIFECYCLE_SNAPSHOT_MAX).toBe(262_144)
    for (const { seam } of seams) {
      expect(seam.WORKSPACE_MAX).toBe(LIFECYCLE_ID_MAX)
      expect(seam.AUDIT_MAX).toBe(LIFECYCLE_AUDIT_MAX)
      expect(seam.SNAPSHOT_MAX).toBe(LIFECYCLE_SNAPSHOT_MAX)
    }
  })
})
