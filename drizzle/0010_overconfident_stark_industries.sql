CREATE TABLE "company_duplicate_candidate_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"candidate_revision" integer NOT NULL,
	"decision" text NOT NULL,
	"actor_json" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_company_duplicate_candidate_reviews_decision" CHECK ("company_duplicate_candidate_reviews"."decision" = 'mark_distinct'),
	CONSTRAINT "chk_company_duplicate_candidate_reviews_revision" CHECK ("company_duplicate_candidate_reviews"."candidate_revision" > 0),
	CONSTRAINT "chk_company_duplicate_candidate_reviews_actor" CHECK (length("company_duplicate_candidate_reviews"."actor_json") between 2 and 2048),
	CONSTRAINT "chk_company_duplicate_candidate_reviews_rationale" CHECK (length(btrim("company_duplicate_candidate_reviews"."rationale")) between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "company_duplicate_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lower_company_id" text NOT NULL,
	"higher_company_id" text NOT NULL,
	"revision" integer NOT NULL,
	"score" integer NOT NULL,
	"reason_codes_json" text NOT NULL,
	"matcher_version" text NOT NULL,
	"lower_input_fingerprint" text NOT NULL,
	"higher_input_fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "uq_company_duplicate_candidates_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "chk_company_duplicate_candidates_id" CHECK ("company_duplicate_candidates"."id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "chk_company_duplicate_candidates_order" CHECK ("company_duplicate_candidates"."lower_company_id" < "company_duplicate_candidates"."higher_company_id"),
	CONSTRAINT "chk_company_duplicate_candidates_revision" CHECK ("company_duplicate_candidates"."revision" > 0),
	CONSTRAINT "chk_company_duplicate_candidates_score" CHECK ("company_duplicate_candidates"."score" between 0 and 10000),
	CONSTRAINT "chk_company_duplicate_candidates_reasons" CHECK (length("company_duplicate_candidates"."reason_codes_json") between 2 and 2048),
	CONSTRAINT "chk_company_duplicate_candidates_matcher" CHECK (length("company_duplicate_candidates"."matcher_version") between 1 and 100),
	CONSTRAINT "chk_company_duplicate_candidates_fingerprints" CHECK (length("company_duplicate_candidates"."lower_input_fingerprint") = 64
        and length("company_duplicate_candidates"."higher_input_fingerprint") = 64),
	CONSTRAINT "chk_company_duplicate_candidates_status" CHECK ("company_duplicate_candidates"."status" in ('open','marked_distinct','resolved_by_merge'))
);
--> statement-breakpoint
CREATE TABLE "company_duplicate_index_state" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"matcher_version" text NOT NULL,
	"after_company_id" text,
	"status" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_company_duplicate_index_state_status" CHECK ("company_duplicate_index_state"."status" in ('indexing','ready')),
	CONSTRAINT "chk_company_duplicate_index_state_matcher" CHECK (length("company_duplicate_index_state"."matcher_version") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "company_duplicate_maintenance_work" (
	"workspace_id" text NOT NULL,
	"company_id" text NOT NULL,
	"requested_revision" integer NOT NULL,
	"processed_revision" integer,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "company_duplicate_maintenance_work_workspace_id_company_id_pk" PRIMARY KEY("workspace_id","company_id"),
	CONSTRAINT "chk_company_duplicate_maintenance_work_requested" CHECK ("company_duplicate_maintenance_work"."requested_revision" > 0),
	CONSTRAINT "chk_company_duplicate_maintenance_work_processed" CHECK ("company_duplicate_maintenance_work"."processed_revision" is null
        or ("company_duplicate_maintenance_work"."processed_revision" > 0
          and "company_duplicate_maintenance_work"."processed_revision" <= "company_duplicate_maintenance_work"."requested_revision")),
	CONSTRAINT "chk_company_duplicate_maintenance_work_status" CHECK ("company_duplicate_maintenance_work"."status" in ('pending','processing','idle'))
);
--> statement-breakpoint
ALTER TABLE "company_command_receipts" DROP CONSTRAINT "chk_company_command_receipts_operation";--> statement-breakpoint
ALTER TABLE "company_duplicate_candidate_reviews" ADD CONSTRAINT "fk_company_duplicate_candidate_reviews_candidate" FOREIGN KEY ("workspace_id","candidate_id") REFERENCES "public"."company_duplicate_candidates"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD CONSTRAINT "company_duplicate_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD CONSTRAINT "fk_company_duplicate_candidates_lower" FOREIGN KEY ("workspace_id","lower_company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD CONSTRAINT "fk_company_duplicate_candidates_higher" FOREIGN KEY ("workspace_id","higher_company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_index_state" ADD CONSTRAINT "company_duplicate_index_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_maintenance_work" ADD CONSTRAINT "fk_company_duplicate_maintenance_work_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_company_duplicate_candidate_reviews_revision" ON "company_duplicate_candidate_reviews" USING btree ("candidate_id","candidate_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_company_duplicate_candidates_pair" ON "company_duplicate_candidates" USING btree ("workspace_id","lower_company_id","higher_company_id");--> statement-breakpoint
CREATE INDEX "idx_company_duplicate_candidates_review_queue" ON "company_duplicate_candidates" USING btree ("workspace_id","status","score" DESC NULLS LAST,"updated_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "idx_company_duplicate_candidates_lower" ON "company_duplicate_candidates" USING btree ("workspace_id","lower_company_id","status");--> statement-breakpoint
CREATE INDEX "idx_company_duplicate_candidates_higher" ON "company_duplicate_candidates" USING btree ("workspace_id","higher_company_id","status");--> statement-breakpoint
CREATE INDEX "idx_company_duplicate_maintenance_work_pending" ON "company_duplicate_maintenance_work" USING btree ("workspace_id","status","updated_at","company_id");--> statement-breakpoint
CREATE INDEX "idx_company_aliases_duplicate_signal" ON "company_aliases" USING btree ("workspace_id","normalized_value","company_id") WHERE "company_aliases"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "idx_workspace_companies_website_host" ON "workspace_companies" USING btree ("workspace_id","website_host","id") WHERE "workspace_companies"."website_host" is not null;--> statement-breakpoint
ALTER TABLE "company_command_receipts" ADD CONSTRAINT "chk_company_command_receipts_operation" CHECK ("company_command_receipts"."operation" in ('create','update','notes','alias_add','alias_update','alias_remove','archive','restore','reassign','mark_distinct'));