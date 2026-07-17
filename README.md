# Valedictorian

Local-first desktop app for tracking job applications.

## Workspace Data

Valedictorian stores workspace state in the selected workspace folder:

```text
<workspace>/.valedictorian/
```

The workspace manifest lives at `<workspace>/.valedictorian/manifest.json`.

### Profile storage and recovery

`<workspace>/.valedictorian/profile.json` is the canonical source for the non-secret profile. On first startup after upgrading, Valedictorian validates the legacy SQLite profile, creates and verifies a recoverable backup plus completion marker under `.valedictorian/profile-migration/`, writes the JSON atomically, moves SSN last-four into the reserved encrypted workspace-secret store, and only then removes the legacy profile tables. Profile JSON never contains SSN material.

Invalid JSON blocks profile reads and updates until it is corrected or restored. A valid existing JSON document that conflicts with legacy data also blocks automatic cutover instead of being overwritten. To restore the one-generation profile backup through the local API, use the workspace route:

```sh
curl -X POST "$VALEDICTORIAN_API_URL/v1/workspaces/$WORKSPACE_ID/profile/document/restore" \
  -H 'content-type: application/json' \
  --data '{"expectedRevision":null}'
```

Use `expectedRevision: null` only when the current document is unreadable; otherwise provide the current revision to prevent overwriting a concurrent edit.

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
