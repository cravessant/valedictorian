# Valedictorian CLI Commands

## Invocation

Installed package:

```sh
valedictorian-cli doctor
valedictorian-cli --help
```

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
```

The token line is a placeholder. Do not paste token literals into shared chat, shell history, logs, committed files, or persisted temp files.

Prefer inline env assignment for one-off commands when the token is already available in the shell:

```sh
VALEDICTORIAN_API_URL=http://127.0.0.1:4317 valedictorian-cli --json applications list --limit 25
```

Use JSON diagnostics for scripts or agent preflight checks:

```sh
valedictorian-cli --json doctor
valedictorian-cli --json doctor --skip-network
```

## Discovery Commands

```sh
valedictorian-cli --json applications list --status needs_user_info --limit 25
valedictorian-cli --json applications list --search "backend intern" --sort company_asc --limit 25
valedictorian-cli --json applications get <application-id>
valedictorian-cli --json queue list --bucket apply_now --limit 25
valedictorian-cli --json runs list --run-type application_attempt --status in_progress --limit 25
valedictorian-cli --json sourcing findings list --workflow-run-id <run-id> --merge-status new --limit 25
```

## Applications

Create an application with the required fields:

```sh
valedictorian-cli --json applications create \
  --company-name "Delta Labs" \
  --role-title "Software Engineering Intern" \
  --role-kind internship \
  --country US \
  --work-mode remote \
  --source-name "LinkedIn" \
  --status discovered \
  --primary-url "https://jobs.example.com/delta"
```

Useful optional create fields include `--city`, `--region`, `--term`, `--location-raw`, `--has-applied`, `--current-resume-variant`, `--initial-note`, `--primary-url`, `--primary-label`, `--primary-kind`, `--primary-external-id`, `--source-link-url`, `--source-kind`, `--source-label`, and `--source-external-id`.

Supported update fields are `--city`, `--country`, `--current-resume-variant`, `--has-applied`, `--location-raw`, `--region`, `--role-kind`, `--role-title`, `--term`, and `--work-mode`.

Update common metadata:

```sh
valedictorian-cli --json applications update <application-id> --work-mode hybrid --city Denver --region CO
valedictorian-cli --json applications status <application-id> needs_user_info --notes "Waiting on transcript answer"
valedictorian-cli --json applications note <application-id> --message "User confirmed sponsorship answer."
valedictorian-cli --json applications archive <application-id> --note "Closed by company"
```

Links:

```sh
valedictorian-cli --json applications link add <application-id> --kind job_posting --label "Posting" --url "https://example.com/job" --primary
valedictorian-cli --json applications link update <application-id> <link-id> --label "Updated label" --primary
```

Attempts:

Use `applications attempts` for the actual apply attempt lifecycle on an application. Use `runs --run-type application_attempt` when you need a broader workflow-run audit trail for agent work around that application.

```sh
valedictorian-cli --json applications attempts list <application-id> --limit 25
valedictorian-cli --json applications attempts start <application-id> --actor-type agent --actor-name automation-agent --entry-url "https://example.com/apply"
valedictorian-cli --json applications attempts step <application-id> <attempt-id> --type note --message "Opened application form"
valedictorian-cli --json applications attempts complete <application-id> <attempt-id> --outcome submitted --summary "Application submitted"
```

## Workflow Runs

```sh
valedictorian-cli --json runs start --run-type application_attempt --actor-type agent --actor-name automation-agent --subject-application-id <application-id> --summary "Started applying to queued application."
valedictorian-cli --json runs list --run-type application_attempt --status in_progress --subject-application-id <application-id> --limit 25
valedictorian-cli --json runs start --run-type sourcing --actor-type agent --actor-name automation-agent --source-name "LinkedIn"
valedictorian-cli --json runs step <run-id> --type note --message "Collected 12 candidates"
valedictorian-cli --json runs complete <run-id> --status completed --outcome success --summary "Sourcing run complete"
valedictorian-cli --json runs list --run-type sourcing --source-id <source-id> --limit 25
```

Use `--input-json`, `--metadata-json`, or `--payload-json` for structured data. Keep JSON compact and quote it for the shell:

```sh
valedictorian-cli --json runs step <run-id> --type data --message "Parsed candidate" --payload-json '{"company":"Delta Labs"}'
```

## Sourcing

Run a batch:

```sh
valedictorian-cli --json sourcing run --source-name "LinkedIn" --actor-name automation-agent --candidates-json '[{"companyName":"Delta Labs","roleTitle":"Software Engineering Intern"}]'
```

Create, update, and promote findings:

```sh
valedictorian-cli --json sourcing findings create \
  --workflow-run-id <run-id> \
  --source-name "LinkedIn" \
  --company-name "Delta Labs" \
  --role-title "Software Engineering Intern" \
  --role-kind internship \
  --work-mode remote \
  --country US \
  --official-url "https://jobs.example.com/delta" \
  --priority-score 7 \
  --priority-band high

valedictorian-cli --json sourcing findings update <finding-id> --merge-status below_cutoff --merge-notes "Not enough fit"
valedictorian-cli --json sourcing findings promote <finding-id>
```

Optional finding-create flags include `--blocker`, `--city`, `--region`, `--term`, `--location-raw`, `--source-url`, `--discovered-at`, `--posted-age`, `--fit-notes`, `--duplicate-notes`, and `--merge-status`.

## Scores

```sh
valedictorian-cli --json scores record <application-id> \
  --score 8 \
  --band high \
  --role-relevance 8 \
  --career-signal 7 \
  --city-work-mode 9 \
  --compensation-logistics 7 \
  --rationale "Strong internship fit with remote option."
```
