ALTER TABLE "capture_revisions" ADD COLUMN "connector_instance_id" text;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD COLUMN "connector_run_id" text;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD COLUMN "execution_scope_id" text;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD COLUMN "reported_origin_json" text;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD COLUMN "content_hash" text;--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_capture_revisions_no_update" ON "capture_revisions";--> statement-breakpoint
UPDATE "capture_revisions" AS cr
SET
	"connector_instance_id" = first_capture."connector_instance_id",
	"connector_run_id" = first_capture."connector_run_id",
	"execution_scope_id" = first_capture."execution_scope_id",
	"reported_origin_json" = CASE
		WHEN first_capture."connector_run_id" IS NOT NULL
			AND cev."reported_origin_kind" IN ('employer','ats','job_board','aggregator','referral','other')
			AND nullif(cev."reported_origin_name", '') IS NOT NULL
		THEN json_strip_nulls(json_build_object(
			'kind', cev."reported_origin_kind",
			'name', cev."reported_origin_name",
			'providerId', cev."reported_origin_provider_id",
			'url', cev."reported_origin_url"
		))::text
		ELSE NULL
	END,
	"content_hash" = cev."content_hash"
FROM "capture_evidence_versions" AS cev
LEFT JOIN LATERAL (
	SELECT c."connector_instance_id", c."connector_run_id", c."execution_scope_id"
	FROM "captures" AS c
	WHERE c."capture_evidence_version_id" = cev."id"
		AND c."connector_instance_id" IS NOT NULL
		AND c."connector_run_id" IS NOT NULL
		AND c."execution_scope_id" IS NOT NULL
	ORDER BY c."received_at", c."id"
	LIMIT 1
) AS first_capture ON true
WHERE cr."capture_id" = cev."capture_lineage_id"
	AND cr."revision" = cev."revision";--> statement-breakpoint
CREATE TRIGGER "trg_capture_revisions_no_update" BEFORE UPDATE ON "capture_revisions" FOR EACH ROW EXECUTE FUNCTION raise_capture_revisions_append_only();--> statement-breakpoint
CREATE INDEX "idx_capture_revisions_connector_run" ON "capture_revisions" USING btree ("connector_run_id","capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_revisions_content_hash" ON "capture_revisions" USING btree ("capture_id","content_hash") WHERE "capture_revisions"."content_hash" is not null;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD CONSTRAINT "chk_capture_revisions_connector_provenance" CHECK (("capture_revisions"."connector_instance_id" is null and "capture_revisions"."connector_run_id" is null and "capture_revisions"."execution_scope_id" is null and "capture_revisions"."reported_origin_json" is null) or ("capture_revisions"."connector_instance_id" is not null and "capture_revisions"."connector_run_id" is not null and "capture_revisions"."execution_scope_id" is not null));
--> statement-breakpoint
CREATE TABLE "capture_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"connector_instance_id" text NOT NULL,
	"connector_run_id" text NOT NULL,
	"execution_scope_id" text NOT NULL,
	"observed_at" text NOT NULL,
	"received_at" text NOT NULL,
	CONSTRAINT "fk_capture_occurrences_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision"),
	CONSTRAINT "chk_capture_occurrences_revision" CHECK ("capture_occurrences"."capture_revision" > 0)
);
--> statement-breakpoint
CREATE INDEX "idx_capture_occurrences_connector_run" ON "capture_occurrences" USING btree ("connector_run_id","capture_id");--> statement-breakpoint
CREATE INDEX "idx_capture_occurrences_capture" ON "capture_occurrences" USING btree ("capture_id","capture_revision");--> statement-breakpoint
INSERT INTO "capture_occurrences" (
	"id", "capture_id", "capture_revision", "connector_instance_id", "connector_run_id",
	"execution_scope_id", "observed_at", "received_at"
)
SELECT
	c."id", c."capture_lineage_id", cev."revision", c."connector_instance_id",
	c."connector_run_id", c."execution_scope_id", c."observed_at", c."received_at"
FROM "captures" AS c
JOIN "capture_evidence_versions" AS cev ON cev."id" = c."capture_evidence_version_id"
JOIN "capture_revisions" AS cr
	ON cr."capture_id" = c."capture_lineage_id" AND cr."revision" = cev."revision"
WHERE c."connector_instance_id" IS NOT NULL
	AND c."connector_run_id" IS NOT NULL
	AND c."execution_scope_id" IS NOT NULL;
