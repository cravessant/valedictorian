/**
 * Canonical Application aggregate write ownership (issue #298 AC8, adopted by #302).
 *
 * These conversations back the Application aggregate and
 * Opportunity→Application promotion, writing `applications`,
 * `pursuit_links`, `application_attempt_records`, `application_event_records`, and
 * append-only `application_history` tables (Application-owned).
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
  applications,
  pursuitLinks,
} from '../application/application.schema.js'
import type { PgliteDatabase } from '../../db/pglite.js'

/** Insert-only surface (the workspace database or an open transaction). */
export type ApplicationWriteExecutor = Pick<PgliteDatabase, 'insert'>
/** Insert + update surface, for canonical Application head mutations. */
export type ApplicationMutateExecutor = Pick<PgliteDatabase, 'insert' | 'update'>
/** Insert + update + delete surface, for the cascade removal of dependent children. */
export type ApplicationDeleteExecutor = Pick<PgliteDatabase, 'insert' | 'update' | 'delete'>

export const insertApplications = (exec: ApplicationWriteExecutor) => exec.insert(applications)
export const updateApplications = (exec: ApplicationMutateExecutor) => exec.update(applications)
export const insertApplicationHistoryRecords = (exec: ApplicationWriteExecutor) => exec.insert(applicationHistory)
export const insertPursuitLinks = (exec: ApplicationWriteExecutor) => exec.insert(pursuitLinks)
export const updatePursuitLinks = (exec: ApplicationMutateExecutor) => exec.update(pursuitLinks)
export const deletePursuitLinks = (exec: ApplicationDeleteExecutor) => exec.delete(pursuitLinks)
export const insertApplicationAttemptRecords = (exec: ApplicationWriteExecutor) => exec.insert(applicationAttemptRecords)
export const deleteApplicationAttemptRecords = (exec: ApplicationDeleteExecutor) => exec.delete(applicationAttemptRecords)
export const insertApplicationEventRecords = (exec: ApplicationWriteExecutor) => exec.insert(applicationEventRecords)
export const deleteApplicationEventRecords = (exec: ApplicationDeleteExecutor) => exec.delete(applicationEventRecords)
