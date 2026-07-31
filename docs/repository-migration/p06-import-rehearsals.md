# P06 reproducible import rehearsals

Issue: `cravessant/valedictorian-app#534`

Destination candidate: `cravessant/valedictorian`

Destination rehearsal baseline:
`51bfe2f8c77ead6c6867bdf23048960fadd24238`

## Decision

Use a pinned `git-filter-repo==2.47.0` path rewrite to construct the P07
candidate. It is the only rehearsed method that:

- gives the imported files natural destination-path history;
- attributes blame to original source commits instead of a synthetic import
  commit;
- keeps the connector API and testkit in one shared filtered graph; and
- excludes provider implementation history from the connector import.

This evidence approves a candidate mechanic for P07. The audited original refs
are immutable source selectors and provenance records, not transferable
destination object IDs. Path rewriting necessarily creates new commits, trees,
tag objects, and signatures. This rehearsal does not perform a live import,
approve the final graph, or decide which rewritten refs become public. P07 and
P20 retain those decisions.

## Source boundary

The CLI input is the L02-approved graph rooted at
`2b324894eb96629a73845092890e818b5fc589ae`: 10 approved branch tips, 20 tags,
84 commits, and 778 objects. The candidate destination is `packages/cli`.

The connector input uses C01's source-only API/testkit selectors rooted at
`28672152a753478aeecc4377621a42cd90b14962`. Only `packages/core` and
`packages/test-harness` are selected. Their rehearsal destinations are
`packages/connector-api` and `packages/connector-testkit`. Provider connector
source is excluded from the rewritten graph. C01 records main plus 25 tags:
82 commits and 1,277 objects, including three annotated tag objects.

The Source/customer dashboard import is not applicable. Its repository and
system are archived, retired, unused, and outside the product migration. The
rehearsal reads no dashboard repository and imports no dashboard ref or object.

## Method comparison

Every method produces the same CLI destination tree SHA-256:
`607f2d3842f69508df307c2f7397858ba65b12efdafd625c3a5de2eefa7c8655`.

| CLI method | Tags (annotated / signed) | Path commits | `--follow` commits | blame commits | synthetic blame lines | added objects | logical bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| subtree | 20 (7 / 1) | 1 | 0 | 1 | 59 | 765 | 5,644,990 |
| filter-repo | 20 (7 / 0) | 69 | 41 | 12 | 0 | 902 | 5,621,242 |
| unrelated merge | 20 (7 / 1) | 1 | 0 | 1 | 59 | 765 | 5,644,838 |

Every method also produces the same connector destination tree SHA-256:
`027ba34c5af4ec9f5e10aa9150e3ec0a2271c15dc058d3e0ae2e7b75d3e6513a`.

| Connector method | Tags (annotated / signed) | API/testkit path commits | API/testkit `--follow` commits | API/testkit blame commits | synthetic blame lines | outside-boundary paths | logical bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| two subtree splits | 0 (0 / 0) | 1 / 1 | 0 / 0 | 1 / 1 | 91 | 33 | 2,257,604 |
| filter-repo | 25 (3 / 0) | 40 / 54 | 32 / 33 | 8 / 7 | 0 | 0 | 2,253,678 |
| unrelated merge | 25 (3 / 2) | 1 / 1 | 0 / 0 | 8 / 7 | 0 | 152 | 12,185,757 |

The tree equality prevents a false choice based only on current files. The
history and boundary columns expose the material differences:

- Non-squashed subtree imports attach the original or split graph as a second
  parent, but history before the attachment uses old paths. Normal destination
  `git log -- <path>` and `git log --follow` therefore stop at the synthetic
  import.
- Splitting the two connector packages separately duplicates and disconnects
  commits that originally changed both packages. It also has no single
  truthful destination for a tag that names one shared source commit, so the
  split rehearsal retains zero source tags.
- A raw unrelated connector merge can expose only the desired current trees,
  yet its source parent still makes provider history and 152 unrelated paths
  reachable. It also adds 12,185,757 logical bytes, over five times the
  filtered package graph.
- The filtered graph rewrites selected paths through all candidate commits.
  Normal history, `--follow`, and blame remain useful at the destination, while
  no provider/out-of-boundary path remains reachable.
- Subtree and unrelated imports can keep original tag objects only because they
  also keep original source graphs. Filter-repo instead creates new annotated
  tag objects targeting rewritten commits. One CLI and two connector source
  tags are signed; their signatures are stripped because they cannot remain
  valid after the target object changes. P07 must sign the approved rewritten
  refs rather than copying invalid signatures.

## Reproduction

Run from this repository with the local source repositories readable at the
paths declared in the scripts:

```sh
bash docs/repository-migration/p06-rehearse-cli.sh
bash docs/repository-migration/p06-rehearse-connectors.sh
bash docs/repository-migration/p06-rehearse-selected-cli.sh
bash docs/repository-migration/p06-rehearse-selected-connectors.sh
```

Override those defaults with `P06_APP_REPO`, `P06_CLI_REPO`, and
`P06_CONNECTOR_REPO` when the three checkouts live elsewhere. Before C01 has
merged, point `P06_CONNECTOR_AUDIT_FILE` at its JSON artifact.

The scripts:

1. assert immutable destination and source baselines by checking out the full
   SHAs;
2. create separate `mktemp` clones for subtree, filter-repo, and unrelated
   merge;
3. set fixed migration identity and timestamps;
4. generate current-tree, graph, and integration-ref target SHA-256 digests;
5. measure path history, `--follow`, blame, authorship, commits, objects, and
   logical object bytes;
6. run `git fsck --full --no-dangling` and require zero output; and
7. send every disposable clone to the operating-system Trash on exit.

`git-filter-repo` runs through this exact pinned command:

```sh
uvx --from git-filter-repo==2.47.0 git-filter-repo
```

The tool reports revision `a40bce548d2c`; Git reports
`2.54.0 (Apple Git-157)`.

For the selected connector transform:

```sh
uvx --from git-filter-repo==2.47.0 git-filter-repo \
  --force \
  --path packages/core \
  --path packages/test-harness \
  --path-rename packages/core/:packages/connector-api/ \
  --path-rename packages/test-harness/:packages/connector-testkit/ \
  --refs candidate
```

For the selected CLI transform:

```sh
uvx --from git-filter-repo==2.47.0 git-filter-repo \
  --force \
  --to-subdirectory-filter packages/cli \
  --refs candidate
```

In the final candidate rehearsal, replace `candidate` with every exact
audit-approved branch and tag source selector in a single invocation. Fetch rewritten
branches and tags into collision-free `imports/cli/*` and
`imports/connectors/*` namespaces, then compute:

```sh
git for-each-ref --format='%(refname)%09%(objectname)' \
  refs/heads/imports refs/tags/imports |
  LC_ALL=C sort | shasum -a 256
git rev-list --parents \
  $(git for-each-ref --format='%(refname)' \
    refs/heads/imports refs/tags/imports) |
  LC_ALL=C sort -u | shasum -a 256
git fsck --full --no-dangling
```

The sibling JSON receipt records every method's exact graph and integration-ref
target digest as well as the complete metric rows above.

The selected CLI rehearsal rewrites all 30 L02-approved refs together and
fetches them into collision-free `imports/cli/*` namespaces. It reproduces:

- 30 refs with manifest SHA-256
  `fa13bade3e3becf4985c9c4d437e01bb4a6e38946ee259ceb0a714a3b453c6f7`;
- 84 commits with rewritten graph SHA-256
  `13ac045b2df98d89a61b34fd6f68ef860a3becb0252b57ca32dce432a33a0141`;
- 916 rewritten reachable objects; and
- all 20 tags, including seven annotated tags; the one source signature is
  absent from the rewritten annotation as required; and
- the same selected CLI tree digest shown in the method comparison.

The selected connector rehearsal rewrites all 26 C01-approved refs together
and fetches them into `imports/connectors/*` namespaces. It reproduces:

- 26 refs with manifest SHA-256
  `13d86689cb3f9b7b35bc2fec68cabfd3cf135f4f727fe236e6d160698ad58960`;
- a 67-commit path-filtered graph with SHA-256
  `e135091c854ec3fef7fef09d96f569489ae88f42aecde5ac876fb900845ab799`;
- 582 rewritten reachable objects;
- all three annotated tags still represented as annotated tags;
- both source signatures absent from rewritten annotations as required;
- zero provider/out-of-boundary history paths; and
- the same selected connector tree digest shown in the method comparison.
