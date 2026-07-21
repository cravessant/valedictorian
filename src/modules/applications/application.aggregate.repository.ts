/**
 * Canonical Application aggregate write ownership (issue #298 AC8, adopted by #302).
 *
 * These conversations back the NEW user-controlled Application aggregate + the
 * Opportunity→Application promotion, writing the canonical `lifecycle_applications`,
 * `pursuit_links`, `application_attempt_records`, `application_event_records`, and
 * append-only `application_history` tables (Application-owned). They live alongside
 * the still-live LEGACY conversations (application.repository.ts /
 * application.cross-writes.ts) which keep backing the runtime until #304 repoints it
 * (no dual-write; legacy reads stay legacy — see drizzle/lifecycle-migration.md).
 *
 * The state-ownership scanner (src/test/lifecycle-state-ownership.ts) attributes
 * these `.insert/.update/.delete(table)` calls to the applications module; every
 * other module (the lifecycle orchestration, scoring) composes them as function
 * calls rather than writing the tables directly.
 */
import {
  applicationAttemptRecords,
  applicationEventRecords,
  applicationHistory,
  lifecycleApplications,
  pursuitLinks,
} from '../application/application.schema'
import type { PgliteDatabase } from '../../db/pglite'

/** Insert-only surface (the workspace database or an open transaction). */
export type ApplicationWriteExecutor = Pick<PgliteDatabase, 'insert'>
/** Insert + update surface, for canonical Application head mutations. */
export type ApplicationMutateExecutor = Pick<PgliteDatabase, 'insert' | 'update'>
/** Insert + update + delete surface, for the cascade removal of dependent children. */
export type ApplicationDeleteExecutor = Pick<PgliteDatabase, 'insert' | 'update' | 'delete'>

export const insertLifecycleApplications = (exec: ApplicationWriteExecutor) => exec.insert(lifecycleApplications)
export const updateLifecycleApplications = (exec: ApplicationMutateExecutor) => exec.update(lifecycleApplications)
export const insertApplicationHistoryRecords = (exec: ApplicationWriteExecutor) => exec.insert(applicationHistory)
export const insertPursuitLinks = (exec: ApplicationWriteExecutor) => exec.insert(pursuitLinks)
export const updatePursuitLinks = (exec: ApplicationMutateExecutor) => exec.update(pursuitLinks)
export const deletePursuitLinks = (exec: ApplicationDeleteExecutor) => exec.delete(pursuitLinks)
export const insertApplicationAttemptRecords = (exec: ApplicationWriteExecutor) => exec.insert(applicationAttemptRecords)
export const deleteApplicationAttemptRecords = (exec: ApplicationDeleteExecutor) => exec.delete(applicationAttemptRecords)
export const insertApplicationEventRecords = (exec: ApplicationWriteExecutor) => exec.insert(applicationEventRecords)
export const deleteApplicationEventRecords = (exec: ApplicationDeleteExecutor) => exec.delete(applicationEventRecords)
