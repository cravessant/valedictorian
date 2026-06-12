# Valedictorian CLI Commands

## Invocation

Installed package:

```sh
valedictorian-cli --help
```

From the `valedictorian-cli` repository:

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/valedictorian.js --help
```

Set API configuration without exposing secrets:

```sh
export VALEDICTORIAN_API_URL=http://127.0.0.1:4317
export VALEDICTORIAN_API_TOKEN=...
```

Prefer inline env assignment for one-off commands when the token is already available in the shell:

```sh
VALEDICTORIAN_API_URL=http://127.0.0.1:4317 valedictorian-cli applications list --limit 25
```

## Discovery Commands

```sh
valedictorian-cli applications list --status needs_user_info --limit 25
valedictorian-cli applications list --search "backend intern" --sort company_asc --limit 25
valedictorian-cli applications get <application-id>
valedictorian-cli queue list --bucket apply_now --limit 25
valedictorian-cli runs list --run-type application --status running --limit 25
valedictorian-cli sourcing findings list --workflow-run-id <run-id> --merge-status new --limit 25
```

## Applications

Create an application with the required fields:

```sh
valedictorian-cli applications create \
  --company-name "Delta Labs" \
  --role-title "Software Engineering Intern" \
  --role-kind internship \
  --country US \
  --work-mode remote \
  --source-name "LinkedIn" \
  --status discovered
```

Useful optional create/update fields include `--city`, `--region`, `--term`, `--location-raw`, `--has-applied`, `--current-resume-variant`, `--initial-note`, `--primary-url`, `--primary-label`, `--primary-kind`, `--primary-external-id`, `--source-link-url`, `--source-kind`, `--source-label`, and `--source-external-id`.

Update common metadata:

```sh
valedictorian-cli applications update <application-id> --work-mode hybrid --city Denver --region CO
valedictorian-cli applications status <application-id> needs_user_info --notes "Waiting on transcript answer"
valedictorian-cli applications note <application-id> --message "User confirmed sponsorship answer."
valedictorian-cli applications archive <application-id> --note "Closed by company"
```

Links:

```sh
valedictorian-cli applications link add <application-id> --kind job_posting --label "Posting" --url "https://example.com/job" --primary
valedictorian-cli applications link update <application-id> <link-id> --label "Updated label" --primary
```

Attempts:

```sh
valedictorian-cli applications attempts list <application-id> --limit 25
valedictorian-cli applications attempts start <application-id> --actor-type agent --actor-name codex --entry-url "https://example.com/apply"
valedictorian-cli applications attempts step <application-id> <attempt-id> --type note --message "Opened application form"
valedictorian-cli applications attempts complete <application-id> <attempt-id> --outcome submitted --summary "Application submitted"
```

## Workflow Runs

```sh
valedictorian-cli runs start --run-type sourcing --actor-type agent --actor-name codex --source-name "LinkedIn"
valedictorian-cli runs step <run-id> --type note --message "Collected 12 candidates"
valedictorian-cli runs complete <run-id> --status completed --outcome success --summary "Sourcing run complete"
valedictorian-cli runs list --run-type sourcing --source-id <source-id> --limit 25
```

Use `--input-json`, `--metadata-json`, or `--payload-json` for structured data. Keep JSON compact and quote it for the shell:

```sh
valedictorian-cli runs step <run-id> --type data --message "Parsed candidate" --payload-json '{"company":"Delta Labs"}'
```

## Sourcing

Run a batch:

```sh
valedictorian-cli sourcing run --source-name "LinkedIn" --actor-name codex --candidates-json '[{"companyName":"Delta Labs","roleTitle":"Software Engineering Intern"}]'
```

Create, update, and promote findings:

```sh
valedictorian-cli sourcing findings create \
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

valedictorian-cli sourcing findings update <finding-id> --merge-status below_cutoff --merge-notes "Not enough fit"
valedictorian-cli sourcing findings promote <finding-id>
```

Optional finding-create flags include `--blocker`, `--city`, `--region`, `--term`, `--location-raw`, `--source-url`, `--discovered-at`, `--posted-age`, `--fit-notes`, `--duplicate-notes`, and `--merge-status`.

## Scores

```sh
valedictorian-cli scores record <application-id> \
  --score 8 \
  --band high \
  --role-relevance 8 \
  --career-signal 7 \
  --city-work-mode 9 \
  --compensation-logistics 7 \
  --rationale "Strong internship fit with remote option."
```
