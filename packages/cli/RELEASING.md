# Releasing

## First Publish

The `valedictorian-cli` package name was reported by npm as unpublished on June 10, 2026.

For the first publish:

```sh
mise install
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm pack --dry-run
npm login
npm publish --access public --tag alpha --provenance=false
```

Installation, checks, and packing use pnpm. Registry authentication and
publication stay on the npm CLI; automated releases use that boundary for
Trusted Publishing OIDC.

After the package exists on npm, configure npm Trusted Publishing for:

```sh
pnpm dlx npm@11.16.0 trust github valedictorian-cli \
  --repo KennySparxie/valedictorian-cli \
  --file publish.yml \
  --allow-publish \
  -y
```

The `--allow-publish` flag is required so the trusted publisher is allowed to
run `npm publish`. npm `11.13.0` does not include this flag even though the
registry requires it, so use npm `11.16.0` or newer for trust setup.

## Normal Release

```sh
pnpm version prerelease --preid alpha
git push
git push --tags
```

The tag must be `vX.Y.Z-alpha.N` and match `package.json`.

## Lifecycle Cutover Release Order

The `0.1.0-alpha.18` preparation stays on the newest installable compatible
contract package, `sparxie@0.27.1`, so frozen installs and hosted CI resolve
only published registry artifacts. Do not add the prepared but unpublished
`sparxie@0.28.0` dependency to the CLI.

After the human publication gate opens, release in this order:

1. Publish and tag `sparxie@0.28.0`.
2. Bump the CLI dependency and lockfile to the published `sparxie@0.28.0`.
3. Rerun the CLI lifecycle selectors and full release verification.
4. Tag the verified CLI version; the tag-triggered workflow publishes it.

Tagged GitHub Actions releases publish through npm Trusted Publishing. Because the
GitHub repository is private, the workflow omits npm provenance; npm provenance
currently requires a public GitHub source repository. If this repository becomes
public, add `--provenance` back to `.github/workflows/publish.yml`.

The first local publish uses `--provenance=false` because local shells do not have
a GitHub OIDC provider.
