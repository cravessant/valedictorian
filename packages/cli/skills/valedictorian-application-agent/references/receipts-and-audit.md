# Receipts And Audit

Read this before starting, resuming, stepping, or completing Valedictorian application attempts or workflow runs.

## State Boundary

- Load and follow the `valedictorian-cli` skill before running commands.
- Use `applications attempts` for the concrete application attempt lifecycle.
- Use `runs --run-type application_attempt` for the broader agent audit trail.
- Do not complete an attempt from memory. Re-read the relevant attempt/run/application after mutations.
- Do not write directly to workspace databases or use ad hoc HTTP to patch state.

## Preflight Reads

Use the CLI skill for exact syntax and target safety. Typical reads are:

```sh
valedictorian-cli --json context
valedictorian-cli --json doctor --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json action-queue list --workspace "$VALEDICTORIAN_WORKSPACE" --action-bucket apply_now --limit 25
```

For a selected application:

```sh
valedictorian-cli --json applications get <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json applications attempts list <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --limit 25
valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt --subject-application-id <application-id> --limit 25
valedictorian-cli --json profile agent-context --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json secrets list --workspace "$VALEDICTORIAN_WORKSPACE"
```

Use populated DOB and self-identification facts from agent context when present; never invent missing facts. Credential secret summaries belong in normal agent context only as availability metadata. Keep SSN and credentials on the secret path. Prefer `secrets run` with `secret://` references when a trusted local child needs a credential; do not write values into temp files, argv, chat, or logs.

## Starting Or Resuming Work

- If a matching in-progress attempt/run exists, resume it or explain why a new one is required.
- Start the run and attempt before external browser work.
- Include the external entry URL when starting the attempt.

```sh
valedictorian-cli --json runs start --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt --actor-type agent --actor-name <agent-name> --subject-application-id <application-id> --summary "Started application agent work."
valedictorian-cli --json applications attempts start <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --actor-type agent --actor-name <agent-name> --entry-url "<url>"
```

Record cross-reference details as a run step if the response ids are not otherwise linked.

## Attempt Steps

Use only valid attempt step types:

- `attempt_started`
- `resume_created`
- `resume_uploaded`
- `page_verified`
- `verification_receipt`
- `manual_review_hold_created`
- `blocked`
- `submitted`
- `confirmation_verified`
- `attempt_completed`
- `note`

Use attempt steps for durable facts that should survive handoff: resume uploaded, page verified, manual-review hold created, blocker reached, final verification, submission, and confirmation verified. Use run steps for navigation notes, retry details, policy decisions, diagnostics, and non-secret evidence.

## Verification Receipt

Before completing an attempt as `submitted`, add a passed `verification_receipt` step. The payload must summarize what was verified and what remains unresolved.

```sh
valedictorian-cli --json applications attempts step <application-id> <attempt-id> --workspace "$VALEDICTORIAN_WORKSPACE" --type verification_receipt --message "Final review verification passed." --payload-json '{"version":1,"scope":"final_review","status":"passed","verified":["identity","contact_info","resume_attachment","work_authorization"],"unresolved":[],"evidence":"Final review screen matched the intended application payload before submit."}'
```

Good evidence includes confirmation-page text, confirmation URL, portal dashboard status, receipt email sender/subject/time, screenshot path when available, and the exact material fields verified. Do not include secret values or raw sensitive values.

## Completing Attempts

Submitted attempts need confirmation evidence:

```sh
valedictorian-cli --json applications attempts complete <application-id> <attempt-id> --workspace "$VALEDICTORIAN_WORKSPACE" --outcome submitted --summary "Application submitted." --confirmation-url "<url>" --confirmation-text "<text>"
```

`ready_for_review` requires hold metadata:

```sh
valedictorian-cli --json applications attempts complete <application-id> <attempt-id> --workspace "$VALEDICTORIAN_WORKSPACE" --outcome ready_for_review --hold-started-at "<iso timestamp>" --manual-review-kind overridable --summary "Filled and verified for review."
```

Use `--manual-review-kind non_overridable` when policy requires explicit per-application approval.

`needs_user_info` requires the missing information:

```sh
valedictorian-cli --json applications attempts complete <application-id> <attempt-id> --workspace "$VALEDICTORIAN_WORKSPACE" --outcome needs_user_info --missing-user-info "<question or fact needed>" --summary "Required answer is missing."
```

Blocker outcomes require `--blocker-reason`: `manual_captcha`, `security_gate`, `login_needed`, `platform_error`, `closed`, `not_fit`, and `not_pursued`.

Complete the workflow run with `--status completed` for resolved outcomes, or `--status failed` when the agent failed unexpectedly. Include `--outcome` and `--blocker` when useful for audit readers.

## Mutation Verification

After every mutation, re-read the smallest affected record:

```sh
valedictorian-cli --json applications attempts list <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --limit 25
valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt --subject-application-id <application-id> --limit 25
valedictorian-cli --json applications get <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
```

If verification disagrees with the mutation response, stop and report the mismatch. Do not retry mutations blindly.
