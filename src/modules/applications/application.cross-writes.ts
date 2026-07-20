/**
 * Application aggregate write ownership for external composers (issue #298, AC8).
 *
 * The Application module owns all Application-state writes. These thin
 * conversations let other modules (scoring, the lifecycle orchestration) compose
 * Application writes without issuing direct Application-table writes of their own.
 */
import { applicationEvents, applicationScores, applications } from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

type InsertExecutor = Pick<PgliteDatabase, 'insert'>
type UpdateExecutor = Pick<PgliteDatabase, 'update'>

export const insertApplicationScores = (exec: InsertExecutor) => exec.insert(applicationScores)
export const insertApplicationEvents = (exec: InsertExecutor) => exec.insert(applicationEvents)
export const updateApplications = (exec: UpdateExecutor) => exec.update(applications)
