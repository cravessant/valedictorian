CREATE TABLE "company_command_receipts" (
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"result_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "company_command_receipts_workspace_id_idempotency_key_pk" PRIMARY KEY("workspace_id","idempotency_key"),
	CONSTRAINT "chk_company_command_receipts_key" CHECK (length(btrim("company_command_receipts"."idempotency_key")) between 1 and 200),
	CONSTRAINT "chk_company_command_receipts_operation" CHECK ("company_command_receipts"."operation" in ('create','update','notes','alias_add','alias_update','alias_remove','archive','restore')),
	CONSTRAINT "chk_company_command_receipts_fingerprint" CHECK (length("company_command_receipts"."request_fingerprint") = 64),
	CONSTRAINT "chk_company_command_receipts_result" CHECK (length("company_command_receipts"."result_json") between 2 and 65536)
);
--> statement-breakpoint
ALTER TABLE "company_history" ADD COLUMN "alias_id" text;--> statement-breakpoint
ALTER TABLE "company_command_receipts" ADD CONSTRAINT "company_command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;