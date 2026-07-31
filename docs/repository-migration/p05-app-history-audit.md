# P05 app history and public-boundary audit

Issue: `cravessant/valedictorian-app#533`

Baseline: `6a73ec632a6bd2d44bec9c54e882ba66f9838947`

Captured: `2026-07-31T15:20:07Z`

Corrected after independent review: `2026-07-31T15:29:41Z`

## Decision

The app source is approved as an input to P07 candidate construction with the
six remediations below. This evidence-only approval does not approve the P07
combined ref graph, the P20 visibility change, a publisher transfer, or any
distribution cutover.

The intended source set is `refs/heads/main` at the baseline plus the 54
`v0.1.0-alpha.*` tags present at capture time. All other GitHub branches,
machine-local refs, reflogs, unreachable objects, and release binaries are
excluded from the source import unless P07 names them explicitly.
`v0.1.0-alpha.24` contributes three commits and 47 objects not reachable from
`main`; every candidate command includes that divergent tagged history.

## Evidence inventory

The candidate contains 55 refs, 445 commits, 8,922 named objects, 1,527
historical paths, one root commit, 49 merge commits, and three author
identities. The sibling JSON receipt records the SHA-256 digest of each sorted
finite queue.

GitHub exposed eight branches at capture time: `main`, this audit branch, and
six Dependabot branches. Only `main` belongs to the candidate. GitHub exposed
54 tags and 44 releases with 196 binary/update assets totaling 8,978,455,208
bytes. Only release metadata and asset name/size/content-type rows were
reviewed; the 9 GB of excluded binaries were not downloaded or content-scanned.
Ten tags have no GitHub release:

- `v0.1.0-alpha.1`
- `v0.1.0-alpha.3`
- `v0.1.0-alpha.5`
- `v0.1.0-alpha.6`
- `v0.1.0-alpha.11`
- `v0.1.0-alpha.12`
- `v0.1.0-alpha.20`
- `v0.1.0-alpha.25`
- `v0.1.0-alpha.26`
- `v0.1.0-alpha.37`

The local object database additionally retained 240 refs, 782 distinct reflog
commits, 1,590 reflog entries, and 2,421 unreachable objects: 345 commits,
1,031 trees, and 1,045 blobs. Those clone-local sets were inventoried and
scanned but are not public candidate refs. One extra root is reachable only
through excluded local state. The 345 unreachable commit metadata rows and
every reflog entry have separate sorted digests in the JSON receipt; a redacted
metadata scan found no secret candidate.

The candidate author queue uses three addresses for the same author. The
machine-local address and personal mailbox must be normalized to the public
author identity during P07 candidate construction; P07 remains responsible for
approving the resulting rewritten graph.

## Scanner and manual-review results

Gitleaks 8.30.1 scanned the exact candidate graph, every retained local ref,
and every unreachable blob with full redaction. The candidate produced two
JWT findings and the broader local-ref scan produced four occurrences. Manual
review showed that all are duplicate synthetic canaries in JWT/signed-URL
sanitization tests at commits
`b08441e9ca63453ca7531737400d364f14382e3f` and
`82de760bc19341a4246967ee9ffa2cc91962afe7`. The unreachable-blob scan produced
zero findings. No credential was present. GitHub secret scanning is disabled
on this private repository, so an enabled host-side scan or equivalent
independent redacted scan is required on the exact P07 candidate before P20.

The repository has no top-level license file and its root package has no
license field. The vendored CLI declares MIT, but its repository, bugs, and
homepage metadata still point to the private
`cravessant/valedictorian` repository. Both are explicit disclosure
remediations.

`pnpm licenses list --prod --json` covered 150 production dependency rows with
no missing license metadata. Observed identifiers were 0BSD, Apache-2.0,
BSD-3-Clause, BlueOak-1.0.0, ISC, MIT, MPL-2.0, and Python-2.0. Python-2.0 was
the declared license of `argparse@2.0.1`; no non-package license exception was
inferred.

All 17 fixture-named paths and 50 unique fixture blobs across the candidate
history were reviewed. They contain two email addresses and 22 URLs. One
address uses Gmail, and historical application fixtures include real employer,
ATS, LinkedIn, and Jobright URLs. These are disclosure-sensitive user or
production-derived candidates even though the fixtures are test code. P07 must
replace them with synthetic equivalents while preserving test intent. No
tracked database, dump, CSV, or JSONL data file exists at the baseline.

Hosted-infrastructure candidates are limited to the desktop packaging/release
configuration, dependency metadata, and tests. Release workflows refer to
secret names but contain no secret values. No Cloudflare Worker, database,
queue, R2, Durable Object, or hosted runtime implementation is present in the
candidate source.

## Required remediation

1. Add a top-level license file and root package license metadata before public
   disclosure.
2. Rewrite the vendored CLI private repository metadata to the accepted public
   destination after L02 and P07 settle it.
3. Normalize the two non-public author emails to the approved public author
   identity while constructing the P07 candidate.
4. Replace the historical application fixture email and real job/company URLs
   with synthetic equivalents during P07 candidate construction.
5. Select tag/release and binary-asset transfer explicitly. This source audit
   does not approve publisher or distribution cutover.
6. Run a host-side secret scan or equivalent independent redacted scan against
   the exact P07 graph before P20 visibility change.

## Reproduction commands

Run from the app repository at the full baseline SHA with Node and pnpm from
`mise.toml`.

```sh
git rev-parse HEAD
candidate_refs="$(mktemp)"
printf '%s\n' refs/heads/main > "$candidate_refs"
git tag --list | LC_ALL=C sort | sed 's#^#refs/tags/#' >> "$candidate_refs"
xargs git rev-list < "$candidate_refs" | LC_ALL=C sort -u
xargs git rev-list --objects < "$candidate_refs" | LC_ALL=C sort -u
xargs git log --name-only --pretty= < "$candidate_refs" | sed '/^$/d' | LC_ALL=C sort -u
xargs git log --format='%aN <%aE>' < "$candidate_refs" | LC_ALL=C sort -fu
git fsck --full --no-reflogs --unreachable
git reflog show --all --format='%H' | LC_ALL=C sort -u
gh api repos/cravessant/valedictorian-app/branches --paginate \
  --jq '.[] | [.name,.commit.sha] | @tsv' | LC_ALL=C sort
gh api repos/cravessant/valedictorian-app/tags --paginate \
  --jq '.[] | [.name,.commit.sha] | @tsv' | LC_ALL=C sort
gh release list --repo cravessant/valedictorian-app --limit 100 \
  --json name,tagName,isDraft,isPrerelease,publishedAt \
  --jq '.[] | [.tagName,.name,.isDraft,.isPrerelease,.publishedAt] | @tsv' \
  | LC_ALL=C sort
gh api repos/cravessant/valedictorian-app/releases --paginate \
  --jq '.[] | [.tag_name,.id,.draft,.prerelease,.target_commitish,([.assets[] | [.name,.size,.content_type] | @csv] | sort | join("|"))] | @tsv' \
  | LC_ALL=C sort
candidate_log_opts="$(paste -sd' ' "$candidate_refs")"
mise x gitleaks@8.30.1 -- gitleaks git . \
  --log-opts="$candidate_log_opts" --redact=100
mise x gitleaks@8.30.1 -- gitleaks git . --log-opts=--all --redact=100
mise exec -- pnpm licenses list --prod --json
```

The deleted-object and reflog metadata queues use these exact projections:

```sh
fsck_manifest="$(mktemp)"
git fsck --full --no-reflogs --unreachable 2>/dev/null \
  | LC_ALL=C sort > "$fsck_manifest"
awk '$2=="commit"{print $3}' "$fsck_manifest" \
  | xargs git show -s \
      --format='%H%x09%aN%x09%aE%x09%cN%x09%cE%x09%s' \
  | LC_ALL=C sort -u
git reflog show --all --format='%H%x09%gD%x09%gs' 2>/dev/null \
  | LC_ALL=C sort -u
```

The first queue has 345 rows and SHA-256
`f0e759dbc31f693b1d1ab844d77a99d5b663aa4fe6ce53de8e40e04ca5aefad6`.
The second has 1,590 rows and SHA-256
`2c9cbb4505e2c99c534e707b3e567ebc9353163a6de722d7b15a101e12747641`.
The metadata scan runs `gitleaks dir --redact=100` against files containing
these two queues.

Persist each sorted queue with its trailing newline and run
`shasum -a 256 <queue>` to reproduce the sibling receipt. For fixture
coverage, run the exact selector below:

```sh
fixture_manifest="$(mktemp)"
xargs git rev-list < "$candidate_refs" \
  | xargs -n 1 git ls-tree -r \
  | awk '$2=="blob" && tolower($4) ~ /fixture/ {print $3 "\t" $4}' \
  | LC_ALL=C sort -u > "$fixture_manifest"
node - "$fixture_manifest" <<'NODE'
const crypto = require('node:crypto')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n')
const blobs = new Set(rows.map((row) => row.split('\t')[0]))
const emails = new Set()
const urls = new Set()
for (const blob of blobs) {
  const body = execFileSync('git', ['cat-file', 'blob', blob], {
    encoding: 'utf8',
    maxBuffer: 20_000_000,
  })
  for (const match of body.matchAll(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  )) emails.add(match[0].toLowerCase())
  for (const match of body.matchAll(/https?:\/\/[^\s'"`<>]+/g)) {
    urls.add(match[0].replace(/[),.;]+$/, ''))
  }
}
const digest = (values) => crypto.createHash('sha256')
  .update(`${[...values].sort().join('\n')}\n`)
  .digest('hex')
console.log(JSON.stringify({
  uniqueEmails: emails.size,
  emailSha256: digest(emails),
  uniqueUrls: urls.size,
  urlSha256: digest(urls),
}))
NODE
```

The fixture manifest is the sorted union of
`<blob SHA><TAB><fixture path>` rows emitted by `git ls-tree -r` for every
candidate commit, filtered case-insensitively on `fixture`. It contains 51
path/blob rows, 17 paths, and 50 unique blobs and has SHA-256
`d71be7a62bd067c49857144c85a009fcc5ba2dadf2add15c3c7051ab87c0ab10`.
Manual review extracted URL hosts and email domains from every unique blob
without publishing the sensitive values.

For the unreachable-blob scan, enumerate blob IDs from `git fsck`, extract each
with `git cat-file blob`, scan the disposable directory with
`gitleaks dir --redact=100`, and discard it. The reviewed run covered all 1,045
unreachable blobs.
