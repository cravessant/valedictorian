ALTER TABLE "company_command_receipts" DROP CONSTRAINT "chk_company_command_receipts_operation";--> statement-breakpoint
ALTER TABLE "company_duplicate_candidate_reviews" DROP CONSTRAINT "chk_company_duplicate_candidate_reviews_decision";--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD COLUMN "lower_resolved_snapshot_json" text;--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD COLUMN "higher_resolved_snapshot_json" text;--> statement-breakpoint
ALTER TABLE "company_command_receipts" ADD CONSTRAINT "chk_company_command_receipts_operation" CHECK ("company_command_receipts"."operation" in ('create','update','notes','alias_add','alias_update','alias_remove','archive','restore','reassign','mark_distinct','merge'));--> statement-breakpoint
ALTER TABLE "company_duplicate_candidate_reviews" ADD CONSTRAINT "chk_company_duplicate_candidate_reviews_decision" CHECK ("company_duplicate_candidate_reviews"."decision" in ('mark_distinct','merge'));--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD CONSTRAINT "chk_company_duplicate_candidates_resolved_snapshots" CHECK (("company_duplicate_candidates"."lower_resolved_snapshot_json" is null
          and "company_duplicate_candidates"."higher_resolved_snapshot_json" is null)
        or ("company_duplicate_candidates"."status" = 'resolved_by_merge'
          and length("company_duplicate_candidates"."lower_resolved_snapshot_json") between 2 and 4096
          and length("company_duplicate_candidates"."higher_resolved_snapshot_json") between 2 and 4096));