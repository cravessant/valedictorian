# Repository and package ownership

Status: accepted by the maintainer under
[P02](https://github.com/cravessant/valedictorian-app/issues/527).

This decision supersedes the rule that Sparxie owns a universal SDK. It accepts
five product- and service-aligned target repositories, maps every approved S02
destination to one of them, and gives every transitional repository a terminal
disposition. Reversing a boundary requires a superseding decision.

## Decision

The target repositories are:

| Repository | Owner boundary | Lifecycle |
| --- | --- | --- |
| `cravessant/valedictorian` | Desktop product, portable workspace API, local runtime and CLI, connector API/testkit and local host | Rename `valedictorian-app` only after the signed history and disclosure gates |
| `cravessant/valedictorian-cloud` | Managed workspace implementation, managed BYOK secrets, cloud agents, customer dashboard and cloud-only controls | Do not create until a real end-to-end cloud vertical slice exists |
| `cravessant/valedictorian-source` | Source service, global catalog, operator dashboard and producer-owned source client | Existing independently deployed service |
| `cravessant/valedictorian-browser-runtime` | Browser acquisition service, protocol and producer-owned client | Existing independently deployed service |
| `cravessant/valedictorian-connector-jobright` | Static Jobright provider implementation, fixtures, conformance and releases | Existing public, independently released reference connector |

Repository boundaries represent either one product that changes and releases
together or an independently deployed, released, secured service/provider.
Package boundaries are sufficient for public compatibility or independent
release edges inside an owning repository. A separate repository is not created
merely because code builds as a package.

`valedictorian-cloud` is an accepted future boundary, not current scaffolding.
The present program does not create it, an empty cloud package, or imagined
managed operations. Its first native implementation plan must be driven by a
real vertical slice.

## S02 ownership reconciliation

The signed S02 adjudication covers 1,091 exports and 1,514 maintained consumer
rows, for 2,605 unique keys. The privacy-safe public projection is SHA-256
`580046c02fdf3d950bd60e38771354a3f853c508ac5f740d7d3ad411e806b1a1`.

| Approved export destination | Count | Repository | Public package boundary |
| --- | ---: | --- | --- |
| `packages/workspace/server` | 910 | `cravessant/valedictorian` | Product-internal workspace server subpath |
| `packages/workspace/client` | 50 | `cravessant/valedictorian` | Product-internal generated workspace client subpath |
| `source-client` | 126 | `cravessant/valedictorian-source` | Producer-owned Source client; P04/R02 approve its exact identity |
| `packages/connector-api` | 5 | `cravessant/valedictorian` | Current `@sparxie/valedictorian-connectors-core` identity through migration |

Maintained consumer destinations reconcile to the product-owned desktop,
workspace server/client, CLI, connector API and connector testkit surfaces.
There are no current portable conformance rows; P11 defines the conformance
subpath without moving product implementation tests into it. Jobright already
has no direct Sparxie row and remains an exact-version consumer of released
connector packages.

Source and Browser own their authored service schemas, deterministic OpenAPI,
generated clients and compatibility policies. Implementations never import the
generated clients they produce. The connector ABI is the intentional exception:
its TypeScript runtime schemas and interfaces are authored and published
directly by the product-owned connector API rather than generated through
OpenAPI.

## Package rules

- There is no `@valedictorian/sdk`, `@valedictorian/core`,
  `@valedictorian/types`, shared-types repository, or other universal catch-all.
- `@sparxie/sdk` is only a compatibility facade. It contracts after every
  maintained consumer migrates and after the P01 two-release plus 30-day
  support window; published versions are never unpublished.
- The current connector API/testkit identities remain independently versioned
  public ecosystem packages even though their source moves beside the product
  host. P22 owns any later identity or publisher cutover.
- `workspace-domain` waits for a concrete second implementation.
  `connector-host-conformance` waits for a real managed host.
  `managed-service-client` waits for implemented cloud-only operations and an
  approved consumer/auth/disclosure matrix.
- `@sparxie/valedictorian-cli`, the two connector package identities, and
  `@sparxie/valedictorian-connectors-jobright` retain their names and semver
  lineage through migration as required by P01. This ADR does not rename npm
  packages.
- Jobright remains a statically installed, exact-version package. Dynamic
  loading, installation and sandbox policy stay with
  [#522](https://github.com/cravessant/valedictorian-app/issues/522).

## Repository transitions

| Repository | Terminal disposition | Successor |
| --- | --- | --- |
| `cravessant/valedictorian-app` | Rename after exact-history and disclosure approval; preserve redirect/history | `cravessant/valedictorian` |
| `KennyKeni/sparxie` | Deprecate the facade, preserve packages/releases/issues, then archive without unpublishing | None |
| `cravessant/valedictorian` | Import history, replace vendoring, cut over distribution, then archive | `cravessant/valedictorian` |
| `cravessant/valedictorian-connectors` | Publish transition packages, import API/testkit history, transfer publishers, then archive | `cravessant/valedictorian` |
| `cravessant/valedictorian-dash` | Import into Source, cut over the operator deployment, then archive | `cravessant/valedictorian-source` |
| `cravessant/valedictorian-workspace` | Replace every retained proof in owner CI, then archive; never become fleet CI | None |
| `cravessant/valedictorian-source-legacy` | Transfer authority, complete the rollback window and approved data retirement, then archive without deletion | `cravessant/valedictorian-source` |

Archive is reversible and repository deletion is out of scope. Publisher,
visibility, deployment, authority and data-retirement cutovers remain separate
events with their own gates and receipts.

## Rollback and change control

Before an implementation gate, reject or supersede this ADR and keep current
owners authoritative. After implementation begins, additive replacement
releases and compatibility facades provide rollback; completed publications are
never rewritten or unpublished. Public disclosure cannot be undone by making a
repository private, and authority/data deletion occurs only in its dedicated
post-window leaves.

The machine-readable reconciliation is
[`repository-ownership.json`](repository-ownership.json); its maintained test
guards target count, complete S02 coverage, forbidden universal packages,
deferred empty boundaries and terminal repository dispositions.
