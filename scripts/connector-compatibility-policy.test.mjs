import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const policyPath = path.join(repositoryRoot, 'architecture/connector-compatibility-policy.json')
const adrPath = path.join(repositoryRoot, 'architecture/connector-compatibility-policy.md')
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'))

describe('connector compatibility and support policy', () => {
  it('records the accepted #521 decision without authorizing implementation or publication', () => {
    expect(policy.schemaVersion).toBe(1)
    expect(policy.decision).toEqual({
      id: 'connector-api-compatibility-and-support',
      issue: 'https://github.com/cravessant/valedictorian-app/issues/521',
      status: 'accepted',
      authority:
        'https://github.com/cravessant/valedictorian-app/issues/521#issuecomment-5151558549',
      implementationAuthorized: false,
      publicationAuthorized: false,
    })
    expect(fs.readFileSync(adrPath, 'utf8')).toContain(
      '[#521](https://github.com/cravessant/valedictorian-app/issues/521)',
    )
  })

  it('retains the API and testkit identities and makes core the connector SDK', () => {
    expect(policy.packageIdentities.api).toEqual({
      package: '@sparxie/valedictorian-connectors-core',
      role: 'connector-developer-sdk-and-runtime-abi',
      rootExport: '.',
      versionLineage: 'independent',
      identityPolicy: 'retain-released-name-and-lineage',
    })
    expect(policy.packageIdentities.testkit).toEqual({
      package: '@sparxie/valedictorian-connectors-test-harness',
      role: 'connector-conformance-testkit',
      rootExport: '.',
      versionLineage: 'independent',
      identityPolicy: 'retain-released-name-and-lineage',
    })
    expect(policy.packageIdentities.transitionalFacade).toEqual({
      package: '@sparxie/sdk',
      role: 'transitional-compatibility-facade',
      permanentConnectorSdk: false,
    })
    expect(policy.packageIdentities.universalSdk).toBeNull()
    expect(policy.packageIdentities.sharedTypesPackage).toBeNull()
  })

  it('defines independent pre-1.0 and post-1.0 semver and release order', () => {
    expect(policy.semver).toEqual({
      model: 'independent-semver',
      beforeOnePointZero: {
        breakingAbi: 'minor',
        compatibleAdditionOrFix: 'patch',
      },
      atOrAfterOnePointZero: 'standard-major-minor-patch',
      testkit: {
        declaresCompatibleApiRange: true,
        publishesAfterApi: true,
      },
      connector: {
        declaresSupportedApiRangeThrough: 'ordinary-package-metadata',
        hostLocks: 'exact-released-connector-versions',
      },
    })
  })

  it('keeps two API lines functional through two releases and 30 days', () => {
    expect(policy.support.supportedLines).toBe(
      'newest-and-immediately-previous-api-compatibility-line',
    )
    expect(policy.support.minimumSupportedApiVersion).toBe(
      'immediately-previous-api-compatibility-line',
    )
    expect(policy.support.minimumWindow).toEqual({ productReleases: 2, days: 30 })
    expect(policy.support.deprecation).toEqual({
      functionalDuringWindow: true,
      removal: 'later-breaking-line',
    })
    expect(policy.support.releasedArtifactsMutable).toBe(false)
    expect(policy.support.rollback).toEqual([
      'continue-using-older-release',
      'publish-corrective-release',
    ])
  })

  it('uses one public API and testkit for maintained and community tiers', () => {
    expect(policy.support.tiers.sharedApi).toBe(true)
    expect(policy.support.tiers.sharedConformanceTestkit).toBe(true)
    expect(policy.support.tiers.maintained).toEqual({
      releaseOwner: 'valedictorian',
      ciOwner: 'valedictorian',
      supportResponseOwner: 'valedictorian',
      testsSupportedMatrix: true,
    })
    expect(policy.support.tiers.community).toEqual({
      releaseOwner: 'publisher',
      conformanceEvidenceOwner: 'publisher',
      privateSourceAccess: false,
      credentialAccess: false,
      alternateAbi: false,
    })
  })

  it('separates connector conformance from application host ownership', () => {
    expect(policy.conformance.evidenceSource).toBe(
      'released-api-and-testkit-artifacts',
    )
    expect(policy.conformance.connectorOwnedCi).toEqual([
      'isolated-package-install',
      'allowed-dependency-and-import-closure',
      'public-schema-and-type-conformance',
      'configuration-behavior',
      'filter-behavior',
      'authentication-behavior',
      'capture-behavior',
      'refresh-behavior',
      'checkpoint-behavior',
      'dynamic-option-behavior',
      'output-sanitization',
      'stable-conformance-receipts',
    ])
    expect(policy.conformance.applicationOwned).toEqual([
      'exact-static-registration',
      'secret-storage-and-resolution',
      'scheduling-and-backoff',
      'persistence-and-transactions',
      'workspace-mapping',
      'host-lifecycle-integration',
    ])
    expect(policy.conformance.dynamicLoadingIssue).toBe(
      'https://github.com/cravessant/valedictorian-app/issues/522',
    )
  })

  it('requires released-artifact receipts and defers runtime negotiation', () => {
    expect(policy.compatibilityReceipts).toEqual({
      inputs: ['released-package-metadata', 'released-package-tarballs'],
      privateApplicationHead: false,
      privateWorkspaceHead: false,
      packageRangeAndInstallFailuresReport: [
        'expected-api-version',
        'observed-api-version',
        'expected-testkit-version',
        'observed-testkit-version',
      ],
      stableConformanceIdentifiersReport: [
        'expected-api-version',
        'observed-api-version',
        'expected-testkit-version',
        'observed-testkit-version',
      ],
      runtimeManifestNegotiation: 'deferred-to-520-and-522',
      loaderFailureCodes: 'deferred-to-520-and-522',
    })
  })

  it('keeps development private-source-free and Jobright static', () => {
    expect(policy.isolation).toEqual({
      privateApplicationOrWorkspaceSourceRequired: false,
      fleetLinkRequired: false,
      crossRepositoryCredentialRequired: false,
      providerPrivateTypesInAbi: false,
      hostPersistenceTypesInAbi: false,
    })
    expect(policy.jobright).toEqual({
      package: '@sparxie/valedictorian-connectors-jobright',
      independentlyReleased: true,
      maintenance: 'valedictorian-maintained',
      distribution: 'static-exact-version',
      staticIssue: 'https://github.com/cravessant/valedictorian-app/issues/545',
      dynamicLoadingIssue: 'https://github.com/cravessant/valedictorian-app/issues/522',
    })
  })

  it('keeps registry, manifest, loader, and sandbox work in #520/#522', () => {
    expect(policy.deferred).toEqual({
      issue520: [
        'marketplace-manifest',
        'registry',
        'publisher-metadata',
        'platform-metadata',
        'permission-metadata',
        'dynamic-compatibility-fields',
        'runtime-manifest-and-version-negotiation',
      ],
      issue522: [
        'dynamic-loading',
        'installation',
        'sandbox',
        'loader-failure-codes',
      ],
      noImplementationOrPackageChange: true,
    })
  })
})
