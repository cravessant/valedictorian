# Producer-owned OpenAPI clients and acyclic imports

Status: accepted by the maintainer under
[P04](https://github.com/cravessant/valedictorian-app/issues/529).

This decision fixes contract ownership and dependency direction before any
package moves. It does not implement a generator, move persistence, publish a
package, or create a shared-types layer. Reversing an accepted edge or client
owner requires a superseding decision.

## Decision

Each HTTP service owns one complete contract pipeline:

`authored server schemas → deterministic OpenAPI → generated client`

The service repository owns all three stages and their compatibility policy.
The OpenAPI document and client are generated artifacts; neither is an
alternate source of truth. A producer implementation imports its authored
schemas and private implementation, never the generated client it produces.
A consumer imports the released client, never a foreign producer's server
schemas, ORM types, domain entities, or implementation.

Generated clients are leaves. They do not import their producer runtime,
authored runtime schemas, or another generated client. Integration code in a
consumer composes separate clients. This prevents cycles such as
`source-client → workspace-client → source-client` and keeps a service free to
change its internal language, framework, persistence and domain model behind
the wire.

## HTTP boundaries

| Boundary | Authored authority | OpenAPI | Generated client | Initial consumers |
| --- | --- | --- | --- | --- |
| Portable workspace | `cravessant/valedictorian` `packages/workspace/server` | `packages/workspace/openapi/workspace.openapi.json` | public `@sparxie/valedictorian-workspace-client` | desktop, CLI, workspace conformance and a future real managed adapter |
| Source | `cravessant/valedictorian-source` server schemas | `openapi/source.openapi.json` | public `@valedictorian/source-client` when a public product consumer requires it | product Source adapter and operator dashboard |
| Browser Runtime | `cravessant/valedictorian-browser-runtime` Pydantic/FastAPI models | `openapi/browser-runtime.openapi.json` | private `@valedictorian/browser-runtime-client` | Source only until another caller is explicitly approved |

Every caller-visible path, method, body, header, status, safe error,
authentication rule and operation id belongs to its row. Workspace coverage
includes unscoped discovery, every released `/v1` operation, V2 Capture
Resolution and explicitly classified local-only secret/filesystem operations.
The producer cannot split authority across a handwritten client and the server
model.

P11 implemented the producer-owned schemas, deterministic OpenAPI and generated
client while preserving the P03 operation, capability and failure contract.
P25 later authorized public npm publication of the workspace server, client,
conformance package and local runtime without making the root workspace public.
This later implementation does not change the original S02 consumer evidence.
The route-registry/spec/client bijection and undeclared-path rejection remain
required release proofs alongside explicit local/private classifications.

Source currently contains tooling scaffolding but no real service command
surface. R02 must record real project commands and routes before choosing a
generator or inventing operations; R04 implements the client and R05 owns
publication.

Browser Runtime currently uses Pydantic/FastAPI models and can compute private
`app.openapi()`, while its public OpenAPI URL is disabled. That is not a
checked-in deterministic spec or released client. B01 approves exact
caller-visible routes, Source-only caller policy, authentication, quotas and
evidence bounds; B02 implements the generator/client; B03 owns publication.

Browser Runtime health endpoints are operational probes, not part of the
Source-facing generated client. The API process owns `/health/live` and
`/health/ready`; the runner-dispatch process owns its own `/health/ready`.
Their authorized infrastructure consumers and no-client policy are explicit
in the machine record.

Browser Runtime also owns two private HTTP contracts that do not enter the
Source-facing client: worker/coordinator job claim, renew, complete and fail;
and runner dispatch/acceptance, event and assignment coordination. Each gets a
separate deterministic internal OpenAPI and repository-private generated peer
process client. A process serving one of those contracts never imports its own
client; another process in the repository may consume it. Existing handwritten
worker/coordinator/dispatch clients are migration inputs, not exceptions.
Prometheus `/internal/metrics` and `/metrics` are separately classified
operational text scrapes with no generated JSON client.

## Connector ABI exception

The connector boundary is deliberately not HTTP. The product-owned connector
API publishes authored Zod runtime schemas and TypeScript interfaces through
the existing `@sparxie/valedictorian-connectors-core` identity, with
`@sparxie/valedictorian-connectors-test-harness` as its conformance testkit.
The product host and statically installed connectors import that released ABI
directly.

It does not generate an OpenAPI client for in-process calls. Provider-private
types never enter the host contract, host persistence types never enter a
connector, and the ABI imports no service client. This exception does not
authorize a loader, installer, sandbox, or dynamic plugin contract.

## Type and import rules

The service that accepts or emits a wire value owns its schema. Database/ORM
types, internal entities, provider models and foreign service schemas do not
cross the wire. Consumer copies are not authoritative.

There is no `@valedictorian/sdk`, `@valedictorian/core`,
`@valedictorian/types`, shared-types repository, or hidden universal schema
package. Ordinary standards such as RFC 3339 strings, UUID strings, URI
strings and opaque cursors are spelled in each owner schema until a concrete
cross-owner runtime dependency proves a smaller shared package is necessary.

Allowed dependencies are exact and one-way:

- server → its authored schemas;
- OpenAPI generation → its authored schemas and route/error metadata;
- client generation → its OpenAPI;
- consumer → released generated client;
- Source server, acting as a consumer → released Browser Runtime client;
- product host, static connector and connector testkit → released connector
  ABI.

Forbidden dependencies include producer → own generated client, client →
producer or authored runtime schema, cross-service schema reuse, generated
client → generated client, connector ABI → service client, and any edge
through a universal shared-types package.

## Compatibility

Every operation has a unique stable operation id and explicit request,
response, header, status, authentication and safe-error shapes. Request
schemas are closed by default and unknown response shapes fail closed.

Compatibility is checked against the last released OpenAPI and client.
Adding an operation or truly optional field can be compatible only when old
server/client behavior remains defined. Removing or renaming operations or
fields, changing method/path/status/header/error/auth/idempotency/retry
semantics, narrowing accepted input, making input required, or adding a value
to an exhaustively handled closed enum is breaking.

A breaking change uses a new major or versioned HTTP path, runs both versions
through an explicit migration window, migrates every maintained consumer, and
removes the old contract only in a later approved contraction. Published
specs and clients are immutable. One producer release binds the client
artifact to the exact spec digest. `@sparxie/sdk` remains a transitional
compatibility facade and gains no new permanent ownership.

## Deterministic generation and proof

Generator inputs are only authored schemas, route/operation metadata, the
safe-error registry, and pinned generator/formatter configuration. Wall-clock
time, randomness, absolute checkout paths, network state, dirty state,
environment iteration order, secrets and deployment configuration cannot
affect output.

Each implementation must prove, independently for its public and private
HTTP contracts:

- two spec generations and two client generations are byte-identical;
- regeneration in a clean checkout has an empty diff;
- paths, operations, components, keys and line endings are canonical, with no
  timestamps or host paths;
- operation ids are unique/stable and compatibility is checked against the
  last release;
- the real route registry, OpenAPI operations and generated client operations
  form a bijection, with every local/private route classified explicitly;
- producer sources cannot import their generated client;
- the complete directed graph is acyclic and rejects the maintained negative
  fixtures;
- generated files reject manual edits;
- the package tarball contains only declared runtime files;
- a disposable consumer installs the packed artifact, typechecks, and
  exercises a representative call fixture without fleet/source links.

The machine record
[`api-generation-direction.json`](api-generation-direction.json) names every
boundary, exact allowed and forbidden edge, client identity, compatibility
rule, generator proof and cycle fixture. Its maintained test fails if the
model becomes cyclic, a client identity/owner changes, a proof disappears, or
a negative fixture is admitted.

Those P04 fixtures prove the accepted dependency model, not nonexistent
generated bytes or a future source graph. P11, R02/R04 and B01/B02 must apply
the model to their real sources and supply the actual byte-determinism,
staleness, producer-import, tarball and disposable-consumer receipts.

## Rollback and downstream gates

Before downstream implementation, supersede this decision and retain current
facades. After a generated client is released, rollback is an additive
producer release or continued old major during its support window; a
published version is never rewritten or unpublished.

P11, R02/R04 and B01/B02 implement their own rows and must pass the same
direction and generator proofs. Their dedicated publication leaves remain the
only publication gates. P04 itself authorizes no package move, persistence
move, registry publication, Source operation invention, additional Browser
caller, cloud scaffolding, or premature shared primitive.
