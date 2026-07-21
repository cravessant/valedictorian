-- #304 (stage 2): create-dedup idempotency keys for the four canonical lifecycle
-- aggregates.
--
-- The sparxie 0.27.0 lifecycle contract makes create/promote operations idempotent
-- on a caller-supplied `idempotencyKey`: re-issuing the same create with the same key
-- must converge to the already-created resource (created:false) instead of minting a
-- duplicate. No such column exists on the four aggregate roots (only the scheduled-work
-- tables carry one). This migration adds a nullable `idempotency_key` column plus a
-- PARTIAL unique index per aggregate on (workspace_id, idempotency_key) WHERE
-- idempotency_key IS NOT NULL.
--
-- Nullable + partial: every row 0001 migrated (and every create that supplies no key)
-- leaves the column NULL and is excluded from the index, so this is inert for all
-- existing data and for keyless creates. The uniqueness is scoped to the workspace so
-- two workspaces may independently reuse the same key. The index is the DB-level
-- convergence point the service create-dedup rests on (a concurrent duplicate create
-- with the same key fails the unique index and is resolved to the winning row).
--
-- Runs inside the single migration transaction (drizzle pg-core wraps all statements in
-- one session.transaction), so any failure rolls the whole migration back.

ALTER TABLE "lifecycle_captures" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "lifecycle_jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "lifecycle_opportunities" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "lifecycle_applications" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "lifecycle_captures" ADD CONSTRAINT "chk_lifecycle_captures_idempotency_key" CHECK ("lifecycle_captures"."idempotency_key" IS NULL OR length("lifecycle_captures"."idempotency_key") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "lifecycle_jobs" ADD CONSTRAINT "chk_lifecycle_jobs_idempotency_key" CHECK ("lifecycle_jobs"."idempotency_key" IS NULL OR length("lifecycle_jobs"."idempotency_key") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "lifecycle_opportunities" ADD CONSTRAINT "chk_lifecycle_opportunities_idempotency_key" CHECK ("lifecycle_opportunities"."idempotency_key" IS NULL OR length("lifecycle_opportunities"."idempotency_key") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "lifecycle_applications" ADD CONSTRAINT "chk_lifecycle_applications_idempotency_key" CHECK ("lifecycle_applications"."idempotency_key" IS NULL OR length("lifecycle_applications"."idempotency_key") BETWEEN 1 AND 200);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_captures_idempotency" ON "lifecycle_captures" USING btree ("workspace_id","idempotency_key") WHERE "lifecycle_captures"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_jobs_idempotency" ON "lifecycle_jobs" USING btree ("workspace_id","idempotency_key") WHERE "lifecycle_jobs"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_opportunities_idempotency" ON "lifecycle_opportunities" USING btree ("workspace_id","idempotency_key") WHERE "lifecycle_opportunities"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_applications_idempotency" ON "lifecycle_applications" USING btree ("workspace_id","idempotency_key") WHERE "lifecycle_applications"."idempotency_key" is not null;
