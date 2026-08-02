import { createPgliteClient, migratePgliteDatabase } from '@sparxie/valedictorian-local-runtime/database'
import { workspaces } from '@sparxie/valedictorian-local-runtime/testing/db/workspaces.schema'
import { createPgliteCaptureReadModel } from '@sparxie/valedictorian-local-runtime/capture'
import { createPgliteCaptureService } from '@sparxie/valedictorian-local-runtime/capture'
import { createInitialCompanyAssignment } from '@sparxie/valedictorian-local-runtime/company'
import { jobFactsTiming } from '@sparxie/valedictorian-local-runtime/job'
import { createLocalLifecycleMethods } from '@sparxie/valedictorian-local-runtime/testing/runtime/local-lifecycle-methods'

const smokeProviderRecordId = 'packaged-pglite-smoke'
const smokeWorkspaceId = 'packaged-smoke-workspace'

interface PackagedPgliteSmokeOwner {
  close(): Promise<void>
  write(cycle: 1 | 2): Promise<void>
  read(cycles: 1 | 2): Promise<{ found: boolean; total: number; completeLifecycle: boolean }>
}

export interface RunPackagedPgliteSmokeOptions {
  dataDirectory: string
  phase: 'verify' | 'write'
  openOwner?: (dataDirectory: string) => Promise<PackagedPgliteSmokeOwner>
}

export async function runPackagedPgliteSmoke({
  dataDirectory,
  phase,
  openOwner = openPackagedPgliteSmokeOwner,
}: RunPackagedPgliteSmokeOptions) {
  if (phase === 'write') {
    const owner = await openOwner(dataDirectory)
    try {
      await owner.write(1)
      return { phase }
    } finally {
      await owner.close()
    }
  }

  const reopened = await openOwner(dataDirectory)
  try {
    assertPersisted(await reopened.read(1))
    await reopened.write(2)
  } finally {
    await reopened.close()
  }

  const reopenedAgain = await openOwner(dataDirectory)
  try {
    const captures = await reopenedAgain.read(2)
    assertPersisted(captures)
    return { persistedCaptures: captures.total, phase }
  } finally {
    await reopenedAgain.close()
  }
}

function assertPersisted(captures: { found: boolean; completeLifecycle: boolean }) {
  if (!captures.found) throw new Error('Packaged PGlite smoke capture did not persist across application restart')
  if (!captures.completeLifecycle) throw new Error('Packaged PGlite smoke lifecycle did not persist across application restart')
}

async function openPackagedPGlite(dataDirectory: string) {
  const client = await createPgliteClient({ dataDir: dataDirectory })
  const database = await migratePgliteDatabase(client)
  return { client, database }
}

async function openPackagedPgliteSmokeOwner(dataDirectory: string): Promise<PackagedPgliteSmokeOwner> {
  const { client, database } = await openPackagedPGlite(dataDirectory)
  const openedAt = new Date().toISOString()
  await database.insert(workspaces).values({
    id: smokeWorkspaceId,
    name: smokeWorkspaceId,
    createdAt: openedAt,
    updatedAt: openedAt,
  }).onConflictDoNothing()
  const captures = createPgliteCaptureService(database)
  const readModel = createPgliteCaptureReadModel(database)
  const lifecycle = createLocalLifecycleMethods(database, {
    workspaceId: smokeWorkspaceId,
    initialCompanyAssignment: createInitialCompanyAssignment(),
  })
  const actor = { id: 'packaged-smoke', type: 'system' as const }
  return {
    close: () => client.close(),
    async write(cycle) {
      const suffix = cycle === 1 ? '' : '-second'
      if (cycle === 2) {
        const prior = (await lifecycle.applications.list()).items.find((application) => application.removedAt === null)
        if (!prior) throw new Error('Packaged PGlite smoke prior Application was not visible after restart')
        const updated = await lifecycle.applications.updateStatus({
          applicationId: prior.id, expectedRevision: prior.revision, actor, status: 'submitted',
          rationale: 'package restart mutation proof',
        })
        if (updated.status !== 'succeeded') throw new Error('Packaged PGlite smoke restart mutation failed')
      }
      const result = await captures.accept({
        workspaceId: smokeWorkspaceId,
        provenance: {
          adapterId: 'packaged-smoke',
          adapterKind: 'import',
          adapterVersion: '1.0.0',
          providerRecordId: `${smokeProviderRecordId}${suffix}`,
          providerSchema: 'packaged-smoke/v1',
          observedAt: new Date().toISOString(),
        },
        evidenceMode: 'reported',
        evidence: [{ kind: 'smoke', label: 'Packaged PGlite', value: `${smokeProviderRecordId}${suffix}` }],
        actor: { type: 'system', id: 'packaged-smoke' },
      })
      if (!result.ok) throw new Error(`Packaged PGlite smoke write failed: ${result.code}`)
      const promotedJob = await lifecycle.captures.promoteToJob({
        idempotencyKey: `packaged-smoke-job${suffix}`, actor, captureId: result.capture.id,
        captureRevision: result.capture.revision,
        selectedFacts: {
          companyName: 'Packaged Smoke', roleTitle: 'Lifecycle Engineer', sourceName: 'package',
          roleKind: 'experienced',
          ...jobFactsTiming({ terms: [], timingMode: 'unknown', startDate: null, endDate: null }),
          location: null, workMode: 'remote', employmentType: 'full_time',
          seniority: 'senior', compensation: null, postedAt: null, destination: null,
        },
        evidenceReferences: [{ captureId: result.capture.id, captureRevision: result.capture.revision, evidenceIndexes: [0] }],
        externalIdentities: [],
      })
      if (promotedJob.status !== 'promoted') throw new Error('Packaged PGlite smoke Job promotion failed')
      const promotedOpportunity = await lifecycle.jobs.promoteToOpportunity({
        idempotencyKey: `packaged-smoke-opportunity${suffix}`, actor, jobId: promotedJob.resource.id,
        expectedFactsRevision: promotedJob.resource.factsRevision,
        evaluation: { fit: 'fit', rank: 1, cutoff: 'above', disposition: 'pursue' },
      })
      if (promotedOpportunity.status !== 'promoted') throw new Error('Packaged PGlite smoke Opportunity promotion failed')
      const promotedApplication = await lifecycle.opportunities.promoteToApplication({
        idempotencyKey: `packaged-smoke-application${suffix}`, actor,
        opportunityId: promotedOpportunity.resource.id, expectedJobId: promotedJob.resource.id,
      })
      if (promotedApplication.status !== 'promoted') throw new Error('Packaged PGlite smoke Application promotion failed')
      const linked = await lifecycle.applications.links.create({
        applicationId: promotedApplication.resource.id, expectedRevision: promotedApplication.resource.revision,
        actor, link: { kind: 'careers', label: 'Careers', url: `https://example.com/package-smoke${suffix}` }, primary: true,
      })
      if (linked.status !== 'succeeded') throw new Error('Packaged PGlite smoke link create failed')
      const link = linked.resource.links.find((candidate) => candidate.url === `https://example.com/package-smoke${suffix}`)
      if (!link) throw new Error('Packaged PGlite smoke link was not persisted')
      const unlinked = await lifecycle.applications.links.remove({
        applicationId: linked.resource.id, expectedRevision: linked.resource.revision,
        actor, linkId: link.id, rationale: 'package lifecycle unlink proof',
      })
      if (unlinked.status !== 'succeeded') throw new Error('Packaged PGlite smoke unlink failed')
      const removed = await lifecycle.applications.remove({
        id: unlinked.resource.id, choice: 'cascade_tombstone', actor, rationale: 'package lifecycle removal proof',
      })
      if (removed.status !== 'removed') throw new Error('Packaged PGlite smoke removal failed')
      const restored = await lifecycle.applications.restore({
        id: unlinked.resource.id, actor, rationale: 'package lifecycle restore proof',
      })
      if (restored.status !== 'restored') throw new Error('Packaged PGlite smoke restore failed')
      const repeated = await lifecycle.opportunities.promoteToApplication({
        idempotencyKey: `packaged-smoke-application${suffix}`, actor,
        opportunityId: promotedOpportunity.resource.id, expectedJobId: promotedJob.resource.id,
      })
      if (repeated.status !== 'promoted' || repeated.resource.id !== unlinked.resource.id) {
        throw new Error('Packaged PGlite smoke repeated promotion did not converge')
      }
    },
    async read(cycles) {
      const result = await readModel.listCaptures(smokeWorkspaceId, { limit: 100 })
      const providerIds = new Set(result.items.map((capture) => capture.providerRecordId))
      const applicationItems = (await lifecycle.applications.list()).items
      return {
        found: providerIds.has(smokeProviderRecordId)
          && (cycles === 1 || providerIds.has(`${smokeProviderRecordId}-second`)),
        total: result.items.length,
        completeLifecycle: (await lifecycle.jobs.list()).items.length >= cycles
          && (await lifecycle.opportunities.list()).items.length >= cycles
          && applicationItems.filter((application) => application.removedAt === null).length >= cycles
          && (cycles === 1 || applicationItems.some((application) => application.status === 'submitted')),
      }
    },
  }
}
