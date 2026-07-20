/**
 * Capture aggregate write ownership (issue #298 AC8, adopted by #299).
 *
 * The Capture module owns every write to Capture state. Two write surfaces
 * coexist during the umbrella cutover:
 *
 *  - LEGACY conversations (`insertCaptures` / `insertCaptureLineages` /
 *    `insertCaptureEvidenceVersions`) back the still-live connector raw-source
 *    intake. #299 does NOT repoint these — the connector write move is
 *    co-sequenced with the capture read cutover at #304 (see
 *    drizzle/lifecycle-migration.md), because the DTO + normalization read paths
 *    still read the legacy tables and a dual-write is forbidden.
 *  - CANONICAL conversations (`insertLifecycleCaptures` / `insertCaptureRevisions`
 *    / `insertCaptureEvidenceItems` / `updateLifecycleCaptures`) back the new
 *    user-controlled Capture module contract (#299), which writes the canonical
 *    `lifecycle_*` tables and is exercised through the Capture service.
 *
 * Callers compose these thin conversations (keeping their own code free of direct
 * Capture-table writes) and chain `.values(...)`, `.set(...)`, `.where(...)`,
 * `.returning(...)` exactly as with the raw query builder.
 */
import { captureEvidenceVersions, captureLineages, captures } from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'
import { captureEvidenceItems, captureRevisions, lifecycleCaptures } from './capture.schema'

/** The workspace database or an open transaction, insert surface only. */
export type CaptureWriteExecutor = Pick<PgliteDatabase, 'insert'>

/** Insert + update surface, for canonical Capture head mutations (revision bump, tombstone). */
export type CaptureMutateExecutor = Pick<PgliteDatabase, 'insert' | 'update'>

// Legacy (connector raw-source intake; repointed at #304, not #299).
export const insertCaptureLineages = (exec: CaptureWriteExecutor) => exec.insert(captureLineages)
export const insertCaptureEvidenceVersions = (exec: CaptureWriteExecutor) => exec.insert(captureEvidenceVersions)
export const insertCaptures = (exec: CaptureWriteExecutor) => exec.insert(captures)

// Canonical (the #299 user-controlled Capture aggregate).
export const insertLifecycleCaptures = (exec: CaptureWriteExecutor) => exec.insert(lifecycleCaptures)
export const insertCaptureRevisions = (exec: CaptureWriteExecutor) => exec.insert(captureRevisions)
export const insertCaptureEvidenceItems = (exec: CaptureWriteExecutor) => exec.insert(captureEvidenceItems)
export const updateLifecycleCaptures = (exec: CaptureMutateExecutor) => exec.update(lifecycleCaptures)
