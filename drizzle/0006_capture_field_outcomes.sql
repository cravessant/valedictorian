CREATE TABLE "capture_field_outcomes" (
	"capture_id" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"resolver_id" text NOT NULL,
	"resolver_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"field" text NOT NULL,
	"status" text NOT NULL,
	"outcome_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "capture_field_outcomes_pk" PRIMARY KEY("capture_id","capture_revision","resolver_id","resolver_version","input_hash","field"),
	CONSTRAINT "chk_capture_field_outcomes_revision" CHECK ("capture_field_outcomes"."capture_revision" > 0),
	CONSTRAINT "chk_capture_field_outcomes_resolver" CHECK (length("capture_field_outcomes"."resolver_id") between 1 and 256 and length("capture_field_outcomes"."resolver_version") between 1 and 128 and length("capture_field_outcomes"."input_hash") between 1 and 256),
	CONSTRAINT "chk_capture_field_outcomes_field" CHECK (length("capture_field_outcomes"."field") between 1 and 64),
	CONSTRAINT "chk_capture_field_outcomes_status" CHECK (length("capture_field_outcomes"."status") between 1 and 32),
	CONSTRAINT "chk_capture_field_outcomes_outcome_bound" CHECK (length("capture_field_outcomes"."outcome_json") <= 16384),
	CONSTRAINT "chk_capture_field_outcomes_outcome_keys" CHECK ("capture_field_outcomes"."outcome_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')
);
--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD COLUMN "payload_json" text;--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_capture_revisions_no_update" ON "capture_revisions";--> statement-breakpoint
UPDATE "capture_revisions" AS "revision"
SET "payload_json" = "capture"."payload_json"
FROM "captures" AS "capture"
WHERE "revision"."capture_id" = "capture"."id"
	AND "revision"."revision" = 1
	AND "revision"."payload_json" IS NULL
	AND "capture"."payload_json" IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER "trg_capture_revisions_no_update" BEFORE UPDATE ON "capture_revisions" FOR EACH ROW EXECUTE FUNCTION raise_capture_revisions_append_only();--> statement-breakpoint
ALTER TABLE "capture_field_outcomes" ADD CONSTRAINT "fk_capture_field_outcomes_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD CONSTRAINT "chk_capture_revisions_payload_bound" CHECK ("capture_revisions"."payload_json" is null or length("capture_revisions"."payload_json") <= 262144);--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD CONSTRAINT "chk_capture_revisions_payload_keys" CHECK ("capture_revisions"."payload_json" is null or "capture_revisions"."payload_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:');
