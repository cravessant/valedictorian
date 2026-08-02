/**
 * Compile-time proof that a raw string or raw actor cannot enter a narrowed lifecycle
 * port (issue #389). Test files are excluded from `tsconfig.json`, so these assertions
 * live in typechecked source: each constant only compiles if the stated assignability
 * holds, and `pnpm typecheck` fails if a port is ever widened back to a plain string.
 */
import type {
  AdmittedCommandActor,
  BoundedJson,
  LifecycleId,
  LIFECYCLE_AUDIT_MAX,
  LIFECYCLE_SNAPSHOT_MAX,
} from '@sparxie/valedictorian-local-runtime/testing/modules/lifecycle/lifecycle-representation'

type Assignable<From, To> = [From] extends [To] ? true : false

export const rawStringIntoIdPort: Assignable<string, LifecycleId> = false
export const rawStringIntoSnapshotPort: Assignable<string, BoundedJson<typeof LIFECYCLE_SNAPSHOT_MAX>> = false
export const rawActorIntoAuditPort: Assignable<{ type: 'user'; id: string }, AdmittedCommandActor> = false
/** A value admitted at the audit bound is not interchangeable with the snapshot bound. */
export const auditJsonIntoSnapshotPort: Assignable<BoundedJson<typeof LIFECYCLE_AUDIT_MAX>, BoundedJson<typeof LIFECYCLE_SNAPSHOT_MAX>> = false
export const admittedIdIntoStringSink: Assignable<LifecycleId, string> = true
export const admittedJsonIntoStringSink: Assignable<BoundedJson<typeof LIFECYCLE_SNAPSHOT_MAX>, string> = true
