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

The lifecycle command tree mirrors `@sparxie/sdk@0.29.0`:

- `captures`: `list`, `get`, `create`, `correct`, `remove`, `restore`, `history`, `promote-to-job`
- `jobs`: `list`, `get`, `create`, `correct-facts`, `update-availability`, `external-identities add|remove`, `remove`, `restore`, `history`, `promote-to-opportunity`
- `opportunities`: `list`, `get`, `create`, `update-evaluation`, `update-disposition`, `remove`, `restore`, `history`, `promote-to-application`
- `applications`: `list`, `get`, `create`, `update-status`, `update-company`, `update-source`, `links create|update|remove`, `refresh-snapshot`, `remove`, `restore`, `history`, `attempts list`, `events list`

Complex contract-owned inputs use strict JSON. The positional resource id is supplied by the command and must be omitted from `--input-json`.

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
