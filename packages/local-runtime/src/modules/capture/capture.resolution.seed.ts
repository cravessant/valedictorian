/**
 * Capture resolution seeding (issue #327).
 *
 * The owner-provided write the isolated-validation fixture needs to place a
 * Capture's destination stage in a known resolved state. It replaces the
 * fixture's direct write to the `capture_resolution_generations` and
 * `capture_resolution_stage_results` tables, so only the Capture module touches
 * Capture state. It reports a missing active generation rather than throwing, so
 * the caller keeps its own diagnostic.
 */
import { and, eq } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite.js'
import { captureResolutionGenerations, captureResolutionStageResults } from './capture.schema.js'

export interface ResolvedCaptureDestinationSeed {
  readonly captureId: string
  readonly destinationUrl: string
  readonly resolvedAt: string
  readonly workspaceId: string
}

/** @returns false when the Capture has no active resolution generation to seed. */
export async function seedResolvedCaptureDestination(
  database: PgliteDatabase,
  seed: ResolvedCaptureDestinationSeed,
): Promise<boolean> {
  const [generation] = await database
    .select({ id: captureResolutionGenerations.id })
    .from(captureResolutionGenerations)
    .where(and(
      eq(captureResolutionGenerations.captureId, seed.captureId),
      eq(captureResolutionGenerations.workspaceId, seed.workspaceId),
      eq(captureResolutionGenerations.status, 'active'),
    ))
    .limit(1)
  if (!generation) return false

  await database.update(captureResolutionStageResults).set({
    issueJson: null,
    nextAttemptAt: null,
    resultJson: JSON.stringify({ url: seed.destinationUrl }),
    status: 'resolved',
    updatedAt: seed.resolvedAt,
  }).where(and(
    eq(captureResolutionStageResults.generationId, generation.id),
    eq(captureResolutionStageResults.stage, 'destination'),
  ))
  return true
}
