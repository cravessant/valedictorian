/**
 * Capture aggregate write ownership (issue #298 AC8, adopted by #299).
 *
 * The Capture module owns every write to canonical Capture state through these
 * thin repository conversations.
 *
 * Callers compose these thin conversations (keeping their own code free of direct
 * Capture-table writes) and chain `.values(...)`, `.set(...)`, `.where(...)`,
 * `.returning(...)` exactly as with the raw query builder.
 */
import type { PgliteDatabase } from '../../db/pglite.js'
import { captureEvidenceItems, captureFieldOutcomes, captureOccurrences, captureRevisions, captures } from './capture.schema.js'

/** The workspace database or an open transaction, insert surface only. */
export type CaptureWriteExecutor = Pick<PgliteDatabase, 'insert'>

/** Insert + update surface, for canonical Capture head mutations (revision bump, tombstone). */
export type CaptureMutateExecutor = Pick<PgliteDatabase, 'insert' | 'update'>

// Canonical (the #299 user-controlled Capture aggregate).
export const insertCaptures = (exec: CaptureWriteExecutor) => exec.insert(captures)
export const insertCaptureRevisions = (exec: CaptureWriteExecutor) => exec.insert(captureRevisions)
export const insertCaptureOccurrences = (exec: CaptureWriteExecutor) => exec.insert(captureOccurrences)
export const insertCaptureEvidenceItems = (exec: CaptureWriteExecutor) => exec.insert(captureEvidenceItems)
export const insertCaptureFieldOutcomes = (exec: CaptureWriteExecutor) => exec.insert(captureFieldOutcomes)
export const updateCaptures = (exec: CaptureMutateExecutor) => exec.update(captures)
