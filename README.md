# Valedictorian

Local-first desktop app for tracking job applications.

## Workspace Data

Valedictorian stores workspace state in the selected workspace folder:

```text
<workspace>/.valedictorian/
```

The workspace manifest lives at `<workspace>/.valedictorian/manifest.json`.

## Project config discovery

When opening a new project folder, the app can read workspace defaults from `valedictorian.config.json`, `.valedictorianrc.json`, or the `valedictorian` key in `package.json`.

```json
{
  "version": 1,
  "workspace": {
    "name": "Summer Search"
  }
}
```

Do not store API tokens, OAuth tokens, passwords, or client secrets in project config.

## Development

```sh
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
```

## Release

Mac releases are built by `.github/workflows/release-mac.yml` from manual runs or `v*` tags.

```sh
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```
