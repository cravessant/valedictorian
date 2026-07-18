import { createPgliteApplicationRepository } from '../src/modules/applications/application.repository'
import { createPgliteClient, migratePgliteDatabase } from '../src/db/pglite'

const smokeCompanyName = 'Packaged PGlite Smoke'

interface PackagedPgliteSmokeRepository {
  createApplication(input: {
    companyName: string
    country: string
    primaryLink: {
      kind: 'official'
      label: string
      url: string
    }
    roleKind: 'internship'
    roleTitle: string
    sourceName: string
    status: 'queued'
    workMode: 'remote'
  }): Promise<unknown>
  listApplications(): Promise<{
    items: Array<{ companyName?: string }>
    total: number
  }>
}

interface PackagedPgliteSmokeOwner {
  close(): Promise<void>
  repository: PackagedPgliteSmokeRepository
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
      await owner.repository.createApplication({
        companyName: smokeCompanyName,
        country: 'US',
        primaryLink: {
          kind: 'official',
          label: 'Packaged smoke fixture',
          url: 'https://example.test/packaged-pglite-smoke',
        },
        roleKind: 'internship',
        roleTitle: 'Runtime Asset Verification',
        sourceName: 'Packaged smoke',
        status: 'queued',
        workMode: 'remote',
      })
      return { phase }
    }

    const applications = await owner.repository.listApplications()
    if (!applications.items.some((item) => item.companyName === smokeCompanyName)) {
      throw new Error('Packaged PGlite smoke record did not persist across application restart')
    }
    return {
      companyName: smokeCompanyName,
      persistedApplications: applications.total,
      phase,
    }
  } finally {
    await owner.close()
  }
}

async function openPackagedPgliteSmokeOwner(dataDirectory: string) {
  const client = await createPgliteClient({ dataDir: dataDirectory })
  try {
    const database = await migratePgliteDatabase(client)
    return {
      close: () => client.close(),
      repository: createPgliteApplicationRepository(database),
    }
  } catch (error) {
    await client.close()
    throw error
  }
}
