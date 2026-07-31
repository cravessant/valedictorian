# Portable workspace capability and authority protocol

Status: accepted by the maintainer under
[P03](https://github.com/cravessant/valedictorian-app/issues/528).

This decision defines the wire-level capability, state, and failure contract
that local extraction and any future cloud implementation must share. It does
not create a cloud repository, move persistence, or publish a package.
Reversing an invariant requires a superseding decision.

## Authority invariants

A workspace keeps one stable `workspaceId` across restores and authority moves.
Every writable authority has a unique `authorityId` and a monotonically
increasing `authorityEpoch`. Clients send the expected epoch on mutations and
rediscover on a mismatch.

At most one authority is writable. During the transfer fence, neither source
nor target is writable. Dual-write, offline mutation queues, offline merge,
last-writer-wins reconciliation, and blind reactivation of an old authority are
prohibited. Unavailability therefore fails a mutation closed; it never turns
the client into a second writer.

An `AbortSignal` cancels the caller's wait, not a command already admitted by an
authority. A caller that loses the response reads the immutable receipt by its
idempotency key before retrying. Explicit transfer abort and any supported
execution cancellation are separate protocol operations.

Receipt recovery is itself portable. The `workspace.receipts` capability
advertises `receipts.getByIdempotencyKey`; the lookup binds workspace, authority
epoch, exact operation and idempotency key and returns only the original
outcome. `receipt_not_found` never proves that a command did not commit, so it
does not authorize a blind retry.

## Capability and operation matrix

Capabilities have exactly three discovery states: `supported`, `unsupported`,
or `temporarily_unavailable`. Unsupported is stable until a capability change;
temporary unavailability permits bounded retry after rediscovery.

| Surface | Class | Authority and portability |
| --- | --- | --- |
| Health, capability and workspace discovery | Discovery | Read-only; discovery does not grant write authority |
| Captures, Jobs, Opportunities, Applications, Companies and capture resolution | Authoritative read/mutation | Portable; existing-resource mutations carry expected revision, epoch and idempotency key |
| Scores, action queue, policy, workflow runs and connectors | Read/mutation/execution as declared | Portable only when the authority advertises the specific operation |
| Profile document and agent context | Authoritative read/mutation | Portable; revision-safe and snapshot-owned |
| Secret list/upsert/delete | Secret administration | Portable metadata plus encrypted envelopes; never plaintext |
| Local secret resolve | Local secret resolution | Local-only and never proxied to a managed authority |
| Snapshot export/import and authority transfer | Migration control | Portable control plane with phase, epoch, fence and receipt guards |
| Create/open/re-key by filesystem path | Discovery/local administration | Local-runtime-only, not a cloud capability |

Every method in `@sparxie/sdk@0.36.0` is reconciled in
[`workspace-authority.json`](workspace-authority.json), including
`forWorkspace` and every nested root, lifecycle, capture-resolution, company
and workspace operation. Each exact operation has an independent capability
state path; a maintained test derives the released operation set from the
package declarations and rejects omissions or extras. P11 must preserve the
released v1 shape while adding the authority/capability contracts through
authored server schemas, deterministic OpenAPI and a generated client.
Portable discovery returns stable identity, source, authority epoch and
capability state. A local workspace path is optional local-only metadata; a
managed authority never exposes a server filesystem path. Discovery never
grants write authority.

All portable mutations are idempotent. Reusing a key with the same request
fingerprint returns the original result; reusing it with a different
fingerprint returns `idempotency_conflict`. Existing-resource mutations also
carry the current resource revision. Execution admission additionally carries
the current authority epoch and resource identity.

## Single-authority transfer

| Phase | Source | Target | Required evidence |
| --- | --- | --- | --- |
| Prepared | Active, writable | Candidate, read-only | Capabilities, stable identity, current epoch and BYOK readiness |
| Snapshot staged | Active, writable | Candidate, read-only | Base manifest/digests, compatibility and import receipt |
| Source fenced | Fenced, read-only | Candidate, read-only | Fence receipt, drained admitted writes and final snapshot at the fence |
| Final snapshot verified | Fenced, read-only | Candidate, read-only | Identity/count/file/integrity, secret-envelope and restore read-back |
| Activated | Fenced, read-only | Active, writable | Epoch increment, activation receipt, target health and source write rejection |
| Source retired | Retired, non-authoritative | Active, writable | Rollback window, retention/backup approval and no-authority read-back |

Activation is atomic from the protocol's perspective. It requires a verified
final snapshot tied to the source fence token, a current destination BYOK
proof, the expected source epoch and a matching activation idempotency
fingerprint. Routing changes are evidence, not authority by themselves.

The transfer state graph is closed:

`idle → prepared → snapshot_staged → source_fenced →
final_snapshot_verified → activated → source_retired`.

Before activation, `prepared`, `snapshot_staged`, `source_fenced` and
`final_snapshot_verified` may transition to the terminal `aborted` state
through the applicable explicit abort operation. A command failure never
silently advances the phase. Before the fence, the source remains active. After
the fence, both replicas stay read-only until a retry succeeds or an explicit
abort safely un-fences the source. After activation, the target remains the
current authority even when later observation or retirement work fails.

Fencing stops every mutation-admission path, including scheduler claims; an
HTTP routing gate alone is insufficient. Already admitted work must drain or
reach an explicit durable settlement while preserving workflow, execution and
connector lineage. Active work blocks the final snapshot. A quiesce timeout
keeps the source fenced and permits retry or explicit abort; it never activates
the candidate.

Before activation, abort discards the candidate. If the source was already
fenced, the abort must first prove that the target never activated, then issue
an authenticated abort receipt before un-fencing the same source. After
activation, abort is forbidden. Returning to the former source is a new reverse
transfer from the current authority with a new transfer id, snapshot, fence and
authority epoch. An old activation receipt can never reactivate a writer.

The complete state matrix includes `idle` and `aborted`, not only active
transfer phases. Those are the only states outside the pre-fence transfer
phases where the source is writable, and in both the target is absent or
retired and non-writable. The maintained test proves the one-writer bound over
every state.

Retirement is later and separately approved. It waits for the rollback window,
retention decision, supported backup/restore proof and removal of routing and
authority. P03 does not authorize data deletion.

## Snapshots, receipts and secrets

An immutable, content-addressed snapshot manifest records workspace and
authority identity, epoch, opaque revision, schema, file sizes and SHA-256
digests, logical counts, secret-envelope count and required capabilities. A
final transfer snapshot must name its fence token. It contains neither local
filesystem paths nor plaintext secret values.

Every mutation and transfer transition produces an immutable, secret-free
receipt authenticated by its issuing authority. The receipt binds operation,
outcome, workspace, authority, epoch, transfer, idempotency key, request
fingerprint, actor, time, revision/phase and evidence digests. Receipts support
recovery after transport failure; they are not a second source of authority.

Portable secret state consists of identifiers, non-sensitive labels/kinds,
encrypted envelopes, key identifiers and rewrap/access proofs. Local protected
storage handles, local-resolution results, user key material and plaintext are
never portable. BYOK key material moves out of band from the user to the
authority. The transfer control plane sees only proof. Destination key access
must pass before fencing and again before activation; failure leaves the
current authority unchanged.

## Failure matrix

Failures use the released safe kinds: validation, not-found, conflict,
authentication, authorization, rate-limit, unavailable, integrity and
internal. The machine record assigns an exact status and recovery action to
each code.

Authority epoch, revision, idempotency, fence, retirement and transfer-phase
conflicts are HTTP 409. Identity/protocol mismatch, active work, quiesce timeout,
forbidden abort and ciphertext incompatibility are also explicit 409 outcomes.
Missing workspaces or transfers are 404. Malformed snapshots or forbidden
secret material are 422. Temporary capability/authority, BYOK or protected
storage unavailability is 503. Integrity failure is a typed 409 integrity
response. Authentication is 401, authorization 403, rate limiting 429 with
`Retry-After`, and unexpected failures are safe 500 responses. After any
ambiguous mutation failure, the client reads the receipt before retrying.

These authority failures are additive and cross-cutting. Released
endpoint-specific failures keep their exact code, HTTP status and safe kind and
take precedence over a cross-cutting fallback; P11 may not rename or alias
them.

## Verification and implementation gates

The machine-readable decision and maintained test derive and guard exact
operation-level reconciliation against the released SDK declarations,
capability identifiers, the complete single-writer state matrix, fence-bound
activation, abort/reverse-transfer rules, receipt recovery, secret exclusions,
idempotency and both the cross-cutting and released endpoint failure
vocabularies.

P11 owns schemas, OpenAPI, generated client and conformance fixtures without
moving persistence. P13 owns immutable backup/export, interruption injection,
identity/count/file/integrity/secret reconciliation and the downgrade window.
A future cloud implementation begins only with a real vertical slice and must
pass the same conformance without claiming local filesystem or local secret
resolution capabilities.
