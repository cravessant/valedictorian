# Lifecycle schema migration (#298) — sequencing map for later leaves

Read this before working on the lifecycle tables. It records what `0001` actually
did and what each following leaf owns, so nobody rebuilds an abandoned plan.

## What #298 shipped

`drizzle/0001_lifecycle_capture_job.sql` (one journaled entry; baseline `0000` is
byte-immutable) installs the canonical lifecycle schema and **one-time-transforms**
the legacy data into it, inside a single transaction:

- Canonical aggregates: `lifecycle_captures` + `capture_revisions` +
  `capture_evidence_items`; `lifecycle_jobs` + `job_external_identities` +
  `job_capture_evidence_references` + `job_history`; `lifecycle_opportunities` +
  `opportunity_history`; `lifecycle_applications` + `pursuit_links` +
  `application_attempt_records` + `application_event_records` +
  `application_history`.
- Durable scheduled-work identities: `connector_capture_work`,
  `normalization_work`, `provider_url_resolution_work`, `hosted_submission_work`,
  `hosted_result_polling_work`.
- Workspace ownership root `workspaces` (seeded with the nil-UUID default row) and
  the migration integrity report `lifecycle_migration_report`.
- The transform maps legacy captures/jobs/identities/opportunities/applications
  and `retry_work` into the canonical shapes, preserving representable
  user-authored data and reporting every deterministic reset/quarantine/synthesis.

## What #298 deliberately did NOT do

**#298 ships no runtime rewiring.** Nothing in the running app reads or writes the
canonical tables yet. The **legacy** tables (`captures`, `capture_lineages`,
`capture_evidence_versions`, `jobs`, `job_identities`, `job_identity_conflicts`,
`job_fact_versions`, `opportunities`, `sourcing_projection_outcomes`,
`applications`, `application_*`, `retry_work`, `companies`, `sources`) remain the
**live runtime source**. This matches the umbrella sequencing: aggregate CRUD,
HTTP, UI, and CLI are out of #298's scope.

Two consequences that are **by design and inert**:

1. The four canonical roots use **interim physical names** (`lifecycle_*`) so they
   do not collide with the still-live legacy roots of the same canonical name.
2. Because the legacy tables stay the live source, any writes the runtime makes
   after `0001` land in the **legacy** tables and **diverge** from the
   populated-but-frozen canonical tables. This is harmless while nothing reads the
   canonical tables. A release shipped between #298 and the cutover therefore
   carries populated-but-stale canonical tables — a conscious, acceptable choice.

## Who adopts the canonical tables (later leaves)

- **#299 / #300 / #301 / #302** — the Capture / Job / Opportunity / Application
  aggregate repositories. Each repoints its module's write conversations (see
  `src/modules/{capture,job,opportunity}/*.repository.ts`,
  `src/modules/applications/application.cross-writes.ts`) and read paths from the
  legacy tables onto the canonical ones, aggregate by aggregate. Runtime Job
  minting gets its real app-side UUIDv7 generator here (#300); the migration's
  deterministic `mint_job_uuid` stays migration-only.
- **#303** — scheduled-work adoption. `retry_work` writers move onto the five
  operation-identity tables. (This is blocked by #298 + #233 and cannot happen in
  #298: `normalization_work` / `provider_url_resolution_work` FK-reference
  `lifecycle_captures`/`capture_revisions`, which the still-legacy intake pipeline
  does not create, so writing them now would FK-fail or force a forbidden
  dual-write of captures.)
- **#304** — publishes the sparxie lifecycle contract and aligns the app DTOs to
  the new resource shapes (removing the raw-record / sourcing-finding aliases).
  Until then the app serves the OLD sparxie `0.26.1` DTOs, which is why the read
  paths cannot move onto the canonical tables inside #298.

### #299 adoption refinement (recorded when #299 landed)

The original one-line plan above ("#299 repoints its write conversations onto the
canonical tables") oversimplified: the connector raw-source intake is an
interleaved read-modify-write on the legacy tables, and ~10 downstream reads (the
sparxie DTO surface **and** the whole normalization/projection/replay pipeline)
read those same legacy tables. Moving the connector capture write onto canonical
while reads stay legacy would either starve those reads or force the forbidden
dual-write. So #299 splits along a substrate seam:

- **In #299 (canonical writes):** a new user-controlled **Capture module
  contract** (`src/modules/capture/capture.service.ts`) writes the canonical
  `lifecycle_captures` / `capture_revisions` / `capture_evidence_items` tables for
  user/manual/import/CLI provenance. Migration `0002` adds a partial unique index
  on `(workspace_id, adapter_id, provider_record_id) WHERE provider_record_id IS
  NOT NULL` so provenance identity resolves to one Capture id forever — including
  rows `0001` migrated under the reused legacy lineage id. Re-intake of a
  tombstoned Capture appends occurrences/revisions to the same id but never clears
  `removed_at`.
- **Deferred to #304 (co-sequenced with the read cutover):** the **connector
  raw-source capture write move** onto canonical, and **persisted intake-receipt
  rows** (a canonical concept). These land only when the DTO + pipeline reads move
  too, because they are one inseparable cutover and a dual-write is forbidden. The
  legacy `captures` / `capture_lineages` / `capture_evidence_versions` writers in
  `capture.repository.ts` therefore stay live through #299.
- **In #299 on the LEGACY substrate (behavior, not table move):** frontier/backfill
  acknowledgement decouples from normalization — the frontier checkpoint commits
  atomically with durable legacy capture intake, normalization is scheduled (the
  existing legacy `retry_work` normalization kind) rather than executed inline in
  connector refresh, and projection/normalization failures stop failing runs. The
  orchestration shape survives the later substrate swap. #299 does NOT touch the
  canonical `normalization_work` on the connector path (its FKs to
  `lifecycle_captures` are exactly why — canonical scheduled-work adoption is #303).
- **Scheduled work for canonical Captures:** captures created through the new
  module in #299 enqueue NO scheduled work — promotion and its scheduling arrive
  with #300. Nothing to resume is nothing deferred.

### #300 adoption refinement (recorded when #300 landed)

Same substrate split as #299 — canonical writes for the new user-controlled +
promotion paths, legacy runtime untouched:

- **In #300 (canonical writes):** the user-controlled **Job module contract**
  (`src/modules/job/job.service.ts`) writes `lifecycle_jobs` + append-only
  `job_history` with **app-side UUIDv7** ids (`src/db/uuidv7.ts`; the migration's
  `mint_job_uuid` stays migration-only). External identities (establish +
  strengthen provisional→strong), conflict inspection, and deterministic
  attach/merge use the strong-uniqueness index on `job_external_identities` as the
  DB-level "one Job per strong identity". The **Capture→Job promotion**
  orchestration composes the #299 Capture contract and the Job contract in one
  transaction and links contributing Captures via the #299
  `job_capture_evidence_references` seam.
- **Deferred to #304 (co-sequenced with the read cutover):** the **legacy inline
  job mint** (`raw-source.repository.ts` — UUIDv4, provider identity, in the
  intake tx), the **legacy normalization identity-reconcile** (`job_identities` /
  `job_identity_conflicts` / `job_fact_versions`), and the legacy
  `job_fact_versions → opportunities` projection stay live and untouched. #300
  reuses none of that reconcile code; canonical conflict handling is the strong
  unique index, not the legacy manual conflict-recording. Canonical Jobs are
  populated-but-not-yet-read by the legacy projection until #301/#304.
- **Boundary-owned retrieval (AC5):** explicit promotion retrieves synchronously
  inside the Capture→Job boundary by composing the existing #233 provider-URL
  resolver port (opaque `providerRecordId` in, validated canonical destination
  out — intermediary URLs are structurally excluded from the resolver call). The
  legacy scheduler-deferred resolution path stays until #304.
- **Deferred to #303:** the **hosted-resolution writer** (`hosted_submission_work`
  / `hosted_result_polling_work`, scheduling-owned) and the **intermediary-URL
  leak guard**. The `hosted_submission_work` `canonicalUrlHash` subject key is the
  structural enforcement point #303 must build against (the hosted resolver keys
  on the canonical URL hash, never the intermediary URL). #300 builds no hosted
  writer.

## Who finishes the cutover

- **#307** — the exhaustive clean cutover, drop, and packaged proof. It
  delta-transforms any legacy writes made after `0001`, **drops** the legacy
  lifecycle tables (including `retry_work`), and **renames** the four `lifecycle_*`
  roots to their canonical names (`captures`, `jobs`, `opportunities`,
  `applications`). `companies` / `sources` are retained by #298 because connectors,
  workflow-runs, sourcing, policy, action-queue, and applications still read/write
  them; #307 decides their fate after the aggregate rewires.

## AC10 for #298

"No runtime compatibility schema, dual read/write, fallback repository, or
old-engine bridge remains" is satisfied at the **schema/migration layer** #298
owns: `0001` installs no compatibility machinery, no dual read/write mechanism, no
fallback repository, no old-engine bridge, and no compat aliases inside the new
schema. Legacy tables remaining physically present as the live source until later
leaves adopt the new schema is the umbrella's designed sequencing, not a #298
compatibility layer. The physical drop/rename that frees the canonical names
completes at #307.
