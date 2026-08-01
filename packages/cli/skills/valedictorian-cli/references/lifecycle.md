# Canonical Lifecycle

Read this before creating, correcting, promoting, removing, restoring, or refreshing a Capture, Job, Opportunity, or Application.

## Contents

- Lifecycle boundaries
- Promotion protocol
- Result decisions
- Verification
- Removal and history

## Lifecycle Boundaries

### Capture

A Capture is an immutable observed source revision owned by a workspace. It preserves adapter provenance, Evidence mode, observation/receipt time, bounded payload, and evidence. Correction adds an attributable revision; it does not rewrite provenance, Evidence mode, or timestamps.

- `reported`: Capture → Job may use the configured hosted employer/ATS retrieval boundary.
- `ats_details_provided`: trust only the supplied ATS details after local validation. Never fall back to external ATS retrieval when they are incomplete.

Retrieval and semantic normalization belong only at Capture → Job. Job → Opportunity and Opportunity → Application must not browse, retrieve, or re-resolve the posting.

### Job

A Job is the canonical factual aggregate. It owns a UUIDv7 internal id, versioned facts, separately versioned availability, normalized strong/provisional external identities, and references to exact Capture revisions and evidence indexes. It references evidence rather than copying Capture payloads.

Provider ids, URLs, Capture ids, and promotion ids are not Job ids. Descriptive similarity alone does not establish identity.

### Opportunity

An Opportunity is this workspace's evaluation of one Job. It owns only fit, rank, cutoff, disposition, and optional override evidence. It never copies company, role, location, compensation, destination, or other Job facts.

### Application

An Application records the decision to pursue. It references both Opportunity and Job and owns pursuit status, current display/link edits, and a deliberate snapshot of the Job facts used when pursuit began. Job changes do not refresh the snapshot automatically.

Refresh only with current Application and Job facts revisions and explicit preserve-company, preserve-source, and preserve-link choices.

## Promotion Protocol

For each boundary:

1. Run `get` and `history` on the source. Re-read linked upstream records and capture current revisions.
2. Confirm the workspace/API target and clear intent for this mutation.
3. Build the complete strict `--input-json`; omit the positional source id.
4. Use one stable idempotency key for retries of the same intended operation. Do not reuse it for a changed decision.
5. Execute exactly one promotion with `--json`.
6. Classify the discriminated result before doing anything downstream.
7. Verify the returned target with `get`, `history`, and lineage checks.

Use the returned target id for the next boundary. `created: false` can be a valid idempotent replay or attachment; it does not prove a new resource was created.

## Result Decisions

| Result | Agent action |
| --- | --- |
| `promoted` without warnings | Verify target and lineage, then continue if the user intended the next boundary. |
| `promoted` with warnings | Preserve and report every warning. Continue only when existing user/workspace policy makes the judgment deterministic. |
| Warning needs override | Obtain or locate explicit authority. Supply the exact warning codes present, actor, and non-empty rationale. Never invent an override. |
| `blocked` | Stop. Preserve the structured blocker and inspect current state before proposing a remedy. |
| `deterministic_duplicate` | Re-read the conflicting id. Require an exact `attach` or `merge` decision; supply action and target together. |
| Revision conflict / HTTP 409 | Re-read current head and history, then rebuild the decision. Do not replay stale JSON. |
| Not found / HTTP 404 | Re-check workspace and id. Never recreate a record merely to mask missing lineage. |

`attach` converges evidence or lineage onto the identified existing aggregate. `merge` performs stronger reconciliation. Never choose between them from name, title, URL similarity, or convenience alone.

Warnings are policy judgments, not structural failures: `fit`, `rank`, `cutoff`, `missing_optional_facts`, `third_party_destination`, and `weak_possible_match`. Blockers are structural/security failures and must not be overridden as warnings.

## Verification

After Capture → Job:

- `jobs get <job-id>` and `jobs history <job-id>`.
- Confirm the Job references the intended Capture id, exact Capture revision, and evidence indexes.
- Inspect returned external identities; do not assume caller declarations were persisted byte-for-byte.

After Job → Opportunity:

- `opportunities get <opportunity-id>` and `opportunities history <opportunity-id>`.
- Confirm `jobId`, evaluation, disposition, and the Job facts revision used for the decision.

After Opportunity → Application:

- `applications get <application-id>` and `applications history <application-id>`.
- Confirm both `opportunityId` and `jobId`.
- Verify the pursuit snapshot and its initial links explicitly; do not assume mutable current links prove the creation-time snapshot.

Current reconstructed histories may expose some head-state fields rather than perfect point-in-time values. Treat revision kinds, bounded audits, source evidence, and separate receipts as proof; do not claim historical fidelity the returned record does not demonstrate.

## Removal And History

Removal is a tombstone operation. Start with `reject_if_dependents` unless the user already chose otherwise. If blocked, inspect `supportedChoices` and `dependentIds`.

- `preserve_historical_lineage` retains history where supported.
- `unlink_dependents` deliberately breaks links.
- `cascade_tombstone` affects downstream resources.

Never escalate the removal choice silently. Restore does not reconnect previously unlinked dependents; verify lineage after restoration or re-promotion.
