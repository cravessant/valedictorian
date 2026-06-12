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
