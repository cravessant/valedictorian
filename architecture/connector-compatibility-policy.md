# Connector API compatibility and support policy

Status: accepted by the maintainer under [#521](https://github.com/cravessant/valedictorian-app/issues/521), with the authoritative decision recorded in [the approval comment](https://github.com/cravessant/valedictorian-app/issues/521#issuecomment-5151558549).

This ADR records the connector compatibility contract for Sprint 4 S4-C02. It
complements the accepted package-ownership, API-generation, static-Jobright,
and downstream-gating decisions in [P01](https://github.com/cravessant/valedictorian-app/issues/526),
[P02](https://github.com/cravessant/valedictorian-app/issues/527),
[P04](https://github.com/cravessant/valedictorian-app/issues/529),
[P08](https://github.com/cravessant/valedictorian-app/issues/544), and
[P09](https://github.com/cravessant/valedictorian-app/issues/545).

The original #521 decision did not itself authorize implementation or package
changes. The later [P22](https://github.com/cravessant/valedictorian-app/issues/562)
gate authorizes publication from `cravessant/valedictorian` without changing
the compatibility policy or package identities recorded here.

## Context

The connector boundary is a product-owned, in-process TypeScript runtime ABI.
It is intentionally the exception to the HTTP/OpenAPI direction in P04. The
ABI is authored as runtime Zod schemas and TypeScript interfaces, and is
consumed by the product host, statically installed connectors, and the
conformance testkit. Provider-private types and host persistence types remain
outside that boundary.

The package names and released root exports already form a public compatibility
surface. Compatibility therefore has to be defined using released packages and
their tarballs, not by reaching into a private application checkout or by
introducing a second universal SDK. This ADR defines the policy; it does not
claim that every future receipt or migration has already been implemented.

## Decision

### Public package identities and SDK role

- Retain the released identities and independent version lineages of
  `@sparxie/valedictorian-connectors-core` and
  `@sparxie/valedictorian-connectors-test-harness`, including their root
  exports. No rename or version reset is authorized.
- The core package is the connector developer SDK and the runtime ABI. It owns
  the connector runtime schemas and TypeScript types.
- `@sparxie/sdk` is a transitional compatibility facade, not a third permanent
  connector SDK. Connector-owned schemas and types move into the core package;
  no new universal SDK or shared-types package is introduced.

### Independent semantic versioning

- The API and testkit are independently versioned. Before 1.0, an ABI-breaking
  change advances the minor line and a compatible addition or fix advances the
  patch line. At and after 1.0, standard major/minor/patch rules apply.
- The testkit declares its compatible API range and is published after the API
  package. A connector declares its supported API range through ordinary
  package metadata, while the product host locks exact released connector
  versions.
- The minimum supported API version is the immediately previous compatibility
  line while the newest line is current. Both remain supported for at least two
  product releases and 30 days. Deprecations remain functional for that window
  and are removed only in a later breaking line.
- Released artifacts are immutable. Rollback means continuing to use an older
  release or publishing a corrective release; a published version is never
  rewritten or unpublished.

### Support tiers

Maintained and community connectors use the same public API and conformance
testkit. A maintained connector is one for which Valedictorian owns release,
CI, and support response and tests the supported compatibility matrix. For a
community connector, the publisher owns releases and conformance evidence.
Community status grants no private source, credentials, or alternate ABI.

### Conformance ownership

Connector-owned CI proves, against released API and testkit artifacts:

- isolated package installation and the allowed dependency/import closure;
- public schema and type conformance;
- configuration, filtering, authentication, capture, refresh, checkpoint,
  and dynamic-option behavior;
- output sanitization; and
- stable conformance receipts.

The application owns exact static registration, secret storage and resolution,
scheduling and backoff, persistence and transactions, workspace mapping, and
host lifecycle integration. Dynamic loading, installation, and sandbox
behavior are explicitly deferred to [#522](https://github.com/cravessant/valedictorian-app/issues/522).

### Released-artifact compatibility and failure receipts

Compatibility is evaluated against released package metadata and tarballs,
never against private application or workspace `HEAD`. Package-range and
install failures, together with stable conformance test identifiers, report
the expected and observed API and testkit versions in CI receipts. A receipt
must make the released inputs and the failure or conformance outcome
unambiguous without importing private source.

The current sprint uses exact static dependencies. Runtime manifest/version
negotiation and loader failure codes are therefore deferred to
[#520](https://github.com/cravessant/valedictorian-app/issues/520) and
[#522](https://github.com/cravessant/valedictorian-app/issues/522); this ADR
does not add those fields or authorize a loader.

### Isolation, static Jobright, and deferred scope

Connector development and conformance require no private application/workspace
source, fleet link, or cross-repository credential. Jobright remains an
independently released, Valedictorian-maintained, exact-version static
connector as recorded in P09. Marketplace manifests, registries, loaders,
publisher/platform/permission metadata, and dynamic compatibility fields are
out of scope for this decision and remain in #520/#522.

## Consequences

The two connector packages remain stable public release edges, with the core
package serving both SDK authors and the host ABI. Independent release order,
range declarations, and the two-release/30-day support window make compatible
upgrades and deprecations observable without coupling connector code to a
private checkout. Maintained and community implementations can use the same
conformance evidence while differing only in release and support ownership.

The policy requires future connector CI to preserve released-artifact receipts
and to keep host lifecycle responsibilities out of the connector contract. It
does not move packages, change dependencies, publish artifacts, add runtime
negotiation, or implement dynamic loading. Those implementation and publication
proofs remain the gates named by P08 and the connector transition plan.

## Status

This ADR is accepted for #521. Before publication, it may be superseded by a
new accepted decision while the current package identities and facade remain
available. After publication, versions are immutable; changes use the stated
support window, a later breaking line, or a corrective release. No additional
human approval gate is implied by this ADR.

The machine-readable reconciliation is
[`connector-compatibility-policy.json`](connector-compatibility-policy.json),
guarded by the maintained test
[`scripts/connector-compatibility-policy.test.mjs`](../scripts/connector-compatibility-policy.test.mjs).
