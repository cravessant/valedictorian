#!/usr/bin/env bash
# Disposable, deterministic P06 rehearsal for the audited CLI default tip.
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
cli_base="2b324894eb96629a73845092890e818b5fc589ae"
audit_path="docs/repository-migration/l02-cli-history-audit.json"
audit_json="$(git -C "$cli_repo" show "origin/main:$audit_path")"
scratch_root="$(mktemp -d)"
result_file="$scratch_root/cli-methods.tsv"

cleanup() {
  if command -v trash >/dev/null 2>&1; then
    trash "$scratch_root"
  else
    printf 'Disposable rehearsal retained at %s\n' "$scratch_root" >&2
  fi
}
trap cleanup EXIT

new_destination() {
  local target="$1"
  git clone --quiet --no-local "$app_repo" "$target"
  git -C "$target" config core.hooksPath /dev/null
  git -C "$target" checkout --quiet --detach "$app_base"
  git -C "$target" switch --quiet -c rehearsal
}

import_tags() {
  local destination="$1"
  local source="$2"
  local method="$3"
  while IFS=$'\t' read -r ref audited_object; do
    if [ "$method" = "filter-repo" ]; then
      selected_object="$(git -C "$source" rev-parse "$ref")"
    else
      selected_object="$audited_object"
    fi
    git -C "$destination" fetch --quiet "$source" "$selected_object"
    git -C "$destination" update-ref \
      "refs/tags/rehearsal/cli/$method/${ref#refs/tags/}" \
      "$selected_object"
  done < <(
    printf '%s' "$audit_json" |
      jq -r '.sourceRefs.tags[] | [.ref,.object] | @tsv'
  )
}

record_metrics() {
  local method="$1"
  local repo="$2"
  git -C "$repo" gc --quiet

  local tree_digest
  local graph_digest
  local ref_digest
  local tag_ref_digest
  local tag_count
  local annotated_tag_count
  local signed_tag_count
  local history_count
  local follow_count
  local blame_commits
  local migration_blame_lines
  local reachable_count
  local added_count
  local author_count
  local added_object_count
  local added_object_bytes
  local fsck_lines

  tree_digest="$(
    git -C "$repo" ls-tree -r HEAD packages/cli |
      shasum -a 256 | awk '{print $1}'
  )"
  graph_digest="$(
    git -C "$repo" rev-list --parents HEAD --not "$app_base" |
      LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  )"
  ref_digest="$(
    git -C "$repo" rev-parse refs/heads/rehearsal |
      shasum -a 256 | awk '{print $1}'
  )"
  tag_ref_digest="$(
    git -C "$repo" for-each-ref \
      --format='%(refname)%09%(objectname)%09%(*objectname)' \
      "refs/tags/rehearsal/cli/$method" |
      LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  )"
  tag_count="$(
    git -C "$repo" for-each-ref --format='%(refname)' \
      "refs/tags/rehearsal/cli/$method" | wc -l | tr -d ' '
  )"
  annotated_tag_count="$(
    git -C "$repo" for-each-ref --format='%(*objectname)' \
      "refs/tags/rehearsal/cli/$method" |
      sed '/^$/d' | wc -l | tr -d ' '
  )"
  signed_tag_count="$(
    git -C "$repo" for-each-ref --format='%(objectname)' \
      "refs/tags/rehearsal/cli/$method" |
      while IFS= read -r object; do
        if [ "$(git -C "$repo" cat-file -t "$object")" = "tag" ] &&
          git -C "$repo" cat-file tag "$object" |
            grep -q 'BEGIN .* SIGNATURE'; then
          printf 'signed\n'
        fi
      done | wc -l | tr -d ' '
  )"
  history_count="$(
    git -C "$repo" log --format='%H' -- packages/cli |
      LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  follow_count="$(
    git -C "$repo" log --follow --format='%H' -- packages/cli/package.json |
      LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  blame_commits="$(
    git -C "$repo" blame --line-porcelain HEAD -- packages/cli/package.json |
      awk 'length($1)==40 {print $1}' |
      LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  migration_blame_lines="$(
    git -C "$repo" blame --line-porcelain HEAD -- packages/cli/package.json |
      grep -c '^author-mail <migration@example.invalid>$' || true
  )"
  reachable_count="$(git -C "$repo" rev-list --count HEAD)"
  added_count="$(git -C "$repo" rev-list --count HEAD --not "$app_base")"
  author_count="$(
    git -C "$repo" log --format='%aN <%aE>' HEAD --not "$app_base" |
      LC_ALL=C sort -fu | wc -l | tr -d ' '
  )"
  added_object_count="$(
    git -C "$repo" rev-list --objects HEAD --not "$app_base" |
      awk '{print $1}' | LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  added_object_bytes="$(
    git -C "$repo" rev-list --objects HEAD --not "$app_base" |
      awk '{print $1}' | LC_ALL=C sort -u |
      git -C "$repo" cat-file --batch-check='%(objectsize)' |
      awk '{total += $1} END {print total + 0}'
  )"
  fsck_lines="$(git -C "$repo" fsck --full --no-dangling 2>&1 | wc -l | tr -d ' ')"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$method" "$tree_digest" "$graph_digest" "$ref_digest" \
    "$tag_ref_digest" "$tag_count" "$annotated_tag_count" "$signed_tag_count" \
    "$history_count" "$follow_count" "$blame_commits" \
    "$migration_blame_lines" \
    "$reachable_count" "$added_count" "$author_count" "$added_object_count" \
    "$added_object_bytes" >> "$result_file"
  test "$fsck_lines" = "0"
}

printf 'method\ttree_sha256\tgraph_sha256\tref_sha256\ttag_ref_sha256\ttag_count\tannotated_tag_count\tsigned_tag_count\tpath_history_commits\tfollow_package_commits\tblame_commits\tmigration_blame_lines\treachable_commits\tadded_commits\tadded_authors\tadded_objects\tadded_logical_bytes\n' \
  > "$result_file"

subtree_repo="$scratch_root/subtree"
new_destination "$subtree_repo"
git -C "$subtree_repo" subtree add \
  --prefix=packages/cli "$cli_repo" "$cli_base" \
  -m "Rehearse CLI subtree import" >/dev/null
import_tags "$subtree_repo" "$cli_repo" "subtree"
record_metrics "subtree" "$subtree_repo"

filtered_source="$scratch_root/cli-filtered"
git clone --quiet --no-local "$cli_repo" "$filtered_source"
git -C "$filtered_source" config core.hooksPath /dev/null
git -C "$filtered_source" branch -f candidate "$cli_base"
git -C "$filtered_source" checkout --quiet candidate
filter_refs=(candidate)
while IFS=$'\t' read -r ref object; do
  git -C "$filtered_source" update-ref "$ref" "$object"
  filter_refs+=("$ref")
done < <(
  printf '%s' "$audit_json" |
    jq -r '.sourceRefs.tags[] | [.ref,.object] | @tsv'
)
(
  cd "$filtered_source"
  uvx --from git-filter-repo==2.47.0 git-filter-repo \
    --force \
    --to-subdirectory-filter packages/cli \
    --refs "${filter_refs[@]}" >/dev/null
)

filter_repo="$scratch_root/filter-repo"
new_destination "$filter_repo"
git -C "$filter_repo" remote add cli-filtered "$filtered_source"
git -C "$filter_repo" fetch --quiet cli-filtered refs/heads/candidate
git -C "$filter_repo" merge --quiet --allow-unrelated-histories --no-ff \
  FETCH_HEAD -m "Rehearse filtered CLI import"
import_tags "$filter_repo" "$filtered_source" "filter-repo"
record_metrics "filter-repo" "$filter_repo"

unrelated_repo="$scratch_root/unrelated"
new_destination "$unrelated_repo"
git -C "$unrelated_repo" remote add cli "$cli_repo"
git -C "$unrelated_repo" fetch --quiet cli "$cli_base"
source_tip="$(git -C "$unrelated_repo" rev-parse FETCH_HEAD)"
git -C "$unrelated_repo" read-tree --prefix=packages/cli/ "$source_tip^{tree}"
integration_tree="$(git -C "$unrelated_repo" write-tree)"
integration_commit="$(
  printf 'Rehearse unrelated CLI import\n' |
    git -C "$unrelated_repo" commit-tree "$integration_tree" \
      -p "$app_base" -p "$source_tip"
)"
git -C "$unrelated_repo" reset --quiet --hard "$integration_commit"
import_tags "$unrelated_repo" "$cli_repo" "unrelated-merge"
record_metrics "unrelated-merge" "$unrelated_repo"

cat "$result_file"
