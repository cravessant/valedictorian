# valedictorian-cli

Command-line client for Valedictorian.

## Install

```sh
pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g valedictorian-cli@alpha
```

The CLI is still published under the npm `alpha` dist-tag. This machine-safe
command forces the public npm registry because private registry caches can lag
behind fresh alpha publishes. Avoid an untagged global install until a stable
release is published.

## Usage

Point the CLI at a running Valedictorian API:

```sh
export VALEDICTORIAN_API_URL=http://127.0.0.1:4317
export VALEDICTORIAN_API_TOKEN=your-token
export VALEDICTORIAN_WORKSPACE=workspace-id-or-name

valedictorian-cli doctor
valedictorian-cli --json context
valedictorian-cli --json workspaces list
valedictorian-cli --json applications list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --workspace "$VALEDICTORIAN_WORKSPACE" --json applications list
valedictorian-cli --json action-queue list --workspace "$VALEDICTORIAN_WORKSPACE" --action-bucket apply_now
valedictorian-cli --json sourcing findings import --workspace "$VALEDICTORIAN_WORKSPACE" --input-json findings.json
valedictorian-cli --json profile get --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile sensitive summary --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile secrets list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json applications list --workspace "$VALEDICTORIAN_WORKSPACE" | jq '.items[] | {id, companyName, roleTitle, status}'
```

`--workspace` may be placed before the command or on the command itself. Workspace-scoped commands still require an explicit workspace; `doctor` and `context` can use the local last-open workspace for diagnostics when the local API workspace endpoint is unavailable.

## Project config discovery

The CLI discovers human-authored project config from the current working
directory upward. Supported files are `valedictorian.config.json`,
`.valedictorianrc.json`, and the `valedictorian` key in `package.json`.

```json
{
  "version": 1,
  "workspace": {
    "name": "Example Workspace"
  }
}
```

Project config is for repo/workspace defaults only. Do not store API tokens, OAuth tokens, passwords, or client secrets in project config. Use environment variables or the app's encrypted secret storage for secrets.

## Profile and secrets

Profile commands are workspace-scoped and use the same HTTP contract as the app:

```sh
valedictorian-cli --json profile get --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile agent-context --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile update --workspace "$VALEDICTORIAN_WORKSPACE" --input-json profile.json
valedictorian-cli --json profile sensitive update --workspace "$VALEDICTORIAN_WORKSPACE" --input-json sensitive-profile.json
valedictorian-cli --json profile sensitive summary --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile secrets list --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json profile secrets upsert greenhouse_password --workspace "$VALEDICTORIAN_WORKSPACE" --kind password --label "Greenhouse password" --value-file "$SECRET_VALUE_FILE"
```

`profile sensitive update` and `profile sensitive summary` print populated-field summaries rather than sensitive values. `profile secrets upsert` reads the secret value from `--value-file` and prints only the stored secret summary.

## Agent skill

This repo includes a Valedictorian CLI agent skill:

```sh
npx skills add KennySparxie/valedictorian-cli --skill valedictorian-cli
```

## Development

```sh
pnpm install
pnpm test
pnpm lint
pnpm build
```

## License

MIT
