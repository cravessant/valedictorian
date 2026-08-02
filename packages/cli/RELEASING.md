# Releasing

## Publisher Cutover

The scoped `@sparxie/valedictorian-cli` package preserves the
`valedictorian-cli` executable name.

Registry publication is CI-only. Configure the package's sole npm Trusted
Publisher for:

```sh
pnpm dlx npm@11.18.0 trust github @sparxie/valedictorian-cli \
  --repo cravessant/valedictorian \
  --file publish-cli.yml \
  --allow-publish \
  -y
```

Read back exactly one connection and require two-factor authentication while
disallowing traditional tokens. The first destination-owned version is a
non-default migration canary:

```sh
git tag cli-migration-v0.1.0-alpha.21
git push origin cli-migration-v0.1.0-alpha.21
```

The workflow packs once, validates that exact tarball, and publishes it with
npm provenance under the `migration` dist-tag. Verify registry integrity,
provenance, clean install, upgrade, executable, local-runtime compatibility,
documentation, and skill links before changing a default channel.

Trusted Publisher OIDC cannot change dist-tags. After the migration receipt is
approved, use an npm account with interactive two-factor authentication to
promote the exact immutable artifact:

```sh
npm dist-tag add @sparxie/valedictorian-cli@0.1.0-alpha.21 alpha
npm dist-tag ls @sparxie/valedictorian-cli
```

This authenticated dist-tag operation is the only local registry mutation in
the cutover. It does not republish or alter the artifact.

## Normal Release

```sh
pnpm version prerelease --preid alpha
git push
git tag cli-vX.Y.Z-alpha.N
git push origin cli-vX.Y.Z-alpha.N
```

The tag must be `cli-vX.Y.Z-alpha.N` and match
`packages/cli/package.json`. Prereleases publish to their matching `alpha`,
`beta`, or `rc` channel; stable versions publish to `latest`.

## Scoped Package Cutover

The CLI consumes the published `@sparxie/sdk@0.36.0` contract. Publish
`@sparxie/valedictorian-cli` and verify its `alpha` tag before deprecating the
unscoped package.

Do not run a local or token-authenticated publish. Roll back by freezing the
destination workflow and repointing dist-tags to a verified immutable version;
never overwrite or silently unpublish release history.
