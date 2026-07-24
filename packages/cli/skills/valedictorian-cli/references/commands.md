# Valedictorian CLI Commands

## Contents

- Invocation and discovery
- Lifecycle commands
- Profile and secrets
- Connectors
- Workflow runs
- Scores

## Invocation

Installed package:

```sh
pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g @sparxie/valedictorian-cli@alpha
valedictorian-cli doctor
valedictorian-cli context
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
export VALEDICTORIAN_WORKSPACE=workspace-id-or-name
```

Do not paste token literals into shared chat, shell history, logs, committed files, or persisted temp files. Workspace-scoped commands require `--workspace <id-or-name>`.

## Discovery Commands

```sh
valedictorian-cli --json workspaces list
valedictorian-cli --json context
valedictorian-cli --json captures list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json jobs list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json opportunities list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json applications list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json applications attempts list <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json applications events list <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json action-queue list --workspace "$VALEDICTORIAN_WORKSPACE" --action-bucket apply_now --limit 25
valedictorian-cli --json connectors list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt
```

List and history filters use a strict JSON object:

```sh
valedictorian-cli --json jobs list --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"availability":"open","limit":25}'
valedictorian-cli --json applications history <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"limit":25}'
```

## Lifecycle Commands

The command groups mirror the `@sparxie/sdk@0.29.1` workspace client:

Read `lifecycle.md` for the meaning of each aggregate, the one-boundary-at-a-time promotion protocol, warning/blocker decisions, and lineage verification. Read `promotion-payloads.md` for complete alpha.18 JSON examples.

- `captures list|get|create|correct|remove|restore|history|promote-to-job|resolution list|get|retry|replay|complete`
- `companies capability|list|get|lookup|search|preview-matches|create|update|notes update|aliases add|update|remove|archive|restore|duplicates list|get|mark-distinct|merge|assigned-jobs list|history list`
- `jobs list|get|create|correct-facts|update-availability|company get|reassign|external-identities add|remove|remove|restore|history|promote-to-opportunity`
- `opportunities list|get|create|update-evaluation|update-disposition|remove|restore|history|promote-to-application`
- `applications list|get|create|update-status|update-company|update-source|links create|update|remove|refresh-snapshot|remove|restore|history|attempts list|events list`

### Capture Completion And Companies

`captures resolution complete <capture-id>`, retry, and replay require fresh exact revision and generation guards. Top-level positional IDs (`capture-id`, `company-id`, `job-id`, candidate ID, alias ID, and merge winner/loser) and `workspaceId` are injected by the CLI and must be omitted from input JSON. Keep required nested references such as `evidenceReferences.captureId`, duplicate target Job IDs, and destination/left/right Company IDs. Idempotency keys are immutable result keys: same command/workspace/key/input replays the saved snapshot, while the same key with different input is invalid. Resubmissions after a duplicate or stale response need a fresh key.

```sh
completion='{"expectedCaptureRevision":4,"expectedGenerationId":"generation-1","idempotencyKey":"complete-capture-1","actor":{"id":"user-1","type":"user"},"jobFacts":{"companyName":"Delta Labs","roleTitle":"Platform Engineer","sourceName":"Employer site","roleKind":"experienced","term":null,"terms":[],"timingMode":"unknown","startDate":null,"endDate":null,"location":null,"workMode":"remote","employmentType":"full_time","seniority":"mid","compensation":null,"postedAt":null,"destination":{"class":"employer_or_ats","url":"https://jobs.example.com/role"}},"destination":{"class":"employer_or_ats","url":"https://jobs.example.com/role"},"externalIdentities":[],"evidenceReferences":[{"captureId":"capture-1","captureRevision":4,"evidenceIndexes":[0]}],"companyResolution":{"action":"use_local","companyId":"company-1","expectedCompanyRevision":7,"restoreIfArchived":false}}'
valedictorian-cli --json captures resolution complete capture-1 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json "$completion"
printf '%s' "$completion" | jq '.idempotencyKey = "complete-capture-2" | .companyResolution = {"action":"create_local","displayName":"Delta Labs","websiteUrl":"https://delta.example.com"}' > completion-create-local.json
valedictorian-cli --json captures resolution complete capture-1 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json "$(<completion-create-local.json)"
printf '%s' "$completion" | jq '.idempotencyKey = "complete-capture-3" | .duplicateResolution = {"action":"attach","targetJobId":"018f0f2e-7b16-7a01-8c8c-20c6a9d52301","expectedJobFactsRevision":3,"expectedAssignmentRevision":2}' > completion-duplicate-retry.json
valedictorian-cli --json captures resolution complete capture-1 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json "$(<completion-duplicate-retry.json)"
valedictorian-cli --json captures resolution retry capture-1 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"expectedCaptureRevision":4,"expectedGenerationId":"generation-1","idempotencyKey":"retry-capture-1","actor":{"id":"user-1","type":"user"}}'
valedictorian-cli --json captures resolution replay capture-1 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"expectedCaptureRevision":4,"expectedGenerationId":"generation-1","idempotencyKey":"replay-capture-1","actor":{"id":"user-1","type":"user"},"rationale":"Replay after provider repair."}'
```

Company write inputs omit `workspaceId`; Company search defaults to active records, while `active_and_archived` is only for explicit restore recovery. Refresh the returned candidate, Company, and assignment revisions before each mutation.

```sh
valedictorian-cli --json companies create --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"actor":{"id":"user-1","type":"user"},"rationale":"Verified careers site.","idempotencyKey":"company-create-1","displayName":"Delta Labs","websiteUrl":"https://delta.example.com","notes":""}'
valedictorian-cli --json companies update company-1 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"actor":{"id":"user-1","type":"user"},"rationale":"Legal name verified.","idempotencyKey":"company-update-1","expectedCompanyRevision":7,"displayName":"Delta Labs, Inc."}'
valedictorian-cli --json companies archive company-1 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"actor":{"id":"user-1","type":"user"},"rationale":"No longer active.","idempotencyKey":"company-archive-1","expectedCompanyRevision":8}'
valedictorian-cli --json companies restore company-1 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"actor":{"id":"user-1","type":"user"},"rationale":"Restore after review.","idempotencyKey":"company-restore-1","expectedCompanyRevision":9}'
valedictorian-cli --json companies search --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"query":"delta"}'
valedictorian-cli --json companies search --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"query":"delta","scope":"active_and_archived"}'
valedictorian-cli --json companies duplicates mark-distinct candidate-1 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"actor":{"id":"user-1","type":"user"},"rationale":"Different employers.","idempotencyKey":"distinct-1","expectedCandidateRevision":2,"leftCompanyId":"company-1","expectedLeftCompanyRevision":7,"rightCompanyId":"company-2","expectedRightCompanyRevision":3}'
valedictorian-cli --json jobs company reassign 018f0f2e-7b16-7a01-8c8c-20c6a9d52301 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"actor":{"id":"user-1","type":"user"},"rationale":"Correct grouping.","idempotencyKey":"reassign-job-1","expectedAssignmentRevision":2,"destinationCompanyId":"company-1","expectedDestinationCompanyRevision":7}'
valedictorian-cli --json companies duplicates merge company-1 company-2 --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"actor":{"id":"user-1","type":"user"},"rationale":"Same employer.","idempotencyKey":"merge-companies-1","expectedWinnerCompanyRevision":7,"expectedLoserCompanyRevision":3,"loserDisplayNameConfirmation":"Delta Laboratories","acknowledgeNoUndo":true}'
```

Manual Company merge is irreversible: the command has no split or undo and requires the positional explicit winner, current winner/loser revisions, exact loser display name, and `acknowledgeNoUndo: true`.

Create a capture with explicit provenance and Evidence mode:

```sh
valedictorian-cli --json captures create \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --evidence-mode reported \
  --adapter-id valedictorian-cli \
  --adapter-kind cli \
  --adapter-version 0.1.0 \
  --observed-at 2026-07-21T18:00:00.000Z \
  --payload-json '{"url":"https://jobs.example.com/role"}' \
  --evidence-json '[{"kind":"url","label":"posting","value":"https://jobs.example.com/role"}]'
```

`--adapter-kind` accepts the contract kinds `manual`, `import`, `connector`, and `cli`. `--evidence-mode` accepts `reported` and `ats_details_provided`. Optional `--provider-record-id`, `--provider-schema`, `--payload-json`, and `--evidence-json` preserve the corresponding capture fields.

Complex mutations accept the complete contract-owned payload through `--input-json`; omit the positional resource id from that object:

```sh
valedictorian-cli --json captures correct <capture-id> --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<CorrectCaptureInput>'
valedictorian-cli --json jobs create --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<CreateJobInput>'
valedictorian-cli --json jobs correct-facts <job-id> --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<CorrectJobFactsInput without jobId>'
valedictorian-cli --json jobs update-availability <job-id> --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<UpdateJobAvailabilityInput without jobId>'
valedictorian-cli --json jobs external-identities add <job-id> --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<AddJobExternalIdentityInput without jobId>'
valedictorian-cli --json jobs external-identities remove <job-id> --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<RemoveJobExternalIdentityInput without jobId>'
valedictorian-cli --json opportunities create --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<CreateOpportunityInput>'
valedictorian-cli --json applications create --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<CreateApplicationInput>'
valedictorian-cli --json applications update-status <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<UpdatePursuitApplicationStatusInput without applicationId>'
valedictorian-cli --json applications links create <application-id> --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<CreatePursuitLinkInput without applicationId>'
```

Promotion JSON supplies the complete input except the positional source id. These flags can explicitly override common promotion fields:

```sh
valedictorian-cli --json captures promote-to-job <capture-id> \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '<PromoteCaptureToJobInput without captureId>' \
  --idempotency-key <key> \
  --override-actor-id <id> \
  --override-actor-type user \
  --override-rationale "Reviewed the warnings." \
  --override-warning-codes-json '["fit","rank"]' \
  --duplicate-action attach \
  --duplicate-target-id <job-id>

valedictorian-cli --json jobs promote-to-opportunity <job-id> --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<PromoteJobToOpportunityInput without jobId>'
valedictorian-cli --json opportunities promote-to-application <opportunity-id> --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '<PromoteOpportunityToApplicationInput without opportunityId>'
```

`--duplicate-action` accepts `attach` or `merge` and requires `--duplicate-target-id`. Override flags must supply actor id/type, rationale, and a JSON array of warning codes together. JSON output retains the complete discriminated result, including warnings, blockers, override evidence, and duplicate resolution.

Remove and restore commands make the actor and rationale explicit. Remove also requires one deterministic dependent-resource choice:

```sh
valedictorian-cli --json jobs remove <job-id> --workspace "$VALEDICTORIAN_WORKSPACE" --choice reject_if_dependents --actor-id <id> --actor-type user --rationale "No longer active."
valedictorian-cli --json jobs restore <job-id> --workspace "$VALEDICTORIAN_WORKSPACE" --actor-id <id> --actor-type user --rationale "Restoring after review."
```

Removal choices are `reject_if_dependents`, `preserve_historical_lineage`, `unlink_dependents`, and `cascade_tombstone`. Inspect the returned blocker, supported choices, and dependent ids before retrying a blocked removal.

## Profile And Secrets

```sh
valedictorian-cli --json profile get --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile agent-context --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile update --workspace "$VALEDICTORIAN_WORKSPACE" --input-json profile.json --expected-revision <revision>
valedictorian-cli --json profile validate --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile format --workspace "$VALEDICTORIAN_WORKSPACE" --expected-revision <revision>
valedictorian-cli --json profile restore --workspace "$VALEDICTORIAN_WORKSPACE" --expected-revision <revision|null> --confirm
```

SSN and credential values stay on the secret path, not the ordinary document. Typed document errors keep their exact codes in human and JSON modes; mutations never retry conflicts.

```sh
valedictorian-cli --json secrets list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json secrets upsert provider_password --workspace "$VALEDICTORIAN_WORKSPACE" --kind password --label "Provider password" --value-file "$SECRET_VALUE_FILE"
valedictorian-cli --json secrets delete provider_password --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli secrets run --workspace "$VALEDICTORIAN_WORKSPACE" \
  --env TOKEN=secret://provider_password \
  --stdin-secret secret://other_key \
  --fd 3=secret://fd_key \
  -- some-tool --flag value
```

`secrets run` validates structured references and injects values only into explicit destinations for a direct child spawn. This reduces accidental disclosure rather than providing a same-user sandbox boundary. Do not substitute secrets into argv or persist them in routine temp files.

## Connectors

```sh
valedictorian-cli --json connectors list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json connectors status <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json connectors configure <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE" --enabled true --earliest-backfill-date 2026-04-01 --filters-json '{"search":"software internship"}'
valedictorian-cli --json connectors schedules upsert <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE" --expected-revision null --state enabled --cadence-json '{"kind":"daily","localTime":"09:00"}' --timezone America/New_York
valedictorian-cli --json connectors runs list <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE" --status queued --limit 25
valedictorian-cli --json connectors observations list <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE" --connector-run-id <connector-run-id> --limit 25
valedictorian-cli --json connectors trigger <connector-instance-id> --workspace "$VALEDICTORIAN_WORKSPACE" --mode manual --filter-signature "filters:{}" --filters-json '{}'
```

Connector commands remain source-agnostic. Provider-specific authentication, browsing, link resolution, refresh execution, and upsert logic stay outside the CLI.

## Workflow Runs

```sh
valedictorian-cli --json runs start --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt --actor-type agent --actor-name automation-agent --subject-application-id <application-id> --summary "Started application workflow."
valedictorian-cli --json runs step <run-id> --workspace "$VALEDICTORIAN_WORKSPACE" --type note --message "Collected application evidence"
valedictorian-cli --json runs complete <run-id> --workspace "$VALEDICTORIAN_WORKSPACE" --status completed --outcome success --summary "Workflow complete"
valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt --status in_progress --limit 25
```

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
  --rationale "Strong fit with remote option."
```
