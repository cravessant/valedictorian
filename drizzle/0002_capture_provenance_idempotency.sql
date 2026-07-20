-- #299 (slice-4 correction): provenance idempotency for the runtime Capture aggregate.
--
-- The unique key includes provider_schema (coalesced) to match the LEGACY connector
-- lineage identity (adapterId, providerSchema, providerRecordId) — see
-- providerIdentityNamespace in src/modules/sourcing/raw-source.repository.ts. The same
-- adapter re-observing a provider record under a bumped schema (jobright.v1 ->
-- jobright.v2) legitimately produced two legacy lineages; 0001 migrates both into
-- lifecycle_captures rows differing only in provider_schema, and this widened key keeps
-- them distinct instead of colliding on the narrower (workspace, adapter, record) key.
--
-- Belt-and-braces: before the unique index, quarantine any residual TRUE duplicate
-- (same workspace, adapter, provider_schema, provider_record_id) that a non-connector
-- no-dedup intake path could have left in 0001's output, following 0001's quarantine
-- pattern (report + deterministic winner), so the index is created on non-corrupt data.
--
-- capture_revisions and capture_evidence_items are append-only (no-delete triggers), so a
-- loser's observed history is NOT deleted. Instead the loser's provenance-identity claim
-- is dropped (provider_record_id -> NULL), which excludes it from the partial unique index
-- WHERE provider_record_id IS NOT NULL: the earliest capture keeps owning the provenance
-- identity, the loser's row + full history survive, and runtime resolution no longer
-- matches the loser by provider record. No FK cascade is needed (the row remains).
--
-- Runs inside the single migration transaction (drizzle pg-core wraps all statements in
-- one session.transaction), so any failure rolls the whole migration back.

-- Losers per provenance group: keep the earliest created_at, then min id.
CREATE TEMP TABLE "_capture_provenance_dupes" ON COMMIT DROP AS
SELECT lc."id"
FROM "lifecycle_captures" lc
WHERE lc."provider_record_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "lifecycle_captures" keep
    WHERE keep."provider_record_id" IS NOT NULL
      AND keep."workspace_id" = lc."workspace_id"
      AND keep."adapter_id" = lc."adapter_id"
      AND coalesce(keep."provider_schema", '') = coalesce(lc."provider_schema", '')
      AND keep."provider_record_id" = lc."provider_record_id"
      AND (keep."created_at" < lc."created_at"
        OR (keep."created_at" = lc."created_at" AND keep."id" < lc."id"))
  );
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'capture_provenance_dupe:' || d."id", 'quarantine', 'lifecycle_captures', d."id",
  'residual duplicate under (workspace, adapter, provider_schema, provider_record_id); kept the earliest capture and dropped this row''s provider_record_id',
  '{"index":"idx_lifecycle_captures_provenance"}', '2026-07-20T00:00:00.000Z'
FROM "_capture_provenance_dupes" d;
--> statement-breakpoint
UPDATE "lifecycle_captures" SET "provider_record_id" = NULL WHERE "id" IN (SELECT "id" FROM "_capture_provenance_dupes");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_captures_provenance" ON "lifecycle_captures" USING btree ("workspace_id","adapter_id",coalesce("provider_schema", ''),"provider_record_id") WHERE "lifecycle_captures"."provider_record_id" is not null;
