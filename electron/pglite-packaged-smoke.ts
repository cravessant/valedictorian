import { createPgliteClient, migratePgliteDatabase } from '../src/db/pglite'
import { createPgliteCaptureReadModel } from '../src/modules/capture/capture.read-model'
import { createPgliteCaptureService } from '../src/modules/capture/capture.service'

const smokeProviderRecordId = 'packaged-pglite-smoke'
const smokeWorkspaceId = 'packaged-smoke-workspace'

interface PackagedPgliteSmokeOwner {
  close(): Promise<void>
  write(): Promise<void>
  read(): Promise<{ found: boolean; total: number }>
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
  const owner = await openOwner(dataDirectory)
  try {
    if (phase === 'write') {
      await owner.write()
      return { phase }
    }

    const captures = await owner.read()
    if (!captures.found) {
      throw new Error('Packaged PGlite smoke capture did not persist across application restart')
    }
    return { persistedCaptures: captures.total, phase }
  } finally {
    await owner.close()
  }
}

async function openPackagedPGlite(dataDirectory: string) {
  const client = await createPgliteClient({ dataDir: dataDirectory })
  const database = await migratePgliteDatabase(client)
  return { client, database }
}

async function openPackagedPgliteSmokeOwner(dataDirectory: string): Promise<PackagedPgliteSmokeOwner> {
  const { client, database } = await openPackagedPGlite(dataDirectory)
  const captures = createPgliteCaptureService(database)
  const readModel = createPgliteCaptureReadModel(database)
  return {
    close: () => client.close(),
    async write() {
      const result = await captures.accept({
        workspaceId: smokeWorkspaceId,
        provenance: {
          adapterId: 'packaged-smoke',
          adapterKind: 'import',
          adapterVersion: '1.0.0',
          providerRecordId: smokeProviderRecordId,
          providerSchema: 'packaged-smoke/v1',
          observedAt: new Date().toISOString(),
        },
        evidenceMode: 'reported',
        evidence: [{ kind: 'smoke', label: 'Packaged PGlite', value: smokeProviderRecordId }],
        actor: { type: 'system', id: 'packaged-smoke' },
      })
      if (!result.ok) throw new Error(`Packaged PGlite smoke write failed: ${result.code}`)
    },
    async read() {
      const result = await readModel.listCaptures(smokeWorkspaceId, { limit: 100 })
      return {
        found: result.items.some((capture) => capture.providerRecordId === smokeProviderRecordId),
        total: result.items.length,
      }
    },
  }
}
