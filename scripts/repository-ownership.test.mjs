import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const ownershipPath = path.join(repositoryRoot, 'architecture/repository-ownership.json')
const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'))

const repositoryNames = ownership.targetRepositories.map((entry) => entry.repository)
const repositorySet = new Set(repositoryNames)
const exportDestinations = ownership.s02DestinationReconciliation.exports
const consumerDestinations = ownership.s02DestinationReconciliation.maintainedConsumerDestinations
const reconciledS02Destinations = new Set([
  ...exportDestinations.map((entry) => entry.destination),
  ...consumerDestinations.map((entry) => entry.destination),
])

describe('repository ownership decision', () => {
  it('accepts exactly five product and service target repositories', () => {
    expect(repositoryNames).toEqual([
      'cravessant/valedictorian',
      'cravessant/valedictorian-cloud',
      'cravessant/valedictorian-source',
      'cravessant/valedictorian-browser-runtime',
      'cravessant/valedictorian-connector-jobright',
    ])
    expect(repositorySet.size).toBe(5)
  })

  it('does not materialize an empty cloud repository or speculative package', () => {
    const cloud = ownership.targetRepositories.find(
      (entry) => entry.repository === 'cravessant/valedictorian-cloud',
    )

    expect(cloud.origin).toBeNull()
    expect(cloud.lifecycle).toBe('deferred-until-first-real-cloud-vertical-slice')
    expect(cloud.s02Destinations).toEqual([])
    expect(ownership.packageRules.deferredUntilConcreteConsumer).toEqual([
      'workspace-domain',
      'connector-host-conformance',
      'managed-service-client',
    ])
  })

  it('reconciles every public S02 export to one owner and package', () => {
    expect(ownership.s02Evidence).toMatchObject({
      exports: 1091,
      consumerRows: 1514,
      keys: 2605,
      publicProjectionSha256: '580046c02fdf3d950bd60e38771354a3f853c508ac5f740d7d3ad411e806b1a1',
    })
    expect(exportDestinations.map((entry) => [entry.destination, entry.count])).toEqual([
      ['packages/workspace/server', 910],
      ['packages/workspace/client', 50],
      ['source-client', 126],
      ['packages/connector-api', 5],
    ])
    expect(exportDestinations.reduce((sum, entry) => sum + entry.count, 0)).toBe(1091)
    expect(exportDestinations.every((entry) => repositorySet.has(entry.repository))).toBe(true)
    expect(exportDestinations.every((entry) => entry.packageBoundary.length > 0)).toBe(true)
  })

  it('maps every approved maintained-consumer destination without identity data', () => {
    expect(consumerDestinations.map((entry) => entry.destination)).toEqual([
      'apps/desktop',
      'packages/workspace/server',
      'packages/workspace/client',
      'packages/cli',
      'packages/connector-api',
      'packages/connector-testkit',
    ])
    expect(consumerDestinations.every((entry) => repositorySet.has(entry.repository))).toBe(true)
    expect(consumerDestinations.every((entry) => entry.packageBoundary.length > 0)).toBe(true)
    expect(
      consumerDestinations.every(
        (entry) =>
          Object.keys(entry).sort().join(',') === 'destination,packageBoundary,repository',
      ),
    ).toBe(true)
  })

  it('keeps target S02 destinations equal to the public reconciliation', () => {
    const targetS02Destinations = ownership.targetRepositories.flatMap(
      (entry) => entry.s02Destinations,
    )

    expect(new Set(targetS02Destinations)).toEqual(reconciledS02Destinations)
    expect(targetS02Destinations.length).toBe(reconciledS02Destinations.size)
    expect(targetS02Destinations).not.toContain('packages/workspace/conformance')
  })

  it('forbids a replacement universal SDK or shared-types owner', () => {
    expect(ownership.packageRules.sharedTypesRepository).toBe(false)
    expect(ownership.packageRules.universalSdkReplacement).toBeNull()
    expect(ownership.packageRules.forbiddenPackages).toEqual([
      '@valedictorian/sdk',
      '@valedictorian/core',
      '@valedictorian/types',
    ])
    expect(ownership.packageRules.producerOwnedClients).toBe(true)
  })

  it('preserves static exact-version Jobright outside dynamic loading scope', () => {
    expect(ownership.packageRules.jobright).toEqual({
      repository: 'cravessant/valedictorian-connector-jobright',
      package: '@sparxie/valedictorian-connectors-jobright',
      distribution: 'static-exact-version',
      dynamicLoadingIssue: 'https://github.com/cravessant/valedictorian-app/issues/522',
    })
    expect(ownership.packageRules.packageIdentityPolicy)
      .toBe('retain-current-identities-until-dedicated-approved-cutover')
  })

  it('gives every transitional repository one non-deleting terminal disposition', () => {
    const transitions = ownership.repositoryTransitions
    const transitionNames = transitions.map((entry) => entry.repository)
    const terminalIssues = transitions.map((entry) => entry.terminalIssue)

    expect(transitionNames).toEqual([
      'cravessant/valedictorian-app',
      'KennyKeni/sparxie',
      'cravessant/valedictorian',
      'cravessant/valedictorian-connectors',
      'cravessant/valedictorian-dash',
      'cravessant/valedictorian-workspace',
      'cravessant/valedictorian-source-legacy',
    ])
    expect(new Set(transitionNames).size).toBe(transitions.length)
    expect(new Set(terminalIssues).size).toBe(transitions.length)
    expect(transitions.every((entry) => entry.delete === false)).toBe(true)
    expect(transitions.every((entry) => entry.disposition.length > 0)).toBe(true)
  })

  it('keeps the compatibility facade bounded and preserves published versions', () => {
    expect(ownership.packageRules.compatibilityFacade).toEqual({
      package: '@sparxie/sdk',
      exit: 'all-maintained-consumers-migrated-and-two-product-releases-and-30-days',
      terminalIssues: [
        'https://github.com/cravessant/valedictorian-app/issues/583',
        'https://github.com/cravessant/valedictorian-app/issues/584',
      ],
      unpublish: false,
    })
  })
})
