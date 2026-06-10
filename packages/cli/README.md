# valedictorian-cli

Command-line client for Valedictorian.

## Install

```sh
npm install -g valedictorian-cli
```

## Usage

Point the CLI at a running Valedictorian API:

```sh
export VALEDICTORIAN_API_URL=http://127.0.0.1:4317
export VALEDICTORIAN_API_TOKEN=your-token

valedictorian-cli applications list --json
```

## Development

```sh
pnpm install
pnpm test
pnpm lint
pnpm build
```
