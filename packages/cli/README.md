# valedictorian-cli

Command-line client for Valedictorian.

## Install

```sh
pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g @sparxie/valedictorian-cli@alpha
```

The CLI is currently published under the npm `alpha` dist-tag.

## Agent skills

The repository publishes two skills from its default branch: `valedictorian-cli` for canonical lifecycle operations and `valedictorian-application-agent` for browser-based work on an existing Application.

Install them explicitly for Codex through `npx skills`:

```sh
npx --yes skills add cravessant/valedictorian \
  --global \
  --agent codex \
  --skill valedictorian-cli \
  --skill valedictorian-application-agent \
  --yes

npx skills list --global --agent codex --json
```

The repository is private, so the installing user must already have GitHub access. Start a fresh Codex task after installation so its skill catalog reloads.

The lifecycle skills require the alpha.18 command surface. Verify `valedictorian-cli captures --help`; if the installed npm `alpha` lacks that group, use a current local build or wait for the matching CLI release instead of substituting legacy sourcing commands.

## Usage

Point the CLI at a running Valedictorian API, then pass a workspace id or exact workspace name for workspace-scoped commands.

```sh
export VALEDICTORIAN_API_URL=http://127.0.0.1:4317
export VALEDICTORIAN_API_TOKEN=your-token
export VALEDICTORIAN_WORKSPACE=workspace-id-or-name

valedictorian-cli doctor
valedictorian-cli --json context
valedictorian-cli --json workspaces list
valedictorian-cli --json captures list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json jobs list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json opportunities list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json applications list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json action-queue list --workspace "$VALEDICTORIAN_WORKSPACE" --action-bucket apply_now
valedictorian-cli --json profile get --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile validate --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile format --workspace "$VALEDICTORIAN_WORKSPACE" --expected-revision <revision>
valedictorian-cli --json profile restore --workspace "$VALEDICTORIAN_WORKSPACE" --expected-revision <revision|null> --confirm
valedictorian-cli --json secrets list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli secrets run --workspace "$VALEDICTORIAN_WORKSPACE" --env TOKEN=secret://greenhouse_password -- some-tool --flag
```

The lifecycle command tree mirrors `@sparxie/sdk@0.36.0`:

- `captures`: `list`, `get`, `create`, `correct`, `remove`, `restore`, `history`, `promote-to-job`, `resolution list|get|retry|replay|complete`
- `companies`: `list`, `get`, `lookup`, `search`, `preview-matches`, `create`, `update`, `notes update`, `aliases add|update|remove`, `archive`, `restore`, `duplicates list|get|mark-distinct|merge`, `assigned-jobs list`, `history list`
- `jobs`: `list`, `get`, `create`, `correct-facts`, `update-availability`, `company get|reassign`, `external-identities add|remove`, `remove`, `restore`, `history`, `promote-to-opportunity`
- `opportunities`: `list`, `get`, `create`, `update-evaluation`, `update-disposition`, `remove`, `restore`, `history`, `promote-to-application`
- `applications`: `list`, `get`, `create`, `update-status`, `update-company`, `update-source`, `links create|update|remove`, `refresh-snapshot`, `remove`, `restore`, `history`, `attempts list`, `events list`

Complex contract-owned inputs use strict JSON. The positional resource id is supplied by the command and must be omitted from `--input-json`. Company writes also derive `workspaceId` from `--workspace`; omit it from the JSON input.

### Lifecycle paging

Capture, Job, Opportunity, and Application `list` and `history`, plus `applications attempts list` and `applications events list`, page by boundary cursor. Pass `{"after":"<endCursor>"}` to continue forward or `{"before":"<startCursor>"}` to continue backward; the two are mutually exclusive and supplying both is a usage error. Omitting both requests the first page. `limit` accepts 1 to 200 and defaults to 50.

```sh
valedictorian-cli --json jobs list --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"availability":"open","limit":25}'
valedictorian-cli --json jobs list --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"availability":"open","limit":25,"after":"<endCursor>"}'
valedictorian-cli --json jobs list --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"availability":"open","limit":25,"before":"<startCursor>"}'
```

JSON output preserves `pageInfo` exactly: `startCursor`, `endCursor`, `hasPreviousPage`, and `hasNextPage`. Human output prints `Previous cursor: <startCursor>` only when a previous page exists, `Next cursor: <endCursor>` only when a next page exists, and `End of results.` when neither does.

Capture resolution commands preserve exact Capture revision, generation, evidence, and idempotency guards. `companies search` is active-only by default; use `{"scope":"active_and_archived"}` only for explicit archived recovery. `companies duplicates merge <winner-company-id> <loser-company-id>` additionally requires current revisions, the exact loser display-name confirmation, and `acknowledgeNoUndo: true` in its input JSON.

### Capture completion and Company maintenance

Top-level command-target IDs supplied positionally are injected and must be omitted from `--input-json`: Capture ID, Company ID, duplicate candidate ID, Job ID, alias ID, and merge winner/loser IDs. `workspaceId` is derived from `--workspace` and must also be omitted from input JSON. Keep nested contract references such as `evidenceReferences.captureId`, duplicate-decision target Job ID, and destination/left/right Company IDs. An idempotency key is immutable: repeating the same command name, workspace, key, and canonical input returns its saved result; reuse with a different input is invalid. Use a fresh key when resubmitting after a duplicate or stale recovery.

Completion is atomic. Start from fresh `captures resolution get` detail and preserve its exact revision, generation, and evidence references:

```sh
completion='{
  "expectedCaptureRevision": 4,
  "expectedGenerationId": "generation-1",
  "idempotencyKey": "complete-capture-1",
  "actor": {"id": "user-1", "type": "user"},
  "jobFacts": {
    "companyName": "Delta Labs", "roleTitle": "Platform Engineer", "sourceName": "Employer site",
    "roleKind": "experienced", "term": null, "terms": [], "timingMode": "unknown",
    "startDate": null, "endDate": null, "location": null, "workMode": "remote",
    "employmentType": "full_time", "seniority": "mid", "compensation": null, "postedAt": null,
    "destination": {"class": "employer_or_ats", "url": "https://jobs.example.com/role"}
  },
  "destination": {"class": "employer_or_ats", "url": "https://jobs.example.com/role"},
  "externalIdentities": [],
  "evidenceReferences": [{"captureId": "capture-1", "captureRevision": 4, "evidenceIndexes": [0]}],
  "companyResolution": {
    "action": "use_local", "companyId": "company-1", "expectedCompanyRevision": 7,
    "restoreIfArchived": false
  }
}'
valedictorian-cli --json captures resolution complete capture-1 \
  --workspace "$VALEDICTORIAN_WORKSPACE" --input-json "$completion"
```

For a new local Company, replace `companyResolution` with `{"action":"create_local","displayName":"Delta Labs","websiteUrl":"https://delta.example.com"}`. If completion returns `duplicate_blocked`, inspect every returned revision, then resubmit the same validated draft with a fresh key and explicit decision:

```sh
printf '%s' "$completion" | jq \
  '.idempotencyKey = "complete-capture-2" | .duplicateResolution = {
    "action": "attach", "targetJobId": "018f0f2e-7b16-7a01-8c8c-20c6a9d52301",
    "expectedJobFactsRevision": 3, "expectedAssignmentRevision": 2
  }' > completion-retry.json
valedictorian-cli --json captures resolution complete capture-1 \
  --workspace "$VALEDICTORIAN_WORKSPACE" --input-json "$(<completion-retry.json)"
```

Retry and replay always name the current Capture revision and generation; replay also requires a rationale. The API refuses promoted Captures with a typed nonzero result.

```sh
valedictorian-cli --json captures resolution retry capture-1 --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '{"expectedCaptureRevision":4,"expectedGenerationId":"generation-1","idempotencyKey":"retry-capture-1","actor":{"id":"user-1","type":"user"}}'
valedictorian-cli --json captures resolution replay capture-1 --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '{"expectedCaptureRevision":4,"expectedGenerationId":"generation-1","idempotencyKey":"replay-capture-1","actor":{"id":"user-1","type":"user"},"rationale":"Replay after provider repair."}'
```

Company writes receive `workspaceId` from `--workspace`; never include it in the JSON. Search is active-only by default, while archived recovery is explicit:

```sh
company_write='{"actor":{"id":"user-1","type":"user"},"rationale":"Verified careers site.","idempotencyKey":"company-write-1"}'
valedictorian-cli --json companies create --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json "$(printf '%s' "$company_write" | jq '. + {displayName:"Delta Labs",websiteUrl:"https://delta.example.com",notes:""}')"
valedictorian-cli --json companies update company-1 --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json "$(printf '%s' "$company_write" | jq '. + {expectedCompanyRevision:7,displayName:"Delta Labs, Inc."}')"
valedictorian-cli --json companies archive company-1 --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json "$(printf '%s' "$company_write" | jq '. + {expectedCompanyRevision:8}')"
valedictorian-cli --json companies restore company-1 --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json "$(printf '%s' "$company_write" | jq '. + {expectedCompanyRevision:9}')"
valedictorian-cli --json companies search --workspace "$VALEDICTORIAN_WORKSPACE" --input-json '{"query":"delta"}'
valedictorian-cli --json companies search --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '{"query":"delta","scope":"active_and_archived"}'
```

Mark a reviewed candidate distinct, reassign a current Job, or merge only after refreshing every shown revision. Merge has no undo or split command.

```sh
valedictorian-cli --json companies duplicates mark-distinct candidate-1 --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '{"actor":{"id":"user-1","type":"user"},"rationale":"Different employers.","idempotencyKey":"distinct-1","expectedCandidateRevision":2,"leftCompanyId":"company-1","expectedLeftCompanyRevision":7,"rightCompanyId":"company-2","expectedRightCompanyRevision":3}'
valedictorian-cli --json jobs company reassign 018f0f2e-7b16-7a01-8c8c-20c6a9d52301 --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '{"actor":{"id":"user-1","type":"user"},"rationale":"Correct grouping.","idempotencyKey":"reassign-job-1","expectedAssignmentRevision":2,"destinationCompanyId":"company-1","expectedDestinationCompanyRevision":7}'
valedictorian-cli --json companies duplicates merge company-1 company-2 --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '{"actor":{"id":"user-1","type":"user"},"rationale":"Same employer.","idempotencyKey":"merge-companies-1","expectedWinnerCompanyRevision":7,"expectedLoserCompanyRevision":3,"loserDisplayNameConfirmation":"Delta Laboratories","acknowledgeNoUndo":true}'
```

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

Promotion `--input-json` accepts the complete client contract. `--idempotency-key`, the `--override-*` flags, and `--duplicate-action attach|merge` with `--duplicate-target-id` can override those fields explicitly. Remove commands require `--choice`, `--actor-id`, `--actor-type`, and `--rationale`, making dependent-resource handling deterministic. JSON output preserves the complete discriminated result, including warnings, blockers, overrides, and duplicate resolution details.

Credential administration uses top-level `secrets list/upsert/delete`. `secrets upsert` reads values only from `--value-file` and prints summary metadata. `secrets run` resolves validated `secret://` references into explicit stdin, environment, or dedicated file-descriptor destinations for a direct child spawn after `--`. It reduces accidental disclosure; an unrestricted same-user process can still inspect or alter child process state, so this is not a sandbox boundary. Do not put secret values in argv, shell history, chat, logs, or temp files when a structured reference works.

## Project config discovery

The CLI can read workspace defaults from `valedictorian.config.json`, `.valedictorianrc.json`, or the `valedictorian` key in `package.json`.

```json
{
  "version": 1,
  "workspace": {
    "name": "Example Workspace"
  }
}
```

Do not store API tokens, OAuth tokens, passwords, or client secrets in project config.

## Development

```sh
pnpm install
pnpm test
pnpm lint
pnpm build
```

## License

MIT
