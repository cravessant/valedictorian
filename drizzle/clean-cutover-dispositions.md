# Clean lifecycle cutover selector dispositions

`pnpm run inspect:lifecycle-cutover` scans every maintained source, test, fixture,
migration, snapshot, and document in the App repository. It recognizes singular and
plural snake, kebab, camel, and temporary lifecycle-root forms for the retired raw
record/source, canonical candidate, sourcing finding, normalization/projection,
legacy Capture roots, and collapsed retry-work vocabularies.

Every match must have an exact repository + path + category + occurrence-count entry
in `clean-cutover-selector-manifest.json`. New matches, count drift, and stale
dispositions all fail. The only files omitted are dependencies/build output, `.git`,
local-only state, and the selector's own three definition/manifest documents.

The dispositions are deliberately narrow:

- journaled migrations, snapshots, migration fixtures, and absence tests preserve
  old names solely to prove the installed upgrade;
- retained PostgreSQL constraint/index names are physical identifiers, not TS roots;
- `normalizationAttempts` remains part of the released connector-retirement result;
- `retryWorkId` remains the released connector-acquisition field, now identifying
  canonical connector capture work;
- changelog occurrences are release history.

The default App lint is explicitly a working-tree count validation; it never labels
dirty development content as exact-head provenance. The cross-repository proof is
run explicitly so App CI does not depend on sibling checkouts:

```sh
node scripts/lifecycle-cutover-selectors.mjs \
  --repo=app=/path/to/valedictorian-app \
  --repo=sparxie=/path/to/sparxie \
  --repo=cli=/path/to/valedictorian-cli \
  --expected-head=app=<exact-40-character-app-SHA>
```

The inspected Sparxie head is `2c52f1a22cc3b7bf9be0ec90e9e2c0791164d607` and
the CLI head is `a429f5c7435dad973f374d30a36b2bb1061263c4`. App-only CI reports the runtime
HEAD without depending on sibling repositories. The explicit cross-repository proof
requires the final exact App SHA through `--expected-head`, avoiding a self-referential
commit hash in the manifest. Explicit repository mode also requires empty porcelain
status (including tracked, staged, and untracked changes), derives each claimed
commit's tree, compares it with HEAD, and checks the fixed Sparxie/CLI tree identities
stored in the manifest.

The Sparxie observations were taken at worker commit
`07c60bcc844eac84d9be2cd0c77e676881abedc2`; it and merged main `2c52f1a` have the
identical Git tree `19c911a3f5475d8853b13571a74ade7539212ed6` (`git diff --quiet`), so the
recorded occurrence counts are content-exact for the inspected main head.
