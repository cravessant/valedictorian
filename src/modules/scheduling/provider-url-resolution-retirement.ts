/**
 * One-way cutover for the former provider-URL scheduler. The table remains as
 * immutable migration history, but no pending row may be dispatched after the
 * capture-destination work model becomes active.
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import { providerUrlResolutionWork } from './scheduling.schema'

export async function retireProviderUrlResolutionWork(
  database: PgliteDatabase,
  workspaceId: string,
  retiredAt: string,
) {
  const retired = await database.update(providerUrlResolutionWork).set({
    status: 'cancelled',
    nextEligibleAt: null,
    acquisitionToken: null,
    claimedAt: null,
    claimExpiresAt: null,
    failureReason: null,
    failureDetail: 'Retired by capture destination resolution cutover.',
    updatedAt: retiredAt,
  }).where(and(
    eq(providerUrlResolutionWork.workspaceId, workspaceId),
    inArray(providerUrlResolutionWork.status, ['scheduled', 'claimed']),
  )).returning({ id: providerUrlResolutionWork.id })
  return retired.length
}
