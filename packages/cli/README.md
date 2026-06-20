# valedictorian-cli

Command-line client for Valedictorian.

## Install

```sh
npm install -g valedictorian-cli@alpha
```

The CLI is still published under the npm `alpha` dist-tag. Avoid an untagged
global install until a stable release is published.

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
valedictorian-cli --json action-queue list --workspace "$VALEDICTORIAN_WORKSPACE" --action-bucket apply_now
valedictorian-cli --json applications list --workspace "$VALEDICTORIAN_WORKSPACE" | jq '.items[] | {id, companyName, roleTitle, status}'
```

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
