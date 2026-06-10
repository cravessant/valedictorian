# Releasing

## First Publish

The `valedictorian-cli` package name was reported by npm as unpublished on June 10, 2026.

For the first publish:

```sh
corepack enable
pnpm install
pnpm lint
pnpm test
pnpm build
npm pack --dry-run
npm login
npm publish --access public --tag alpha --provenance=false
```

After the package exists on npm, configure npm Trusted Publishing for:

```sh
npx npm@11.16.0 trust github valedictorian-cli \
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

Tagged GitHub Actions releases publish through npm Trusted Publishing. Because the
GitHub repository is private, the workflow omits npm provenance; npm provenance
currently requires a public GitHub source repository. If this repository becomes
public, add `--provenance` back to `.github/workflows/publish.yml`.

The first local publish uses `--provenance=false` because local shells do not have
a GitHub OIDC provider.
