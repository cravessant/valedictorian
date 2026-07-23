# Releasing

## First Publish

The scoped `@sparxie/valedictorian-cli` package supersedes the unscoped
`valedictorian-cli` package while preserving the executable name.

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
pnpm dlx npm@11.16.0 trust github @sparxie/valedictorian-cli \
  --repo cravessant/valedictorian \
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

## Scoped Package Cutover

The CLI consumes the published `@sparxie/sdk@0.29.0` contract. Publish
`@sparxie/valedictorian-cli` and verify its `alpha` tag before deprecating the
unscoped package.

Tagged GitHub Actions releases publish through npm Trusted Publishing. Because the
GitHub repository is private, the workflow omits npm provenance; npm provenance
currently requires a public GitHub source repository. If this repository becomes
public, add `--provenance` back to `.github/workflows/publish.yml`.

The first local publish uses `--provenance=false` because local shells do not have
a GitHub OIDC provider.
