/**
 * Capture aggregate write ownership (issue #298, AC8).
 *
 * The Capture module owns every write to Capture state. #298 establishes the
 * module boundary; these writers remain backed by the LEGACY capture tables, which
 * stay the live runtime source (#298 ships no runtime rewiring). The Capture leaf
 * (#299) repoints them at the canonical `lifecycle_*` tables; see
 * drizzle/lifecycle-migration.md. Callers compose these thin conversations (which
 * keeps their own code free of direct Capture-table writes) and chain
 * `.values(...)`, `.returning(...)`, etc. exactly as before, so behavior is unchanged.
 */
import { captureEvidenceVersions, captureLineages, captures } from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

/** The workspace database or an open transaction. */
export type CaptureWriteExecutor = Pick<PgliteDatabase, 'insert'>

export const insertCaptureLineages = (exec: CaptureWriteExecutor) => exec.insert(captureLineages)
export const insertCaptureEvidenceVersions = (exec: CaptureWriteExecutor) => exec.insert(captureEvidenceVersions)
export const insertCaptures = (exec: CaptureWriteExecutor) => exec.insert(captures)
