import fs from 'node:fs'
import type { PgliteDatabase } from '../db/pglite'
import { applications } from '../db/schema'
import {
  seedReferenceTrackerApplications,
  seedSampleApplications,
  seedSampleSourcingFindings,
} from '../modules/applications/application.fixtures'
import type { LocalValedictorianClientOptions } from './local-valedictorian-runtime-options'

export async function seedLocalData(
  database: PgliteDatabase,
  {
    referenceTrackerPath,
    seedDataMode,
  }: Pick<LocalValedictorianClientOptions, 'referenceTrackerPath' | 'seedDataMode'>,
) {
  if (seedDataMode === 'none') return
  if ((await database.select().from(applications).limit(1)).length > 0) return
  if (seedDataMode === 'sample') {
    await seedSampleApplications(database)
    await seedSampleSourcingFindings(database)
    return
  }
  await seedReferenceTrackerApplications(
    database,
    fs.readFileSync(requireReferenceTrackerPath(referenceTrackerPath), 'utf8'),
  )
}

export function assertSeedOptions({
  referenceTrackerPath,
  seedDataMode,
}: Pick<LocalValedictorianClientOptions, 'referenceTrackerPath' | 'seedDataMode'>) {
  if (seedDataMode === 'reference-tracker' && !referenceTrackerPath) {
    throw new Error(
      'VALEDICTORIAN_REFERENCE_TRACKER_PATH is required when VALEDICTORIAN_SEED_DATA=reference-tracker',
    )
  }
}

function requireReferenceTrackerPath(referenceTrackerPath: string | undefined) {
  if (!referenceTrackerPath) {
    throw new Error(
      'VALEDICTORIAN_REFERENCE_TRACKER_PATH is required when VALEDICTORIAN_SEED_DATA=reference-tracker',
    )
  }
  return referenceTrackerPath
}
