/**
 * Application DTO serializer proofs (issue #304, stage 3) — pure, no database.
 *
 * Proves the domain -> sparxie `Application` flattening conforms to
 * `applicationSchema` exactly (strict), that the pursuit snapshot is DERIVED from the
 * stored `{ job: { facts, factsRevision }, capturedAt }` blob with schema-valid
 * defaults for placeholder facts and full pass-through for contract facts, that
 * `capturedAt` prefers the stored value and falls back to the head createdAt, that
 * attempt/event records serialize against their schemas, that history reconstruction
 * replays status/company/source/tombstone, and that the keyset cursor is total.
 */
import { describe, expect, it } from 'vitest'
import {
  applicationAttemptRecordSchema,
  applicationEventRecordSchema,
  applicationSchema,
  lifecycleApplicationHistoryResultSchema,
  lifecycleApplicationListResultSchema,
} from 'sparxie'
import {
  decodeApplicationCursor,
  deriveApplicationSnapshot,
  encodeApplicationCursor,
  reconstructApplicationHistory,
  toApplicationListResult,
  toApplicationResource,
  toAttemptRecord,
  toEventRecord,
  type ApplicationAttemptRow,
  type ApplicationEventRow,
  type ApplicationHeadRow,
  type ApplicationHistoryRow,
  type ApplicationLinkRow,
} from './application.dto'

const contractFacts = {
  companyName: 'Acme',
  roleTitle: 'Staff Engineer',
  sourceName: 'LinkedIn',
  roleKind: 'experienced',
  term: 'Fall 2026',
  terms: [{ season: 'fall', year: 2026 }],
  timingMode: 'fixed',
  startDate: '2026-09-01',
  endDate: '2027-05-01',
  location: { display: 'NYC', city: 'New York', region: 'NY', country: 'US' },
  workMode: 'hybrid',
  destination: { class: 'employer_or_ats', url: 'https://boards.greenhouse.io/acme/jobs/1' },
}

function head(over: Partial<ApplicationHeadRow> = {}): ApplicationHeadRow {
  return {
    id: '01890000-0000-7000-8000-0000000000a1',
    workspaceId: 'ws-a',
    opportunityId: '01890000-0000-7000-8000-0000000000b1',
    jobId: '01890000-0000-7000-8000-0000000000c1',
    revision: 2,
    status: 'submitted',
    jobFactsRevision: 3,
    snapshotJson: JSON.stringify({ job: { facts: contractFacts, factsRevision: 3 }, capturedAt: '2026-07-20T00:00:05.000Z', scores: null }),
    companyName: 'Acme',
    sourceName: 'LinkedIn',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:02.000Z',
    removedAt: null,
    ...over,
  }
}

const link: ApplicationLinkRow = {
  id: 'link-1',
  kind: 'application_portal',
  label: 'Portal',
  url: 'https://acme.example/apply',
  isPrimary: true,
  createdAt: '2026-07-20T00:00:01.000Z',
}

describe('deriveApplicationSnapshot', () => {
  it('passes contract job facts through and prefers the stored capturedAt', () => {
    const snapshot = deriveApplicationSnapshot(head())
    expect(snapshot).toMatchObject({
      jobFactsRevision: 3,
      capturedAt: '2026-07-20T00:00:05.000Z',
      companyName: 'Acme',
      roleTitle: 'Staff Engineer',
      roleKind: 'experienced',
      timingMode: 'fixed',
      workMode: 'hybrid',
      terms: [{ season: 'fall', year: 2026 }],
      location: { display: 'NYC', city: 'New York', region: 'NY', country: 'US' },
      initialDestination: { class: 'employer_or_ats', url: 'https://boards.greenhouse.io/acme/jobs/1' },
      initialLinks: [],
    })
  })

  it('yields a schema-valid snapshot from #300 placeholder facts via total defaults', () => {
    const placeholder = head({
      snapshotJson: JSON.stringify({ job: { facts: { source: 'feed', captureId: 'cap-1', evidenceMode: 'reported' }, factsRevision: 1 } }),
      jobFactsRevision: 1,
    })
    const dto = toApplicationResource(placeholder, [])
    expect(() => applicationSchema.parse(dto)).not.toThrow()
    expect(dto.snapshot).toMatchObject({
      jobFactsRevision: 1,
      roleTitle: 'Unknown',
      roleKind: 'other',
      timingMode: 'unknown',
      workMode: 'unknown',
      term: null,
      terms: [],
      location: null,
      initialDestination: null,
      // No stored capturedAt -> falls back to the head createdAt.
      capturedAt: '2026-07-20T00:00:00.000Z',
    })
    // companyName/sourceName default to the head columns, not the (absent) facts.
    expect(dto.snapshot.companyName).toBe('Acme')
  })
})

describe('toApplicationResource', () => {
  it('flattens the head + current links into a schema-valid Application', () => {
    const dto = toApplicationResource(head(), [link])
    expect(() => applicationSchema.parse(dto)).not.toThrow()
    expect(dto).toMatchObject({ status: 'submitted', companyName: 'Acme', sourceName: 'LinkedIn' })
    expect(dto.links).toEqual([{ kind: 'application_portal', label: 'Portal', url: 'https://acme.example/apply', id: 'link-1', isPrimary: true }])
  })
})

describe('toAttemptRecord / toEventRecord', () => {
  it('serializes attempt + event sidecar rows against their strict schemas', () => {
    const attemptRow: ApplicationAttemptRow = {
      id: 'att-1', workspaceId: 'ws-a', applicationId: head().id, state: 'succeeded',
      startedAt: '2026-07-20T00:00:01.000Z', completedAt: '2026-07-20T00:00:02.000Z', summary: 'auto-apply ok',
    }
    const attempt = toAttemptRecord(attemptRow)
    expect(() => applicationAttemptRecordSchema.parse(attempt)).not.toThrow()

    const eventRow: ApplicationEventRow = {
      id: 'evt-1', workspaceId: 'ws-a', applicationId: head().id, type: 'status_changed',
      occurredAt: '2026-07-20T00:00:03.000Z', actorId: 'u-1', actorType: 'user', actorDisplayName: 'Kai', summary: 'moved to submitted',
    }
    const event = toEventRecord(eventRow)
    expect(() => applicationEventRecordSchema.parse(event)).not.toThrow()
    expect(event.actor).toEqual({ id: 'u-1', type: 'user', displayName: 'Kai' })
  })
})

describe('reconstructApplicationHistory', () => {
  it('replays status/company/source/tombstone across schema-valid snapshots', () => {
    const history: ApplicationHistoryRow[] = [
      { revision: 1, kind: 'created', snapshotJson: JSON.stringify({ status: 'active', opportunityId: head().opportunityId, jobId: head().jobId }), auditJson: '{"actor":{"type":"system"}}', createdAt: '2026-07-20T00:00:00.000Z' },
      { revision: 2, kind: 'status_changed', snapshotJson: JSON.stringify({ status: 'submitted', priorStatus: 'active' }), auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:01.000Z' },
      { revision: 3, kind: 'company_edited', snapshotJson: JSON.stringify({ companyName: 'Acme Corp' }), auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:02.000Z' },
      { revision: 4, kind: 'removed', snapshotJson: JSON.stringify({ dependents: 'none' }), auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:03.000Z' },
      { revision: 5, kind: 'restored', snapshotJson: JSON.stringify({ kind: 'restored', priorRevision: 4 }), auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:04.000Z' },
    ]
    const result = reconstructApplicationHistory(head({ companyName: 'Acme Corp' }), history, [link], { limit: 50 })
    expect(() => lifecycleApplicationHistoryResultSchema.parse(result)).not.toThrow()
    expect(result.items.map((item) => item.kind)).toEqual(['created', 'status_changed', 'company_edited', 'removed', 'restored'])
    expect(result.items[1]!.snapshot.status).toBe('submitted')
    expect(result.items[2]!.snapshot.companyName).toBe('Acme Corp')
    expect(result.items[3]!.snapshot.removedAt).not.toBeNull()
    expect(result.items[4]!.snapshot.removedAt).toBeNull()
    for (const item of result.items) expect(item.snapshot.id).toBe(head().id)
  })
})

describe('application cursor + list result', () => {
  it('round-trips the keyset cursor and rejects garbage', () => {
    const cursor = { primary: head().createdAt, id: head().id }
    expect(decodeApplicationCursor(encodeApplicationCursor(cursor))).toEqual(cursor)
    expect(decodeApplicationCursor('not base64 !!')).toBeNull()
  })

  it('drives nextCursor only when a further page exists', () => {
    const dto = toApplicationResource(head(), [link])
    expect(() => lifecycleApplicationListResultSchema.parse(toApplicationListResult([dto], 10, false))).not.toThrow()
    expect(toApplicationListResult([dto], 10, false).nextCursor).toBeNull()
    expect(toApplicationListResult([dto], 1, true).nextCursor).not.toBeNull()
  })
})
