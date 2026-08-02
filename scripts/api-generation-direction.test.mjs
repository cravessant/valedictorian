import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const decisionPath = path.join(
  repositoryRoot,
  'architecture/api-generation-direction.json',
)
const decision = JSON.parse(fs.readFileSync(decisionPath, 'utf8'))
const nodes = new Map(decision.nodes.map((node) => [node.id, node]))
const allowedEdgeSet = new Set(
  decision.allowedDependencyEdges.map(({ from, to }) => `${from}->${to}`),
)

function findCycle(edges) {
  const adjacency = new Map()
  for (const [from, to] of edges) {
    adjacency.set(from, [...(adjacency.get(from) ?? []), to])
  }
  const active = new Set()
  const visited = new Set()

  function visit(node) {
    if (active.has(node)) return true
    if (visited.has(node)) return false
    active.add(node)
    for (const target of adjacency.get(node) ?? []) {
      if (visit(target)) return true
    }
    active.delete(node)
    visited.add(node)
    return false
  }

  return [...nodes.keys()].some(visit)
}

function forbiddenCode([fromId, toId]) {
  const from = nodes.get(fromId)
  const to = nodes.get(toId)
  expect(from, `fixture source ${fromId} must exist`).toBeDefined()
  expect(to, `fixture target ${toId} must exist`).toBeDefined()

  return decision.forbiddenDependencyRules.find((rule) => {
    if (rule.fromRole !== from.role || rule.toRole !== to.role) return false
    const sameBoundary = from.boundary === to.boundary
    return rule.sameBoundary === sameBoundary
  })?.code
}

function fixtureOutcome(edges) {
  for (const edge of edges) {
    const code = forbiddenCode(edge)
    if (code) return code
  }
  if (findCycle(edges)) return 'dependency-cycle'
  return edges.every(([from, to]) => allowedEdgeSet.has(`${from}->${to}`))
    ? 'accepted'
    : 'undeclared-dependency-edge'
}

describe('producer-owned API generation direction decision', () => {
  it('accepts exactly the three real HTTP service boundaries', () => {
    expect(decision.httpBoundaries.map((boundary) => boundary.id)).toEqual([
      'workspace',
      'source',
      'browser_runtime',
    ])
    expect(
      new Set(decision.httpBoundaries.map((boundary) => boundary.ownerRepository)),
    ).toEqual(new Set([
      'cravessant/valedictorian',
      'cravessant/valedictorian-source',
      'cravessant/valedictorian-browser-runtime',
    ]))
    expect(
      decision.httpBoundaries.every(
        (boundary) =>
          boundary.authoredSchemaBoundary &&
          boundary.openApiArtifact &&
          boundary.generatedClientBoundary &&
          boundary.contractScope.length >= 6,
      ),
    ).toBe(true)
  })

  it('names the exact producer-owned client identities and visibility', () => {
    const byId = Object.fromEntries(
      decision.httpBoundaries.map((boundary) => [boundary.id, boundary]),
    )
    expect(byId.workspace).toMatchObject({
      packageIdentity: '@sparxie/valedictorian-workspace-client',
      publicationPackageIdentities: [
        '@sparxie/valedictorian-workspace-server',
        '@sparxie/valedictorian-workspace-client',
        '@sparxie/valedictorian-workspace-conformance',
        '@sparxie/valedictorian-local-runtime',
      ],
      visibility: 'public-product-npm-packages',
      generatedClientBoundary: 'packages/workspace/client',
      currentRepository: 'cravessant/valedictorian',
      implementationStatus: 'implemented',
      publicationAuthorized: true,
      publicationIssue:
        'https://github.com/cravessant/valedictorian-app/issues/565',
    })
    expect(byId.source).toMatchObject({
      packageIdentity: '@valedictorian/source-client',
      visibility: 'public-npm-when-required-by-public-product-consumer',
      ownerRepository: 'cravessant/valedictorian-source',
    })
    expect(byId.browser_runtime).toMatchObject({
      packageIdentity: '@valedictorian/browser-runtime-client',
      visibility: 'private-producer-release',
      ownerRepository: 'cravessant/valedictorian-browser-runtime',
    })
    expect(byId.browser_runtime.clientConsumers).toEqual([
      'valedictorian-source-only-until-an-additional-caller-is-approved',
    ])
    expect(byId.browser_runtime.internalHttpContracts).toEqual([
      {
        id: 'worker_coordinator',
        paths: [
          '/internal/v1/jobs/claim',
          '/internal/v1/jobs/claim-operation',
          '/internal/v1/jobs/renew',
          '/internal/v1/jobs/complete',
          '/internal/v1/jobs/fail',
        ],
        authPrincipals: ['worker', 'coordinator'],
        openApiArtifact:
          'openapi/browser-runtime-worker-coordinator.openapi.json',
        generatedClientBoundary: 'internal-clients/worker-coordinator',
        packageIdentity: null,
        visibility: 'repository-private-peer-process-client',
        serverImportsGeneratedClient: false,
      },
      {
        id: 'runner_dispatch',
        pathPrefixes: ['/internal/v1/dispatch/', '/internal/v1/runner/'],
        authPrincipals: ['dispatch-coordinator', 'runner'],
        openApiArtifact: 'openapi/browser-runtime-runner-dispatch.openapi.json',
        generatedClientBoundary: 'internal-clients/runner-dispatch',
        packageIdentity: null,
        visibility: 'repository-private-peer-process-client',
        serverImportsGeneratedClient: false,
      },
    ])
    expect(byId.browser_runtime.operationalHttpSurfaces).toEqual([
      {
        paths: ['/internal/metrics', '/metrics'],
        mediaType: 'prometheus-text',
        generatedJsonClient: false,
        classification:
          'authenticated-or-network-private-operational-scrape',
      },
    ])
    expect(byId.browser_runtime.healthHttpSurfaces).toEqual([
      {
        servingProcess: 'browser-runtime-api',
        paths: ['/health/live', '/health/ready'],
        consumers: [
          'container-orchestrator',
          'private-worker-gateway',
          'slot-agent',
          'authorized-operations',
        ],
        generatedJsonClient: false,
        classification: 'operational-liveness-and-readiness-probes',
      },
      {
        servingProcess: 'runner-dispatch',
        paths: ['/health/ready'],
        consumers: ['container-orchestrator', 'authorized-operations'],
        generatedJsonClient: false,
        classification: 'operational-readiness-probe',
      },
    ])
  })

  it('keeps current observations truthful and implementation deferred', () => {
    const baselines = Object.fromEntries(
      decision.httpBoundaries.map((boundary) => [
        boundary.id,
        boundary.currentBaseline,
      ]),
    )
    expect(baselines.workspace).toEqual({
      contract: 'producer-owned-workspace-schema-openapi-and-generated-client',
      operationEvidence: 'architecture/workspace-authority.json',
      generatedPipelineExists: true,
      implementationRisk:
        'regex-route-dispatch-sdk-schema-casts-and-prefix-based-ipc-allowance-must-be-replaced-without-contract-drift',
    })
    expect(baselines.source).toEqual({
      contract: null,
      repositoryState: 'tooling-scaffold-with-no-real-source-server-commands',
      generatedPipelineExists: false,
    })
    expect(baselines.browser_runtime).toEqual({
      contract: 'fastapi-pydantic-models',
      openApiGeneration: 'private-app.openapi()-only',
      checkedInSpecExists: false,
      generatedPipelineExists: false,
      handwrittenInternalClients: [
        'worker_api_client.py',
        'coordinator_api_client.py',
        'runner_dispatch_client.py',
        'dispatch_acceptance_client.py',
      ],
    })
    expect(decision.invariants).toMatchObject({
      packageMovementAuthorized: false,
      implementationAuthorized: false,
      p25PackagePublicationAuthorized: true,
    })
  })

  it('makes the connector ABI the only non-OpenAPI contract exception', () => {
    expect(decision.connectorAbiException).toEqual({
      id: 'connector_abi',
      ownerRepository: 'cravessant/valedictorian',
      currentRepository: 'cravessant/valedictorian',
      transport: 'in-process-versioned-typescript-runtime-abi',
      openApi: false,
      authoredContract: 'zod-runtime-schemas-and-typescript-interfaces',
      packageIdentities: [
        '@sparxie/valedictorian-connectors-core',
        '@sparxie/valedictorian-connectors-test-harness',
      ],
      allowedConsumers: [
        'product-connector-host',
        'released-static-connector-implementations',
        'connector-testkit',
      ],
      forbidden: [
        'provider-private-types-in-host-contract',
        'host-persistence-types-in-connector-contract',
        'generated-openapi-client-for-in-process-calls',
        'dynamic-loader-or-installer-contract',
        'shared-service-types-through-connector-abi',
      ],
      compatibility:
        'independent-semver-runtime-schema-and-declaration-conformance',
      publicationAuthorized: true,
      publicationIssue:
        'https://github.com/cravessant/valedictorian-app/issues/562',
      staticJobrightIssue:
        'https://github.com/cravessant/valedictorian-app/issues/545',
      dynamicLoadingIssue:
        'https://github.com/cravessant/valedictorian-app/issues/522',
    })
  })

  it('has a unique closed node inventory and an acyclic allowed graph', () => {
    expect(nodes.size).toBe(decision.nodes.length)
    const allowedEdges = decision.allowedDependencyEdges.map(({ from, to }) => [
      from,
      to,
    ])
    expect(
      allowedEdges.every(([from, to]) => nodes.has(from) && nodes.has(to)),
    ).toBe(true)
    expect(findCycle(allowedEdges)).toBe(false)
    expect(
      decision.allowedDependencyEdges.find(
        (edge) =>
          edge.from === 'source.server' &&
          edge.to === 'browser_runtime.client',
      ),
    ).toMatchObject({
      phase: 'runtime',
      reason: 'source-is-the-only-initial-browser-runtime-caller',
    })
  })

  it('prohibits every producer/client/schema cycle class explicitly', () => {
    expect(
      decision.forbiddenDependencyRules.map((rule) => rule.code),
    ).toEqual([
      'producer-imports-own-generated-client',
      'generated-client-imports-producer-runtime',
      'generated-client-imports-authored-schema-runtime',
      'consumer-imports-consumed-service-server-schema',
      'consumer-imports-foreign-server-schema',
      'cross-service-schema-import',
      'generated-client-dependency',
      'openapi-imports-generated-client',
      'connector-abi-imports-http-client',
    ])
    expect(decision.globallyForbiddenPackages).toEqual([
      '@valedictorian/sdk',
      '@valedictorian/core',
      '@valedictorian/types',
    ])
    expect(decision.invariants).toMatchObject({
      producerRuntimeImportsGeneratedClient: false,
      consumerImportsForeignServerSchemas: false,
      generatedClientsImportProducerRuntime: false,
      generatedClientsImportOtherGeneratedClients: false,
      sharedTypesRepository: false,
      universalSdk: false,
    })
  })

  it('executes every accepted and forbidden cycle fixture', () => {
    expect(decision.cycleFixtures.map((fixture) => fixture.name)).toEqual([
      'workspace-authority-flow',
      'source-consumes-browser-client',
      'browser-worker-peer-client-flow',
      'browser-dispatch-peer-client-flow',
      'browser-worker-serving-process-imports-client',
      'browser-dispatch-serving-process-imports-client',
      'producer-imports-own-client',
      'client-imports-producer',
      'client-imports-authored-runtime-schema',
      'cross-service-schema-reuse',
      'consumer-imports-consumed-service-schema',
      'consumer-imports-foreign-schema',
      'generated-client-chain',
      'schema-client-cycle',
      'otherwise-unclassified-cycle',
      'connector-abi-stays-direct',
      'connector-abi-imports-service-client',
    ])
    for (const fixture of decision.cycleFixtures) {
      expect(fixtureOutcome(fixture.edges), fixture.name).toBe(fixture.expected)
    }
  })

  it('keeps wire types owner-local and creates no premature primitives', () => {
    expect(decision.wireTypeRules).toMatchObject({
      owner: 'the-service-that-accepts-or-emits-the-wire-value',
      authoredSchemaIsAuthority: true,
      openApiIsGeneratedArtifact: true,
      clientTypesAreGeneratedArtifact: true,
      databaseTypesCrossWire: false,
      ormTypesCrossWire: false,
      internalDomainEntitiesCrossWire: false,
      providerPrivateTypesCrossWire: false,
      foreignServiceSchemasCrossWire: false,
      consumerDefinedCopiesAreAuthority: false,
      sharedPrimitivePackage: null,
    })
    expect(decision.wireTypeRules.standardPrimitives).toEqual([
      'rfc3339-string',
      'uuid-string',
      'uri-string',
      'opaque-cursor-string',
    ])
  })

  it('defines stable operations and a closed breaking-change policy', () => {
    expect(decision.operationAndSchemaRules).toEqual({
      operationIdsUniqueWithinSpec: true,
      operationIdsStableAcrossCompatibleReleases: true,
      operationIdsRequiredForEveryClientOperation: true,
      requestSchemasClosedByDefault: true,
      safeErrorsExplicitPerOperation: true,
      authenticationExplicitPerOperation: true,
      statusAndHeadersExplicitPerOperation: true,
      unknownResponseShapeFailsClosed: true,
      generatedOutputMayNotBeHandEdited: true,
    })
    expect(decision.compatibilityPolicy.breakingChanges).toContain(
      'add-enum-member-to-a-client-exhaustive-closed-enum',
    )
    expect(decision.compatibilityPolicy.breakingChangePath).toEqual([
      'publish-new-major-or-versioned-http-path',
      'run-old-and-new-contracts-through-an-explicit-migration-window',
      'migrate-every-maintained-consumer',
      'remove-old-contract-only-in-a-later-approved-contraction',
    ])
    expect(decision.compatibilityPolicy.publishedVersionsMutable).toBe(false)
  })

  it('requires deterministic generator, drift, graph and consumer proofs', () => {
    expect(decision.deterministicGenerationContract.forbiddenInputs).toEqual([
      'wall-clock-time',
      'randomness',
      'absolute-checkout-path',
      'network-state',
      'git-dirty-state',
      'environment-dependent-map-order',
      'secret-or-deployment-configuration',
    ])
    expect(decision.deterministicGenerationContract.requiredProofs).toEqual([
      'generate-twice-byte-identical-spec',
      'generate-twice-byte-identical-client',
      'clean-checkout-regeneration-has-empty-diff',
      'compatibility-diff-against-last-release',
      'unique-stable-operation-id-check',
      'route-registry-spec-client-bijection-with-explicit-local-or-private-classification',
      'producer-import-prohibition-scan',
      'directed-cycle-scan',
      'generated-file-manual-edit-sentinel',
      'package-tarball-contains-only-declared-runtime-files',
      'disposable-consumer-pack-install-typecheck-and-call-fixture',
    ])
  })

  it('routes implementation and publication to explicit downstream gates', () => {
    expect(decision.p04ProofScope.provesNow).toEqual([
      'closed-service-and-connector-boundary-inventory',
      'exact-client-owner-identity-and-visibility-decisions',
      'acyclic-allowed-dependency-model',
      'forbidden-edge-classification',
      'negative-cycle-fixture-outcomes',
      'closed-generator-and-compatibility-proof-obligations',
    ])
    expect(decision.p04ProofScope.deferredToImplementationLeaves).toEqual([
      'real-generated-openapi-bytes',
      'real-generated-client-bytes',
      'real-source-import-scan',
      'real-stale-generation-diff',
      'real-package-tarball-and-disposable-consumer',
    ])
    expect(decision.implementationGates.workspaceP11).toContain(
      'preserve-p03-authority-capability-and-failure-contract',
    )
    expect(decision.implementationGates.workspaceP11).toContain(
      'replace-prefix-ipc-allowance-with-declared-operation-coverage',
    )
    expect(decision.implementationGates.sourceR02R04).toContain(
      'record-real-project-commands-before-inventing-generator-commands',
    )
    expect(decision.implementationGates.browserB01B02).toContain(
      'approve-source-as-only-initial-caller',
    )
    expect(decision.implementationGates.browserB01B02).toContain(
      'separate-source-facing-worker-coordinator-runner-dispatch-and-metrics-contracts',
    )
    expect(decision.implementationGates.workspaceP25).toEqual([
      'publish-only-the-four-approved-product-package-boundaries',
      'preserve-the-private-root-workspace',
      'require-trusted-publisher-provenance-and-clean-registry-consumers',
    ])
    expect(decision.implementationGates.all).toEqual([
      'do-not-create-shared-types-or-universal-sdk',
      'do-not-move-packages-or-persistence-under-p04',
      'do-not-publish-before-dedicated-publication-gate',
      'fail-ci-on-stale-generation-forbidden-edge-or-cycle',
    ])
  })
})
