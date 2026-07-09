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
valedictorian-cli --json sourcing findings import --workspace "$VALEDICTORIAN_WORKSPACE" --input-json findings.json
valedictorian-cli --json profile get --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile sensitive summary --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile secrets list --workspace "$VALEDICTORIAN_WORKSPACE"
```

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
