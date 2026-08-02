# Releasing Public Packages

The product owns three disjoint npm release families. Package publication runs
only in GitHub Actions with npm Trusted Publisher OIDC and provenance:

| Family | Workflow | Migration tag | Normal tag |
| --- | --- | --- | --- |
| Connectors | `publish-connectors.yml` | `connectors-migration-vX.Y.Z` | `connectors-vX.Y.Z` |
| CLI | `publish-cli.yml` | `cli-migration-vX.Y.Z` | `cli-vX.Y.Z` |
| Workspace | `publish-workspace.yml` | `workspace-migration-vX.Y.Z` | `workspace-vX.Y.Z` |

The desktop release keeps the separate `vX.Y.Z` namespace.

## Trusted Publisher tuples

Configure and read back exactly one GitHub publisher for every package:

```sh
pnpm dlx npm@11.18.0 trust github \
  @sparxie/valedictorian-connectors-core \
  --repo cravessant/valedictorian --file publish-connectors.yml \
  --allow-publish -y
pnpm dlx npm@11.18.0 trust github \
  @sparxie/valedictorian-connectors-test-harness \
  --repo cravessant/valedictorian --file publish-connectors.yml \
  --allow-publish -y
pnpm dlx npm@11.18.0 trust github \
  @sparxie/valedictorian-cli \
  --repo cravessant/valedictorian --file publish-cli.yml \
  --allow-publish -y
pnpm dlx npm@11.18.0 trust github \
  @sparxie/valedictorian-workspace-server \
  --repo cravessant/valedictorian --file publish-workspace.yml \
  --allow-publish -y
pnpm dlx npm@11.18.0 trust github \
  @sparxie/valedictorian-workspace-client \
  --repo cravessant/valedictorian --file publish-workspace.yml \
  --allow-publish -y
pnpm dlx npm@11.18.0 trust github \
  @sparxie/valedictorian-workspace-conformance \
  --repo cravessant/valedictorian --file publish-workspace.yml \
  --allow-publish -y
pnpm dlx npm@11.18.0 trust github \
  @sparxie/valedictorian-local-runtime \
  --repo cravessant/valedictorian --file publish-workspace.yml \
  --allow-publish -y
```

Use `npm trust list <package> --json` for each identity. Require two-factor
authentication and disallow traditional publish tokens.

## Migration cutover

The first destination-owned versions publish only to the non-default
`migration` channel:

```sh
git tag connectors-migration-v0.19.1
git push origin connectors-migration-v0.19.1
```

Wait for the connector workflow and its two registry receipt artifacts to
succeed. The workspace workflow independently enforces that exact migration
receipt because local runtime depends on connector core `0.19.1`.

The CLI is independent and may run before or after that connector gate:

```sh
git tag cli-migration-v0.1.0-alpha.21
git push origin cli-migration-v0.1.0-alpha.21
```

Only after the connector receipt succeeds, publish the workspace family:

```sh
git tag workspace-migration-v0.1.0
git push origin workspace-migration-v0.1.0
```

Each workflow validates and publishes one exact tarball per package, checks the
registry integrity, signature, provenance, source metadata, and clean consumer
install, then retains the registry receipts as a workflow artifact.

Trusted Publisher OIDC supports package publication but not dist-tag changes.
After reviewing the migration receipts, promote the immutable versions with an
npm account using interactive two-factor authentication:

```sh
npm dist-tag add @sparxie/valedictorian-connectors-core@0.19.1 latest
npm dist-tag add @sparxie/valedictorian-connectors-test-harness@0.19.1 latest
npm dist-tag add @sparxie/valedictorian-cli@0.1.0-alpha.21 alpha
npm dist-tag add @sparxie/valedictorian-workspace-server@0.1.0 latest
npm dist-tag add @sparxie/valedictorian-workspace-client@0.1.0 latest
npm dist-tag add @sparxie/valedictorian-workspace-conformance@0.1.0 latest
npm dist-tag add @sparxie/valedictorian-local-runtime@0.1.0 latest
```

Read back every package with `npm dist-tag ls <package>`. This dist-tag
promotion is the only local registry mutation in the cutover; never publish a
tarball locally or overwrite immutable release history.
