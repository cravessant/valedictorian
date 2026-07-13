# Valedictorian CLI Commands

## Invocation

Installed package:

```sh
pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g valedictorian-cli@alpha
valedictorian-cli doctor
valedictorian-cli context
valedictorian-cli --help
```

The package is currently published under the npm `alpha` dist-tag. The explicit
registry avoids stale private registry caches; the release-age override is for
fresh alpha installs. Untagged global installs can resolve to an older
prerelease.

From the `valedictorian-cli` repository:

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/valedictorian.js doctor
node dist/valedictorian.js --help
```

Set API configuration without exposing secrets:

```sh
export VALEDICTORIAN_API_URL=http://127.0.0.1:4317
export VALEDICTORIAN_API_TOKEN=...
export VALEDICTORIAN_WORKSPACE=workspace-id-or-name
```

The token line is a placeholder. Do not paste token literals into shared chat, shell history, logs, committed files, or persisted temp files.

Prefer inline env assignment for one-off commands when the token is already available in the shell:

```sh
VALEDICTORIAN_API_URL=http://127.0.0.1:4317 valedictorian-cli --json applications list --workspace "$VALEDICTORIAN_WORKSPACE" --limit 25
```

Use JSON diagnostics for scripts or agent preflight checks:

```sh
valedictorian-cli --json doctor
valedictorian-cli --json doctor --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --workspace "$VALEDICTORIAN_WORKSPACE" --json doctor
valedictorian-cli --json doctor --skip-network
valedictorian-cli --json context
```

## Discovery Commands

```sh
valedictorian-cli --json workspaces list
valedictorian-cli --json context
valedictorian-cli --json applications list --workspace "$VALEDICTORIAN_WORKSPACE" --status needs_user_info --limit 25
valedictorian-cli --json applications list --workspace "$VALEDICTORIAN_WORKSPACE" --search "backend intern" --sort company_asc --limit 25
valedictorian-cli --json applications get <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json action-queue list --workspace "$VALEDICTORIAN_WORKSPACE" --action-bucket apply_now --limit 25
valedictorian-cli --json connectors list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json connectors status <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json connectors runs list <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE" --limit 25
valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt --status in_progress --limit 25
valedictorian-cli --json sourcing findings list --workspace "$VALEDICTORIAN_WORKSPACE" --workflow-run-id <run-id> --merge-status new --limit 25
valedictorian-cli --json profile get --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile sensitive summary --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile secrets list --workspace "$VALEDICTORIAN_WORKSPACE"
```

## Profile And Secrets

Non-sensitive profile:

```sh
valedictorian-cli --json profile get --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile agent-context --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile update --workspace "$VALEDICTORIAN_WORKSPACE" --input-json profile.json
```

`profile update` expects a JSON object matching the public profile input shape. This is intended for basics, education, and reusable answer-bank entries, not credential values or sensitive profile facts.

Sensitive profile details:

```sh
valedictorian-cli --json profile sensitive update --workspace "$VALEDICTORIAN_WORKSPACE" --input-json sensitive-profile.json
valedictorian-cli --json profile sensitive summary --workspace "$VALEDICTORIAN_WORKSPACE"
```

`profile sensitive update` writes DOB parts, SSN last four, demographics, veteran status, disability status, and similar sensitive facts. Both `update` and `summary` print only `{ populatedFieldCount, populatedFields }`, not raw sensitive values.

Credential secrets:

```sh
valedictorian-cli --json profile secrets list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile secrets upsert greenhouse_password --workspace "$VALEDICTORIAN_WORKSPACE" --kind password --label "Greenhouse password" --value-file "$SECRET_VALUE_FILE"
valedictorian-cli --json profile secrets delete greenhouse_password --workspace "$VALEDICTORIAN_WORKSPACE"
```

Supported secret kinds are `password`, `token`, `identity`, and `other`. `profile secrets upsert` reads the exact contents of `--value-file` and returns only the non-secret summary. Prefer a `mktemp` file outside the repo for one-off migration values, remove it immediately after the command, and avoid shell history, logs, chat, and committed files for plaintext secrets.

## Applications

Create an application with the required fields:

```sh
valedictorian-cli --json applications create \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --company-name "Delta Labs" \
  --role-title "Software Engineering Intern" \
  --role-kind internship \
  --country US \
  --work-mode remote \
  --source-name "LinkedIn" \
  --status queued \
  --primary-url "https://jobs.example.com/delta"
```

Useful optional create fields include `--city`, `--region`, `--term`, `--terms-json`, `--start-date`, `--end-date`, `--location-raw`, `--has-applied`, `--current-resume-variant`, `--initial-note`, `--primary-url`, `--primary-label`, `--primary-kind`, `--primary-external-id`, `--source-link-url`, `--source-kind`, `--source-label`, and `--source-external-id`.

Supported update fields are `--city`, `--country`, `--current-resume-variant`, `--has-applied`, `--location-raw`, `--region`, `--role-kind`, `--role-title`, `--term`, `--terms-json`, `--start-date`, `--end-date`, and `--work-mode`.

Update common metadata:

```sh
valedictorian-cli --json applications update <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --work-mode hybrid --city Denver --region CO
valedictorian-cli --json applications status <application-id> needs_user_info --workspace "$VALEDICTORIAN_WORKSPACE" --notes "Waiting on transcript answer"
valedictorian-cli --json applications note <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --message "User confirmed sponsorship answer."
valedictorian-cli --json applications archive <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --note "Closed by company"
```

Links:

```sh
valedictorian-cli --json applications link add <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --kind job_posting --label "Posting" --url "https://example.com/job" --primary
valedictorian-cli --json applications link update <application-id> <link-id> --workspace "$VALEDICTORIAN_WORKSPACE" --label "Updated label" --primary
```

Attempts:

Use `applications attempts` for the actual apply attempt lifecycle on an application. Use `runs --run-type application_attempt` when you need a broader workflow-run audit trail for agent work around that application.

```sh
valedictorian-cli --json applications attempts list <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --limit 25
valedictorian-cli --json applications attempts start <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --actor-type agent --actor-name automation-agent --entry-url "https://example.com/apply"
valedictorian-cli --json applications attempts step <application-id> <attempt-id> --workspace "$VALEDICTORIAN_WORKSPACE" --type note --message "Opened application form"
valedictorian-cli --json applications attempts step <application-id> <attempt-id> --workspace "$VALEDICTORIAN_WORKSPACE" --type verification_receipt --message "Final review verification passed." --payload-json '{"version":1,"scope":"final_review","status":"passed","verified":["identity","contact_info","resume_attachment","work_authorization"],"unresolved":[],"evidence":"Final review screen matched the intended application payload before submit."}'
valedictorian-cli --json applications attempts complete <application-id> <attempt-id> --workspace "$VALEDICTORIAN_WORKSPACE" --outcome submitted --summary "Application submitted"
```

For the full submitted-attempt safety sequence, run:

```sh
valedictorian-cli examples attempts complete --outcome submitted
```

## Connectors

Connector commands are workspace-scoped and source-agnostic. Pass connector instance ids from `connectors list`; the CLI does not contain InternList, Jobright, or adapter-specific logic.

```sh
valedictorian-cli --json connectors list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json connectors status <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json connectors configure <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE" --enabled true --earliest-backfill-date 2026-04-01 --filters-json '{"search":"software internship"}'
valedictorian-cli --json connectors schedules upsert <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE" --expected-revision null --state enabled --cadence-json '{"kind":"daily","localTime":"09:00"}' --timezone America/New_York
valedictorian-cli --json connectors runs list <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE" --status queued --limit 25
valedictorian-cli --json connectors observations list <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE" --connector-run-id <connector-run-id> --limit 25
valedictorian-cli --json connectors trigger <connector-instance-id> \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --mode manual \
  --filter-signature "filters:{}" \
  --filters-json '{}'
```

`connectors trigger` advances continuous synchronization through the app/backend contract. It does not request a result count or fixed batch. Adapter-specific auth, link resolution, refresh execution, and upsert logic remain outside the CLI.

## Workflow Runs

```sh
valedictorian-cli --json runs start --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt --actor-type agent --actor-name automation-agent --subject-application-id <application-id> --summary "Started applying to queued application."
valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt --status in_progress --subject-application-id <application-id> --limit 25
valedictorian-cli --json runs start --workspace "$VALEDICTORIAN_WORKSPACE" --run-type sourcing --actor-type agent --actor-name automation-agent --source-name "LinkedIn"
valedictorian-cli --json runs step <run-id> --workspace "$VALEDICTORIAN_WORKSPACE" --type note --message "Collected 12 candidates"
valedictorian-cli --json runs complete <run-id> --workspace "$VALEDICTORIAN_WORKSPACE" --status completed --outcome success --summary "Sourcing run complete"
valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE" --run-type sourcing --source-id <source-id> --limit 25
```

Use `--input-json`, `--metadata-json`, or `--payload-json` for structured data. Keep JSON compact and quote it for the shell:

```sh
valedictorian-cli --json runs step <run-id> --workspace "$VALEDICTORIAN_WORKSPACE" --type data --message "Parsed candidate" --payload-json '{"company":"Delta Labs"}'
```

## Sourcing

Capture one sparse URL observation. Company, title, and canonical enums are not required:

```sh
valedictorian-cli --json sourcing ingest \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --url "https://jobs.example.com/delta" \
  --observed-at "2026-07-12T12:00:00.000Z" \
  --provider-record-id "job-123" \
  --origin-kind job_board \
  --origin-name "Example Board"
```

Capture an atomic batch. Entries are raw inputs and must not contain `adapter` or `capture`; the CLI injects its package-versioned adapter provenance:

```sh
valedictorian-cli --json sourcing ingest \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --batch-json '[{"observedAt":"2026-07-12T12:00:00.000Z","payload":{"url":"https://jobs.example.com/one"}},{"observedAt":"2026-07-12T12:01:00.000Z","reportedOrigin":{"kind":"ats","name":"Example ATS"},"payload":{"url":"https://ats.example.com/two"}}]'
```

The response keeps four distinct sections per receipt: `submitted` echoes the CLI-injected adapter and caller-reported origin (it is not an independent persisted readback), `intake` contains the immutable revision/occurrence receipt, `normalization` contains current gate/candidate data and an explicit revision-match indicator, and `projection` contains the exact revision-addressed result. Inspection envelopes contain `result` on success or `result: null` plus a bounded `error` on lookup failure. A successful capture is still printed if inspection fails; `inspectionFailureCount` is nonzero and the command exits nonzero after output. Natural URLs and intermediary links are normalized only by the server. A Jobright intermediary can remain `pending` or `blocked`; the CLI does not authenticate providers, browse pages, resolve URLs, normalize enums, or apply fit policy.

Manage existing sourcing findings separately:

```sh
valedictorian-cli --json sourcing findings list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json sourcing findings decide <finding-id> --workspace "$VALEDICTORIAN_WORKSPACE" --merge-status not_fit --merge-notes "Not enough fit"
valedictorian-cli --json sourcing findings decide <finding-id> --workspace "$VALEDICTORIAN_WORKSPACE" --merge-status blocked --disposition-reason "Needs user decision" --policy-blocker needs_user_decision
valedictorian-cli --json sourcing findings update <finding-id> --workspace "$VALEDICTORIAN_WORKSPACE" --merge-notes "Refined merge note"
valedictorian-cli --json sourcing findings promote <finding-id> --workspace "$VALEDICTORIAN_WORKSPACE"
```

Supported finding-update fields include `--term`, `--terms-json`, `--start-date`, `--end-date`, `--blocker`, `--disposition-reason`, `--duplicate-notes`, `--merge-notes`, `--merge-status`, and `--policy-blocker`.
Use `sourcing findings decide` for manual dispositions. `duplicateNotes` is generated by duplicate detection; manual hard-rule or user-decision semantics belong in `--disposition-reason` and, for blocked findings, `--policy-blocker`. Direct `applications create` remains available for already-canonical applications; sourcing ingestion owns raw observations and the server-projected findings queue.

## Scores

```sh
valedictorian-cli --json scores record <application-id> \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --score 8 \
  --band high \
  --role-relevance 8 \
  --career-signal 7 \
  --city-work-mode 9 \
  --compensation-logistics 7 \
  --rationale "Strong internship fit with remote option."
```
