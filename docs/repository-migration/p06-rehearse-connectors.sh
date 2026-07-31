#!/usr/bin/env bash
# Disposable, deterministic P06 rehearsal for the connector package paths.
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
connector_base="28672152a753478aeecc4377621a42cd90b14962"
audit_path="docs/repository-migration/c01-connectors-api-testkit-history-audit.json"
if [ -n "${P06_CONNECTOR_AUDIT_FILE:-}" ]; then
  audit_json="$(< "$P06_CONNECTOR_AUDIT_FILE")"
else
  audit_json="$(git -C "$connector_repo" show "origin/main:$audit_path")"
fi
scratch_root="$(mktemp -d)"
result_file="$scratch_root/connector-methods.tsv"

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
      "refs/tags/rehearsal/connectors/$method/${ref#refs/tags/}" \
      "$selected_object"
  done < <(
    printf '%s' "$audit_json" |
      jq -r '.candidate.refs[] |
        select(.ref | startswith("refs/tags/")) |
        [.ref,.object_id] | @tsv'
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
  local core_history
  local harness_history
  local core_follow
  local harness_follow
  local core_blame_commits
  local harness_blame_commits
  local migration_blame_lines
  local added_count
  local author_count
  local added_object_count
  local added_object_bytes
  local forbidden_paths
  local fsck_lines

  tree_digest="$(
    git -C "$repo" ls-tree -r HEAD \
      packages/connector-api packages/connector-testkit |
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
      "refs/tags/rehearsal/connectors/$method" |
      LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  )"
  tag_count="$(
    git -C "$repo" for-each-ref --format='%(refname)' \
      "refs/tags/rehearsal/connectors/$method" |
      wc -l | tr -d ' '
  )"
  annotated_tag_count="$(
    git -C "$repo" for-each-ref --format='%(*objectname)' \
      "refs/tags/rehearsal/connectors/$method" |
      sed '/^$/d' | wc -l | tr -d ' '
  )"
  signed_tag_count="$(
    git -C "$repo" for-each-ref --format='%(objectname)' \
      "refs/tags/rehearsal/connectors/$method" |
      while IFS= read -r object; do
        if [ "$(git -C "$repo" cat-file -t "$object")" = "tag" ] &&
          git -C "$repo" cat-file tag "$object" |
            grep -q 'BEGIN .* SIGNATURE'; then
          printf 'signed\n'
        fi
      done | wc -l | tr -d ' '
  )"
  core_history="$(
    git -C "$repo" log --format='%H' -- packages/connector-api |
      LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  harness_history="$(
    git -C "$repo" log --format='%H' -- packages/connector-testkit |
      LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  core_follow="$(
    git -C "$repo" log --follow --format='%H' \
      -- packages/connector-api/package.json |
      LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  harness_follow="$(
    git -C "$repo" log --follow --format='%H' \
      -- packages/connector-testkit/package.json |
      LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  core_blame_commits="$(
    git -C "$repo" blame --line-porcelain HEAD \
      -- packages/connector-api/package.json |
      awk 'length($1)==40 {print $1}' |
      LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  harness_blame_commits="$(
    git -C "$repo" blame --line-porcelain HEAD \
      -- packages/connector-testkit/package.json |
      awk 'length($1)==40 {print $1}' |
      LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  migration_blame_lines="$(
    {
      git -C "$repo" blame --line-porcelain HEAD \
        -- packages/connector-api/package.json
      git -C "$repo" blame --line-porcelain HEAD \
        -- packages/connector-testkit/package.json
    } | grep -c '^author-mail <migration@example.invalid>$' || true
  )"
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
  forbidden_paths="$(
    git -C "$repo" log --format= --name-only HEAD --not "$app_base" |
      sed '/^$/d' |
      { grep -Ev '^packages/(connector-api|connector-testkit)/' || true; } |
      LC_ALL=C sort -u | wc -l | tr -d ' '
  )"
  fsck_lines="$(git -C "$repo" fsck --full --no-dangling 2>&1 | wc -l | tr -d ' ')"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$method" "$tree_digest" "$graph_digest" "$ref_digest" \
    "$tag_ref_digest" "$tag_count" "$annotated_tag_count" "$signed_tag_count" \
    "$core_history" "$harness_history" \
    "$core_follow" "$harness_follow" "$core_blame_commits" \
    "$harness_blame_commits" "$migration_blame_lines" \
    "$added_count" "$author_count" \
    "$added_object_count" "$added_object_bytes" "$forbidden_paths" >> "$result_file"
  test "$fsck_lines" = "0"
}

printf 'method\ttree_sha256\tgraph_sha256\tref_sha256\ttag_ref_sha256\ttag_count\tannotated_tag_count\tsigned_tag_count\tcore_history_commits\ttestkit_history_commits\tcore_follow_package_commits\ttestkit_follow_package_commits\tcore_blame_commits\ttestkit_blame_commits\tmigration_blame_lines\tadded_commits\tadded_authors\tadded_objects\tadded_logical_bytes\tout_of_boundary_history_paths\n' \
  > "$result_file"

split_source="$scratch_root/connectors-split"
git clone --quiet --no-local "$connector_repo" "$split_source"
git -C "$split_source" config core.hooksPath /dev/null
git -C "$split_source" checkout --quiet --detach "$connector_base"
core_tip="$(
  git -C "$split_source" subtree split \
    --prefix=packages/core "$connector_base"
)"
testkit_tip="$(
  git -C "$split_source" subtree split \
    --prefix=packages/test-harness "$connector_base"
)"

subtree_repo="$scratch_root/subtree"
new_destination "$subtree_repo"
git -C "$subtree_repo" subtree add \
  --prefix=packages/connector-api "$split_source" "$core_tip" \
  -m "Rehearse connector API subtree import" >/dev/null
git -C "$subtree_repo" subtree add \
  --prefix=packages/connector-testkit "$split_source" "$testkit_tip" \
  -m "Rehearse connector testkit subtree import" >/dev/null
record_metrics "subtree-splits" "$subtree_repo"

filtered_source="$scratch_root/connectors-filtered"
git clone --quiet --no-local "$connector_repo" "$filtered_source"
git -C "$filtered_source" config core.hooksPath /dev/null
git -C "$filtered_source" branch -f candidate "$connector_base"
git -C "$filtered_source" checkout --quiet candidate
filter_refs=(candidate)
while IFS=$'\t' read -r ref object; do
  git -C "$filtered_source" update-ref "$ref" "$object"
  filter_refs+=("$ref")
done < <(
  printf '%s' "$audit_json" |
    jq -r '.candidate.refs[] |
      select(.ref | startswith("refs/tags/")) |
      [.ref,.object_id] | @tsv'
)
(
  cd "$filtered_source"
  uvx --from git-filter-repo==2.47.0 git-filter-repo \
    --force \
    --path packages/core \
    --path packages/test-harness \
    --path-rename packages/core/:packages/connector-api/ \
    --path-rename packages/test-harness/:packages/connector-testkit/ \
    --refs "${filter_refs[@]}" >/dev/null
)

filter_repo="$scratch_root/filter-repo"
new_destination "$filter_repo"
git -C "$filter_repo" remote add connectors-filtered "$filtered_source"
git -C "$filter_repo" fetch --quiet connectors-filtered refs/heads/candidate
git -C "$filter_repo" merge --quiet --allow-unrelated-histories --no-ff \
  FETCH_HEAD -m "Rehearse filtered connector import"
import_tags "$filter_repo" "$filtered_source" "filter-repo"
record_metrics "filter-repo" "$filter_repo"

unrelated_repo="$scratch_root/unrelated"
new_destination "$unrelated_repo"
git -C "$unrelated_repo" remote add connectors "$connector_repo"
git -C "$unrelated_repo" fetch --quiet connectors "$connector_base"
source_tip="$(git -C "$unrelated_repo" rev-parse FETCH_HEAD)"
git -C "$unrelated_repo" read-tree \
  --prefix=packages/connector-api/ "$source_tip:packages/core"
git -C "$unrelated_repo" read-tree \
  --prefix=packages/connector-testkit/ "$source_tip:packages/test-harness"
integration_tree="$(git -C "$unrelated_repo" write-tree)"
integration_commit="$(
  printf 'Rehearse unrelated connector import\n' |
    git -C "$unrelated_repo" commit-tree "$integration_tree" \
      -p "$app_base" -p "$source_tip"
)"
git -C "$unrelated_repo" reset --quiet --hard "$integration_commit"
import_tags "$unrelated_repo" "$connector_repo" "unrelated-merge"
record_metrics "unrelated-merge" "$unrelated_repo"

cat "$result_file"
