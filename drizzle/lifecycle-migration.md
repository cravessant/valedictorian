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
