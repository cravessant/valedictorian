#!/usr/bin/env bash
# Rehearse every C01-approved connector ref while preserving annotated tags.
set -euo pipefail

export LC_ALL=C
export TZ=UTC
export GIT_AUTHOR_NAME="Repository Migration Rehearsal"
export GIT_AUTHOR_EMAIL="migration@example.invalid"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_DATE="2026-07-31T00:00:00Z"
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"

app_repo="${P06_APP_REPO:-/Users/keni/Projects/job-automation/valedictorian-app}"
connector_repo="${P06_CONNECTOR_REPO:-/Users/keni/Projects/job-automation/valedictorian-connectors}"
app_base="51bfe2f8c77ead6c6867bdf23048960fadd24238"
audit_path="docs/repository-migration/c01-connectors-api-testkit-history-audit.json"
scratch_root="$(mktemp -d)"

cleanup() {
  if command -v trash >/dev/null 2>&1; then
    trash "$scratch_root"
  else
    printf 'Disposable rehearsal retained at %s\n' "$scratch_root" >&2
  fi
}
trap cleanup EXIT

if [ -n "${P06_CONNECTOR_AUDIT_FILE:-}" ]; then
  audit_json="$(< "$P06_CONNECTOR_AUDIT_FILE")"
else
  audit_json="$(git -C "$connector_repo" show "origin/main:$audit_path")"
fi

source_repo="$scratch_root/connectors-filtered"
git clone --quiet --no-local "$connector_repo" "$source_repo"
git -C "$source_repo" config core.hooksPath /dev/null
git -C "$source_repo" fetch --quiet "$connector_repo" \
  '+refs/remotes/origin/*:refs/remotes/source/*'

source_refs=()
while IFS=$'\t' read -r ref object; do
  git -C "$source_repo" update-ref "$ref" "$object"
  source_refs+=("$ref")
done < <(
  printf '%s' "$audit_json" |
    jq -r '.candidate.refs[] |
      [.ref, (.object_id // .object // .objectId // .sha)] | @tsv'
)

(
  cd "$source_repo"
  uvx --from git-filter-repo==2.47.0 git-filter-repo \
    --force \
    --path packages/core \
    --path packages/test-harness \
    --path-rename packages/core/:packages/connector-api/ \
    --path-rename packages/test-harness/:packages/connector-testkit/ \
    --refs "${source_refs[@]}" >/dev/null
)

destination_repo="$scratch_root/destination"
git clone --quiet --no-local "$app_repo" "$destination_repo"
git -C "$destination_repo" config core.hooksPath /dev/null
git -C "$destination_repo" checkout --quiet --detach "$app_base"
git -C "$destination_repo" switch --quiet -c rehearsal

for ref in "${source_refs[@]}"; do
  case "$ref" in
    refs/heads/*)
      target="refs/heads/imports/connectors/${ref#refs/heads/}"
      ;;
    refs/tags/*)
      target="refs/tags/imports/connectors/${ref#refs/tags/}"
      ;;
    *)
      printf 'Unexpected source ref: %s\n' "$ref" >&2
      exit 1
      ;;
  esac
  git -C "$destination_repo" fetch --quiet "$source_repo" "$ref:$target"
done

git -C "$destination_repo" merge --quiet --allow-unrelated-histories --no-ff \
  refs/heads/imports/connectors/main \
  -m "Rehearse approved connector refs"

import_refs=()
while IFS= read -r ref; do
  import_refs+=("$ref")
done < <(
  git -C "$destination_repo" for-each-ref \
    --format='%(refname)' \
    refs/heads/imports/connectors refs/tags/imports/connectors |
    LC_ALL=C sort
)

ref_digest="$(
  git -C "$destination_repo" for-each-ref \
    --format='%(refname)%09%(objectname)%09%(*objectname)' \
    refs/heads/imports/connectors refs/tags/imports/connectors |
    LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
)"
graph_digest="$(
  git -C "$destination_repo" rev-list --parents "${import_refs[@]}" |
    LC_ALL=C sort -u | shasum -a 256 | awk '{print $1}'
)"
commit_count="$(
  git -C "$destination_repo" rev-list "${import_refs[@]}" |
    LC_ALL=C sort -u | wc -l | tr -d ' '
)"
object_count="$(
  git -C "$destination_repo" rev-list --objects "${import_refs[@]}" |
    awk '{print $1}' | LC_ALL=C sort -u | wc -l | tr -d ' '
)"
tree_digest="$(
  git -C "$destination_repo" ls-tree -r HEAD \
    packages/connector-api packages/connector-testkit |
    shasum -a 256 | awk '{print $1}'
)"
annotated_tag_count="$(
  git -C "$destination_repo" for-each-ref \
    --format='%(*objectname)' refs/tags/imports/connectors |
    sed '/^$/d' | wc -l | tr -d ' '
)"
tag_count="$(
  git -C "$destination_repo" for-each-ref \
    --format='%(refname)' refs/tags/imports/connectors |
    wc -l | tr -d ' '
)"
source_signed_tag_count="$(
  printf '%s' "$audit_json" |
    jq -r '.candidate.refs[] | select(.ref | startswith("refs/tags/")) |
      .object_id' |
    while IFS= read -r object; do
      if [ "$(git -C "$connector_repo" cat-file -t "$object")" = "tag" ] &&
        git -C "$connector_repo" cat-file tag "$object" |
          grep -q 'BEGIN .* SIGNATURE'; then
        printf 'signed\n'
      fi
    done | wc -l | tr -d ' '
)"
rewritten_signed_tag_count="$(
  git -C "$destination_repo" for-each-ref \
    --format='%(objectname)' refs/tags/imports/connectors |
    while IFS= read -r object; do
      if [ "$(git -C "$destination_repo" cat-file -t "$object")" = "tag" ] &&
        git -C "$destination_repo" cat-file tag "$object" |
          grep -q 'BEGIN .* SIGNATURE'; then
        printf 'signed\n'
      fi
    done | wc -l | tr -d ' '
)"
outside_path_count="$(
  git -C "$destination_repo" log --format= --name-only \
    "${import_refs[@]}" |
    sed '/^$/d' |
    { grep -Ev '^packages/(connector-api|connector-testkit)/' || true; } |
    LC_ALL=C sort -u | wc -l | tr -d ' '
)"
fsck_lines="$(
  git -C "$destination_repo" fsck --full --no-dangling 2>&1 |
    wc -l | tr -d ' '
)"
test "$fsck_lines" = "0"

jq -n \
  --arg refSha256 "$ref_digest" \
  --arg graphSha256 "$graph_digest" \
  --arg treeSha256 "$tree_digest" \
  --argjson refCount "${#import_refs[@]}" \
  --argjson commitCount "$commit_count" \
  --argjson objectCount "$object_count" \
  --argjson annotatedTagCount "$annotated_tag_count" \
  --argjson tagCount "$tag_count" \
  --argjson sourceSignedTagCount "$source_signed_tag_count" \
  --argjson rewrittenSignedTagCount "$rewritten_signed_tag_count" \
  --argjson outOfBoundaryHistoryPaths "$outside_path_count" \
  '{
    source: "connectors",
    refCount: $refCount,
    refSha256: $refSha256,
    graphSha256: $graphSha256,
    commitCount: $commitCount,
    objectCount: $objectCount,
    annotatedTagCount: $annotatedTagCount,
    tagCount: $tagCount,
    sourceSignedTagCount: $sourceSignedTagCount,
    rewrittenSignedTagCount: $rewrittenSignedTagCount,
    treeSha256: $treeSha256,
    outOfBoundaryHistoryPaths: $outOfBoundaryHistoryPaths,
    fsck: "pass_zero_output"
  }'
