CREATE TABLE "company_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"company_id" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"removed_at" text,
	CONSTRAINT "chk_company_aliases_value" CHECK (length(btrim("company_aliases"."value")) between 1 and 500),
	CONSTRAINT "chk_company_aliases_normalized_value" CHECK (length("company_aliases"."normalized_value") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "company_backfill_journal" (
	"workspace_id" text NOT NULL,
	"job_id" text NOT NULL,
	"company_id" text NOT NULL,
	"used_unknown_name" integer NOT NULL,
	"completed_at" text NOT NULL,
	CONSTRAINT "company_backfill_journal_workspace_id_job_id_pk" PRIMARY KEY("workspace_id","job_id"),
	CONSTRAINT "chk_company_backfill_journal_unknown" CHECK ("company_backfill_journal"."used_unknown_name" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE "company_capability_state" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"completed" integer NOT NULL,
	"total" integer NOT NULL,
	"issue_count" integer NOT NULL,
	"blocked_reason" text,
	"message" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_company_capability_status" CHECK ("company_capability_state"."status" in ('migrating','blocked','ready')),
	CONSTRAINT "chk_company_capability_counts" CHECK ("company_capability_state"."completed" >= 0 and "company_capability_state"."total" >= 0
        and "company_capability_state"."completed" <= "company_capability_state"."total" and "company_capability_state"."issue_count" >= 0),
	CONSTRAINT "chk_company_capability_blocked" CHECK (("company_capability_state"."status" = 'blocked') =
        ("company_capability_state"."blocked_reason" is not null and "company_capability_state"."message" is not null)),
	CONSTRAINT "chk_company_capability_reason" CHECK ("company_capability_state"."blocked_reason" is null or "company_capability_state"."blocked_reason" in
        ('migration_failed','invalid_legacy_data','integrity_check_failed')),
	CONSTRAINT "chk_company_capability_message" CHECK ("company_capability_state"."message" is null or length(btrim("company_capability_state"."message")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "company_history" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"company_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"company_revision" integer NOT NULL,
	"kind" text NOT NULL,
	"changed_fields_json" text NOT NULL,
	"actor_json" text NOT NULL,
	"rationale" text NOT NULL,
	"related_company_id" text,
	"affected_job_ids_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_company_history_sequence" CHECK ("company_history"."sequence" > 0),
	CONSTRAINT "chk_company_history_revision" CHECK ("company_history"."company_revision" > 0),
	CONSTRAINT "chk_company_history_kind" CHECK ("company_history"."kind" in ('created','updated','alias_added','alias_updated',
        'alias_removed','archived','restored','merged')),
	CONSTRAINT "chk_company_history_changed_fields" CHECK (length("company_history"."changed_fields_json") between 2 and 2048),
	CONSTRAINT "chk_company_history_actor" CHECK (length("company_history"."actor_json") between 2 and 2048),
	CONSTRAINT "chk_company_history_rationale" CHECK (length(btrim("company_history"."rationale")) between 1 and 1000),
	CONSTRAINT "chk_company_history_affected_jobs" CHECK (length("company_history"."affected_job_ids_json") between 2 and 16384)
);
--> statement-breakpoint
CREATE TABLE "job_company_assignment_history" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"job_id" text NOT NULL,
	"assignment_revision" integer NOT NULL,
	"prior_company_id" text,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_json" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_job_company_assignment_history_revision" CHECK ("job_company_assignment_history"."assignment_revision" > 0),
	CONSTRAINT "chk_job_company_assignment_history_kind" CHECK ("job_company_assignment_history"."kind" in ('baseline','assigned','reassigned','merged')),
	CONSTRAINT "chk_job_company_assignment_history_rationale" CHECK (length(btrim("job_company_assignment_history"."rationale")) between 1 and 1000),
	CONSTRAINT "chk_job_company_assignment_history_actor" CHECK (length("job_company_assignment_history"."actor_json") between 2 and 2048)
);
--> statement-breakpoint
CREATE TABLE "job_company_assignments" (
	"job_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"company_id" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_job_company_assignments_revision" CHECK ("job_company_assignments"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"display_name" text NOT NULL,
	"normalized_display_name" text NOT NULL,
	"website_url" text,
	"website_host" text,
	"notes" text,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"merged_into_company_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "uq_workspace_companies_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "chk_workspace_companies_id" CHECK ("workspace_companies"."id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "chk_workspace_companies_display_name" CHECK (length(btrim("workspace_companies"."display_name")) between 1 and 500),
	CONSTRAINT "chk_workspace_companies_normalized_name" CHECK (length("workspace_companies"."normalized_display_name") between 1 and 500),
	CONSTRAINT "chk_workspace_companies_website_url" CHECK ("workspace_companies"."website_url" is null or length("workspace_companies"."website_url") between 8 and 2048),
	CONSTRAINT "chk_workspace_companies_website_host" CHECK ("workspace_companies"."website_host" is null or length("workspace_companies"."website_host") between 1 and 253),
	CONSTRAINT "chk_workspace_companies_notes" CHECK ("workspace_companies"."notes" is null or length("workspace_companies"."notes") between 1 and 10000),
	CONSTRAINT "chk_workspace_companies_revision" CHECK ("workspace_companies"."revision" > 0),
	CONSTRAINT "chk_workspace_companies_status" CHECK ("workspace_companies"."status" in ('active','archived','merged')),
	CONSTRAINT "chk_workspace_companies_merged_target" CHECK (("workspace_companies"."status" = 'merged') = ("workspace_companies"."merged_into_company_id" is not null)
        and "workspace_companies"."merged_into_company_id" is distinct from "workspace_companies"."id")
);
--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "fk_company_aliases_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_backfill_journal" ADD CONSTRAINT "fk_company_backfill_journal_job" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_backfill_journal" ADD CONSTRAINT "fk_company_backfill_journal_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_capability_state" ADD CONSTRAINT "company_capability_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_history" ADD CONSTRAINT "fk_company_history_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_history" ADD CONSTRAINT "fk_company_history_related_company" FOREIGN KEY ("workspace_id","related_company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_company_assignment_history" ADD CONSTRAINT "fk_job_company_assignment_history_job" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_company_assignment_history" ADD CONSTRAINT "fk_job_company_assignment_history_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_company_assignment_history" ADD CONSTRAINT "fk_job_company_assignment_history_prior_company" FOREIGN KEY ("workspace_id","prior_company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_company_assignments" ADD CONSTRAINT "fk_job_company_assignments_job" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_company_assignments" ADD CONSTRAINT "fk_job_company_assignments_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_companies" ADD CONSTRAINT "workspace_companies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_companies" ADD CONSTRAINT "fk_workspace_companies_canonical" FOREIGN KEY ("workspace_id","merged_into_company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_company_aliases_company" ON "company_aliases" USING btree ("workspace_id","company_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_company_aliases_active_value" ON "company_aliases" USING btree ("company_id","normalized_value") WHERE "company_aliases"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_company_backfill_journal_company" ON "company_backfill_journal" USING btree ("workspace_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_company_history_sequence" ON "company_history" USING btree ("company_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_company_assignment_history_revision" ON "job_company_assignment_history" USING btree ("job_id","assignment_revision");--> statement-breakpoint
CREATE INDEX "idx_job_company_assignments_company" ON "job_company_assignments" USING btree ("workspace_id","company_id","job_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_companies_directory" ON "workspace_companies" USING btree ("workspace_id","normalized_display_name","id");--> statement-breakpoint
CREATE INDEX "idx_workspace_companies_status" ON "workspace_companies" USING btree ("workspace_id","status","normalized_display_name","id");