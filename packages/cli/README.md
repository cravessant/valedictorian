# valedictorian-cli

Command-line client for Valedictorian.

## Install

```sh
pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g valedictorian-cli@alpha
```

The CLI is currently published under the npm `alpha` dist-tag.

## Usage

Point the CLI at a running Valedictorian API, then pass a workspace id or exact workspace name for workspace-scoped commands.

```sh
export VALEDICTORIAN_API_URL=http://127.0.0.1:4317
export VALEDICTORIAN_API_TOKEN=your-token
export VALEDICTORIAN_WORKSPACE=workspace-id-or-name

valedictorian-cli doctor
valedictorian-cli --json context
valedictorian-cli --json workspaces list
valedictorian-cli --json applications list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json action-queue list --workspace "$VALEDICTORIAN_WORKSPACE" --action-bucket apply_now
valedictorian-cli --json policy config get --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json sourcing ingest --workspace "$VALEDICTORIAN_WORKSPACE" --url "https://jobs.example.com/role"
valedictorian-cli --json profile get --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile validate --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile format --workspace "$VALEDICTORIAN_WORKSPACE" --expected-revision <revision>
valedictorian-cli --json profile restore --workspace "$VALEDICTORIAN_WORKSPACE" --expected-revision <revision|null> --confirm
valedictorian-cli --json secrets list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli secrets run --workspace "$VALEDICTORIAN_WORKSPACE" --env TOKEN=secret://greenhouse_password -- some-tool --flag
```

`sourcing ingest` captures sparse source observations. Its output separates submitted provenance, durable intake, normalization, and exact-revision projection. Inspection failures retain the intake receipt, use bounded safe errors, and produce a nonzero exit after output. The server owns normalization, fit gating, duplicate detection, and projection into the sourcing findings queue. `applications create` remains the direct way to create a canonical application; sourcing intake does not create applications directly.

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
