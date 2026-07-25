/**
 * Job DTO serializer proofs (issue #304, stage 3) — pure, no database.
 *
 * Proves the domain -> sparxie `Job` flattening conforms to `jobSchema` exactly
 * (strict), that active identities/evidence references order by (createdAt,id),
 * that history reconstruction replays facts/availability/tombstone/revisions from
 * the ordered payloads and derives point-in-time identities from their table
 * timestamps, and that the keyset cursor encode/decode is total and drives
 * `JobListResult.nextCursor` only when a further page exists.
 */
import { describe, expect, it } from 'vitest'
import { jobHistoryResultSchema, jobListResultSchema, jobSchema } from '@sparxie/sdk'
import {
  decodeJobCursor,
  encodeJobCursor,
  reconstructJobHistory,
  toJobListResult,
  toJobResource,
  type JobEvidenceRefRow,
  type JobHeadRow,
  type JobHistoryRow,
  type JobIdentityRow,
} from './job.dto'

const facts = {
  companyName: 'Acme',
  roleTitle: 'Staff Engineer',
  sourceName: 'LinkedIn',
  roleKind: 'experienced' as const,
  term: null,
  terms: [],
  timingMode: 'unknown' as const,
  startDate: null,
  endDate: null,
  location: null,
  workMode: 'remote' as const,
  employmentType: 'full_time' as const,
  seniority: 'senior' as const,
  compensation: null,
  postedAt: null,
  destination: null,
}

const head: JobHeadRow = {
  id: '01890000-0000-7000-8000-000000000001',
  workspaceId: 'ws-a',
  factsRevision: 2,
  factsJson: JSON.stringify(facts),
  availabilityState: 'open',
  availabilityObservedAt: '2026-07-20T00:00:03.000Z',
  availabilityRevision: 2,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:03.000Z',
  removedAt: null,
}

const identityRow = (over: Partial<JobIdentityRow> = {}): JobIdentityRow => ({
  id: 'ident-1',
  kind: 'ats_job',
  provider: 'greenhouse',
  account: 'acme',
  value: 'req-42',
  strength: 'strong',
  createdAt: '2026-07-20T00:00:01.000Z',
  removedAt: null,
  ...over,
})

const evidenceRow = (over: Partial<JobEvidenceRefRow> = {}): JobEvidenceRefRow => ({
  id: 'ref-1',
  captureId: 'cap-1',
  captureRevision: 1,
  evidenceIndexesJson: '[0,2]',
  createdAt: '2026-07-20T00:00:01.000Z',
  ...over,
})

describe('toJobResource', () => {
  it('flattens the head row + active identities/evidence into a schema-valid Job', () => {
    const dto = toJobResource(head, [identityRow()], [evidenceRow()])
    expect(() => jobSchema.parse(dto)).not.toThrow()
    expect(dto.facts).toEqual(facts)
    expect(dto.availability).toEqual({ state: 'open', observedAt: '2026-07-20T00:00:03.000Z' })
    expect(dto.externalIdentities).toEqual([
      { kind: 'ats_job', provider: 'greenhouse', account: 'acme', value: 'req-42', strength: 'strong' },
    ])
    expect(dto.captureEvidenceReferences).toEqual([
      { captureId: 'cap-1', captureRevision: 1, evidenceIndexes: [0, 2] },
    ])
  })

  it('orders identities and evidence references by (createdAt, id)', () => {
    const dto = toJobResource(
      head,
      [
        identityRow({ id: 'ident-b', value: 'later', createdAt: '2026-07-20T00:00:05.000Z' }),
        identityRow({ id: 'ident-a', value: 'earlier', createdAt: '2026-07-20T00:00:01.000Z' }),
      ],
      [
        evidenceRow({ id: 'ref-b', captureId: 'cap-2', createdAt: '2026-07-20T00:00:05.000Z' }),
        evidenceRow({ id: 'ref-a', captureId: 'cap-1', createdAt: '2026-07-20T00:00:01.000Z' }),
      ],
    )
    expect(dto.externalIdentities.map((identity) => identity.value)).toEqual(['earlier', 'later'])
    expect(dto.captureEvidenceReferences.map((reference) => reference.captureId)).toEqual(['cap-1', 'cap-2'])
  })

  it('omits a URL-only V2 destination from the V1 resource without changing its stored facts', () => {
    const v2Facts = {
      ...facts,
      destination: { url: 'https://careers.acme.com/jobs/url-only-v2' },
    }
    const v2Head = { ...head, factsJson: JSON.stringify(v2Facts) }

    const dto = toJobResource(v2Head, [], [evidenceRow()])

    expect(() => jobSchema.parse(dto)).not.toThrow()
    expect(dto.facts.destination).toBeNull()
    expect(JSON.parse(v2Head.factsJson).destination).toEqual(v2Facts.destination)
  })
})

describe('reconstructJobHistory', () => {
  it('replays facts/availability/tombstone/revisions and derives point-in-time identities', () => {
    const correctedFacts = { ...facts, roleTitle: 'Principal Engineer' }
    const history: JobHistoryRow[] = [
      { sequence: 1, kind: 'created', snapshotJson: JSON.stringify(facts), auditJson: '{"actor":{"type":"system"}}', createdAt: '2026-07-20T00:00:00.000Z' },
      { sequence: 2, kind: 'identity_added', snapshotJson: '{"kind":"ats_job","value":"req-42"}', auditJson: '{"actor":{"type":"agent","id":"a"}}', createdAt: '2026-07-20T00:00:01.000Z' },
      { sequence: 3, kind: 'facts_corrected', snapshotJson: JSON.stringify(correctedFacts), auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:02.000Z' },
      { sequence: 4, kind: 'availability_changed', snapshotJson: '{"state":"closed","observedAt":"2026-07-20T00:00:03.000Z"}', auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:03.000Z' },
      { sequence: 5, kind: 'removed', snapshotJson: '{"kind":"removed","priorFactsRevision":2}', auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:04.000Z' },
      { sequence: 6, kind: 'restored', snapshotJson: '{"kind":"restored","priorFactsRevision":2}', auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:05.000Z' },
    ]
    // Identity created at seq 2's timestamp, never removed.
    const identities = [identityRow({ createdAt: '2026-07-20T00:00:01.000Z' })]
    // Founding capture lineage exists from creation (jobSchema requires >=1 ref).
    const evidenceRefs = [evidenceRow({ createdAt: '2026-07-20T00:00:00.000Z' })]

    const result = reconstructJobHistory(head, history, identities, evidenceRefs, { limit: 50 })
    expect(() => jobHistoryResultSchema.parse(result)).not.toThrow()
    expect(result.items.map((item) => item.kind)).toEqual([
      'created', 'identity_added', 'facts_corrected', 'availability_changed', 'removed', 'restored',
    ])
    // At seq 1 the identity did not yet exist; at seq 2 it does.
    expect(result.items[0]!.snapshot.externalIdentities).toEqual([])
    expect(result.items[1]!.snapshot.externalIdentities).toHaveLength(1)
    // Facts version bumps at the correction; availability at the change.
    expect(result.items[0]!.snapshot.factsRevision).toBe(1)
    expect(result.items[2]!.snapshot.factsRevision).toBe(2)
    expect(result.items[2]!.snapshot.facts.roleTitle).toBe('Principal Engineer')
    expect(result.items[3]!.snapshot.availability).toEqual({ state: 'closed', observedAt: '2026-07-20T00:00:03.000Z' })
    expect(result.items[3]!.snapshot.availabilityRevision).toBe(2)
    // Tombstone toggles on remove/restore.
    expect(result.items[4]!.snapshot.removedAt).toBe('2026-07-20T00:00:04.000Z')
    expect(result.items[5]!.snapshot.removedAt).toBeNull()
  })

  it('windows the reconstructed page by the after-sequence cursor', () => {
    const history: JobHistoryRow[] = [1, 2, 3].map((sequence) => ({
      sequence,
      kind: sequence === 1 ? 'created' : 'facts_corrected',
      snapshotJson: JSON.stringify(facts),
      auditJson: '{"actor":{"type":"system"}}',
      createdAt: `2026-07-20T00:00:0${sequence}.000Z`,
    }))
    const page = reconstructJobHistory(head, history, [], [], { limit: 1 })
    expect(page.items.map((item) => item.sequence)).toEqual([1])
    expect(page.nextCursor).toBe('1')
    const next = reconstructJobHistory(head, history, [], [], { limit: 5, afterSequence: 1 })
    expect(next.items.map((item) => item.sequence)).toEqual([2, 3])
    expect(next.nextCursor).toBeNull()
  })

  it('projects URL-only V2 facts in every reconstructed V1 history snapshot', () => {
    const v2Facts = {
      ...facts,
      destination: { url: 'https://careers.acme.com/jobs/url-only-history' },
    }
    const result = reconstructJobHistory(
      { ...head, factsJson: JSON.stringify(v2Facts) },
      [{
        sequence: 1,
        kind: 'created',
        snapshotJson: JSON.stringify(v2Facts),
        auditJson: '{"actor":{"type":"system"}}',
        createdAt: head.createdAt,
      }],
      [],
      [evidenceRow({ createdAt: head.createdAt })],
      { limit: 50 },
    )

    expect(() => jobHistoryResultSchema.parse(result)).not.toThrow()
    expect(result.items[0]?.snapshot.facts.destination).toBeNull()
  })
})

describe('job list cursor + result', () => {
  it('round-trips the keyset cursor and rejects garbage', () => {
    const cursor = { createdAt: '2026-07-20T00:00:00.000Z', id: head.id }
    expect(decodeJobCursor(encodeJobCursor(cursor))).toEqual(cursor)
    expect(decodeJobCursor('not-base64!!')).toBeNull()
    expect(decodeJobCursor(Buffer.from('{}', 'utf8').toString('base64url'))).toBeNull()
  })

  it('drives nextCursor only when a further page exists', () => {
    const job = toJobResource(head, [], [evidenceRow()])
    expect(() => jobListResultSchema.parse(toJobListResult([job], 10, false))).not.toThrow()
    expect(toJobListResult([job], 10, false).nextCursor).toBeNull()
    expect(toJobListResult([job], 1, true).nextCursor).not.toBeNull()
  })
})
