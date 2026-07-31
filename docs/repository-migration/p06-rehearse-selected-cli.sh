#!/usr/bin/env bash
# Rehearse every L02-approved CLI branch and tag in collision-free refs.
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
cli_repo="${P06_CLI_REPO:-/Users/keni/Projects/job-automation/valedictorian-cli}"
app_base="51bfe2f8c77ead6c6867bdf23048960fadd24238"
audit_path="docs/repository-migration/l02-cli-history-audit.json"
scratch_root="$(mktemp -d)"

cleanup() {
  if command -v trash >/dev/null 2>&1; then
    trash "$scratch_root"
  else
    printf 'Disposable rehearsal retained at %s\n' "$scratch_root" >&2
  fi
}
trap cleanup EXIT

audit_json="$(git -C "$cli_repo" show "origin/main:$audit_path")"
source_repo="$scratch_root/cli-filtered"
git clone --quiet --no-local "$cli_repo" "$source_repo"
git -C "$source_repo" config core.hooksPath /dev/null
git -C "$source_repo" fetch --quiet "$cli_repo" \
  '+refs/remotes/origin/*:refs/remotes/source/*'

source_refs=()
while IFS=$'\t' read -r ref object; do
  git -C "$source_repo" update-ref "$ref" "$object"
  source_refs+=("$ref")
done < <(
  printf '%s' "$audit_json" |
    jq -r '.sourceRefs.branches[] | [.ref,.object] | @tsv'
)
while IFS=$'\t' read -r ref object; do
  git -C "$source_repo" update-ref "$ref" "$object"
  source_refs+=("$ref")
done < <(
  printf '%s' "$audit_json" |
    jq -r '.sourceRefs.tags[] | [.ref,.object] | @tsv'
)

(
  cd "$source_repo"
  uvx --from git-filter-repo==2.47.0 git-filter-repo \
    --force \
    --to-subdirectory-filter packages/cli \
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
      target="refs/heads/imports/cli/${ref#refs/heads/}"
      ;;
    refs/tags/*)
      target="refs/tags/imports/cli/${ref#refs/tags/}"
      ;;
    *)
      printf 'Unexpected source ref: %s\n' "$ref" >&2
      exit 1
      ;;
  esac
  git -C "$destination_repo" fetch --quiet "$source_repo" "$ref:$target"
done

git -C "$destination_repo" merge --quiet --allow-unrelated-histories --no-ff \
  refs/heads/imports/cli/main -m "Rehearse approved CLI refs"

import_refs=()
while IFS= read -r ref; do
  import_refs+=("$ref")
done < <(
  git -C "$destination_repo" for-each-ref \
    --format='%(refname)' refs/heads/imports/cli refs/tags/imports/cli |
    LC_ALL=C sort
)

ref_digest="$(
  git -C "$destination_repo" for-each-ref \
    --format='%(refname)%09%(objectname)' \
    refs/heads/imports/cli refs/tags/imports/cli |
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
tag_count="$(
  git -C "$destination_repo" for-each-ref \
    --format='%(refname)' refs/tags/imports/cli |
    wc -l | tr -d ' '
)"
annotated_tag_count="$(
  git -C "$destination_repo" for-each-ref \
    --format='%(*objectname)' refs/tags/imports/cli |
    sed '/^$/d' | wc -l | tr -d ' '
)"
source_signed_tag_count="$(
  printf '%s' "$audit_json" |
    jq -r '.sourceRefs.tags[].object' |
    while IFS= read -r object; do
      if [ "$(git -C "$cli_repo" cat-file -t "$object")" = "tag" ] &&
        git -C "$cli_repo" cat-file tag "$object" |
          grep -q 'BEGIN .* SIGNATURE'; then
        printf 'signed\n'
      fi
    done | wc -l | tr -d ' '
)"
rewritten_signed_tag_count="$(
  git -C "$destination_repo" for-each-ref \
    --format='%(objectname)' refs/tags/imports/cli |
    while IFS= read -r object; do
      if [ "$(git -C "$destination_repo" cat-file -t "$object")" = "tag" ] &&
        git -C "$destination_repo" cat-file tag "$object" |
          grep -q 'BEGIN .* SIGNATURE'; then
        printf 'signed\n'
      fi
    done | wc -l | tr -d ' '
)"
tree_digest="$(
  git -C "$destination_repo" ls-tree -r HEAD packages/cli |
    shasum -a 256 | awk '{print $1}'
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
  --argjson tagCount "$tag_count" \
  --argjson annotatedTagCount "$annotated_tag_count" \
  --argjson sourceSignedTagCount "$source_signed_tag_count" \
  --argjson rewrittenSignedTagCount "$rewritten_signed_tag_count" \
  '{
    source: "cli",
    refCount: $refCount,
    refSha256: $refSha256,
    graphSha256: $graphSha256,
    commitCount: $commitCount,
    objectCount: $objectCount,
    tagCount: $tagCount,
    annotatedTagCount: $annotatedTagCount,
    sourceSignedTagCount: $sourceSignedTagCount,
    rewrittenSignedTagCount: $rewrittenSignedTagCount,
    treeSha256: $treeSha256,
    fsck: "pass_zero_output"
  }'
