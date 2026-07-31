import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const authorityPath = path.join(repositoryRoot, 'architecture/workspace-authority.json')
const authority = JSON.parse(fs.readFileSync(authorityPath, 'utf8'))

const capabilityIds = authority.capabilities.map((entry) => entry.id)
const operationClassIds = authority.operationClasses.map((entry) => entry.id)
const failures = authority.failureMatrix
const phases = authority.transferProtocol.phases

function interfaceMethods(relativeFile, interfaceName, prefix = '') {
  const declarationPath = path.join(
    repositoryRoot,
    'node_modules/@sparxie/sdk/dist',
    relativeFile,
  )
  const source = fs.readFileSync(declarationPath, 'utf8')
  const declarationStart = source.search(
    new RegExp(`export interface ${interfaceName}(?: extends [^{]+)? \\{`),
  )
  expect(declarationStart, `${interfaceName} must exist in ${relativeFile}`)
    .toBeGreaterThanOrEqual(0)
  const bodyStart = source.indexOf('{', declarationStart)
  let depth = 1
  let bodyEnd = bodyStart + 1
  for (; bodyEnd < source.length && depth > 0; bodyEnd += 1) {
    if (source[bodyEnd] === '{') {
      depth += 1
    } else if (source[bodyEnd] === '}') {
      depth -= 1
    }
  }
  expect(depth, `${interfaceName} declaration must have balanced braces`).toBe(0)

  const methods = []
  const objectPath = []
  for (const line of source.slice(bodyStart + 1, bodyEnd - 1).split('\n')) {
    const indentation = line.match(/^ */)?.[0].length ?? 0
    while (
      objectPath.length > 0 &&
      objectPath[objectPath.length - 1].indentation >= indentation
    ) {
      objectPath.pop()
    }
    const objectMatch = line.match(/^\s*([A-Za-z][A-Za-z0-9]*): \{$/)
    if (objectMatch) {
      objectPath.push({ name: objectMatch[1], indentation })
      continue
    }
    const methodMatch = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\(/)
    if (methodMatch) {
      methods.push(
        [
          ...(prefix ? prefix.split('.') : []),
          ...objectPath.map((entry) => entry.name),
          methodMatch[1],
        ].join('.'),
      )
    }
  }
  return methods
}

function releasedSdkOperations() {
  return [
    ...interfaceMethods('client.d.ts', 'ValedictorianClient'),
    ...interfaceMethods('lifecycle-client.d.ts', 'LifecycleWorkspaceClient'),
    ...interfaceMethods(
      'capture-resolution-client.d.ts',
      'CaptureResolutionWorkspaceClient',
      'captureResolution',
    ),
    ...interfaceMethods(
      'capture-resolution-client.d.ts',
      'CaptureResolutionV2WorkspaceClient',
      'captureResolutionV2',
    ),
    ...interfaceMethods(
      'company-client.d.ts',
      'WorkspaceCompaniesClient',
      'companies',
    ),
    ...interfaceMethods(
      'company-client.d.ts',
      'WorkspaceCompanyAssignmentsClient',
      'companyAssignments',
    ),
    ...interfaceMethods('client.d.ts', 'ValedictorianWorkspaceClient'),
  ].sort()
}

describe('portable workspace authority decision', () => {
  it('closes every split-brain and offline-write escape hatch', () => {
    expect(authority.invariants).toMatchObject({
      maximumWritableAuthorities: 1,
      zeroWritableAuthoritiesDuringFence: true,
      dualWrite: false,
      offlineMutationQueue: false,
      offlineMerge: false,
      lastWriterWins: false,
      blindOldAuthorityReactivation: false,
      callerAbortProvesCommandRollback: false,
    })
  })

  it('uses a closed capability state vocabulary and unique capability ids', () => {
    expect(authority.capabilityStates).toEqual([
      'supported',
      'unsupported',
      'temporarily_unavailable',
    ])
    expect(new Set(capabilityIds).size).toBe(capabilityIds.length)
    expect(capabilityIds).toEqual([
      'workspace.discovery',
      'workspace.lifecycle',
      'workspace.operations',
      'workspace.profile',
      'workspace.secrets.admin',
      'workspace.secrets.localResolve',
      'workspace.secrets.byokTransfer',
      'workspace.snapshot.export',
      'workspace.snapshot.import',
      'workspace.authority.transfer',
      'workspace.receipts',
      'workspace.filesystem',
    ])
    expect(
      authority.capabilities.every((capability) =>
        capability.operationClasses.every((id) => operationClassIds.includes(id))),
    ).toBe(true)
  })

  it('reconciles every released root and workspace client surface', () => {
    expect(
      authority.currentSurfaceReconciliation.root.map((entry) => entry.surface),
    ).toEqual(['health', 'capabilities', 'workspaces'])
    expect(
      authority.currentSurfaceReconciliation.workspace.map((entry) => entry.surface),
    ).toEqual([
      'captures',
      'jobs',
      'opportunities',
      'applications',
      'captureResolution',
      'captureResolutionV2',
      'companies',
      'companyAssignments',
      'scores',
      'actionQueue',
      'connectors',
      'policy',
      'profile',
      'secrets',
      'runs',
    ])
    expect(authority.discoveryContract).toMatchObject({
      managedServerFilesystemPathExposed: false,
      discoveryGrantsWriteAuthority: false,
      staleDiscoveryMutationBehavior: 'authority_epoch_conflict',
    })
    const reconciledSurfaces = [
      ...authority.currentSurfaceReconciliation.root,
      ...authority.currentSurfaceReconciliation.workspace,
    ]
    expect(
      reconciledSurfaces.every((surface) =>
        surface.operationClasses.every((id) => operationClassIds.includes(id))),
    ).toBe(true)
    expect(
      reconciledSurfaces.every((surface) =>
        surface.capabilities.every((id) => capabilityIds.includes(id))),
    ).toBe(true)

    const declaredOperations = authority.releasedOperationGroups
      .flatMap((group) => group.operations)
      .sort()
    expect(authority.releasedOperationEvidence).toMatchObject({
      package: '@sparxie/sdk',
      version: '0.36.0',
      availabilityStatePath: 'operations.<exact-operation-name>',
      everyOperationIndependentlyAdvertised: true,
      requiredStateForInvocation: 'supported',
    })
    expect(declaredOperations).toEqual(releasedSdkOperations())
    expect(new Set(declaredOperations).size).toBe(declaredOperations.length)
    expect(
      authority.releasedOperationGroups.every((group) =>
        operationClassIds.includes(group.operationClass)),
    ).toBe(true)
    expect(
      authority.releasedOperationGroups.every((group) =>
        capabilityIds.includes(group.capability)),
    ).toBe(true)
  })

  it('requires idempotency for every mutating, execution and migration class', () => {
    expect(operationClassIds).toEqual([
      'discovery',
      'authoritative_read',
      'authoritative_mutation',
      'secret_administration',
      'local_secret_resolution',
      'authoritative_execution',
      'external_query',
      'migration_control',
    ])
    const keyedClasses = authority.operationClasses
      .filter((entry) => entry.requiresIdempotencyKey === true)
      .map((entry) => entry.id)
    expect(keyedClasses).toEqual([
      'authoritative_mutation',
      'secret_administration',
      'authoritative_execution',
      'migration_control',
    ])
    expect(authority.receiptContract.replay)
      .toBe('same-key-and-fingerprint-returns-original-result')
    expect(authority.receiptContract.mismatch)
      .toBe('same-key-different-fingerprint-is-idempotency_conflict')
    expect(authority.receiptContract).toMatchObject({
      lookupOperation: 'receipts.getByIdempotencyKey',
      lookupKey: 'workspaceId-authorityEpoch-operation-idempotencyKey',
      notFoundOutcome: 'receipt_not_found',
      lookupReturnsOriginalOutcomeOnly: true,
    })
    expect(
      authority.capabilities.find((entry) => entry.id === 'workspace.receipts'),
    ).toMatchObject({
      operations: ['receipts.getByIdempotencyKey'],
    })
  })

  it('has at most one writer and an explicit zero-writer fence', () => {
    const stateMatrix = authority.transferProtocol.stateMatrix
    expect(stateMatrix.map((entry) => entry.state)).toEqual(
      authority.transferProtocol.states,
    )
    for (const state of stateMatrix) {
      expect(Number(state.sourceWritable) + Number(state.targetWritable))
        .toBeLessThanOrEqual(1)
    }
    for (const stateName of ['idle', 'aborted']) {
      expect(stateMatrix.find((entry) => entry.state === stateName)).toMatchObject({
        sourceState: 'active',
        sourceWritable: true,
        targetWritable: false,
      })
    }
    expect(stateMatrix.find((entry) => entry.state === 'idle')?.targetState)
      .toBe('absent')
    expect(stateMatrix.find((entry) => entry.state === 'aborted')?.targetState)
      .toBe('retired')
    expect(phases.map((phase) => phase.phase)).toEqual([
      'prepared',
      'snapshot_staged',
      'source_fenced',
      'final_snapshot_verified',
      'activated',
      'source_retired',
    ])
    expect(
      phases
        .filter((phase) => phase.phase.includes('fenced') || phase.phase.includes('verified'))
        .every((phase) => !phase.sourceWritable && !phase.targetWritable),
    ).toBe(true)
    expect(authority.transferProtocol.fenceContract).toEqual({
      rejectNewMutations: true,
      rejectNewSchedulerClaims: true,
      drainOrExplicitlySettleAdmittedMutations: true,
      preserveExecutionAndConnectorLineage: true,
      activeWorkBlocksFinalSnapshot: true,
      timeoutLeavesSourceFenced: true,
      routingChangeAloneChangesAuthority: false,
    })
  })

  it('defines a closed transition graph with explicit aborted terminals', () => {
    expect(authority.transferProtocol.states).toEqual([
      'idle',
      'prepared',
      'snapshot_staged',
      'source_fenced',
      'final_snapshot_verified',
      'activated',
      'source_retired',
      'aborted',
    ])
    expect(authority.transferProtocol.terminalStates).toEqual([
      'source_retired',
      'aborted',
    ])
    expect(
      authority.transferProtocol.transitions.map((transition) => [
        transition.operation,
        transition.from,
        transition.to,
        transition.receipt,
      ]),
    ).toEqual([
      ['prepare', ['idle'], 'prepared', 'prepare-receipt'],
      ['stageSnapshot', ['prepared'], 'snapshot_staged', 'snapshot-import-receipt'],
      ['fenceSource', ['snapshot_staged'], 'source_fenced', 'fence-receipt'],
      [
        'verifyFinalSnapshot',
        ['source_fenced'],
        'final_snapshot_verified',
        'final-verification-receipt',
      ],
      [
        'activateTarget',
        ['final_snapshot_verified'],
        'activated',
        'activation-receipt',
      ],
      ['retireSource', ['activated'], 'source_retired', 'retirement-receipt'],
      [
        'abortBeforeFence',
        ['prepared', 'snapshot_staged'],
        'aborted',
        'abort-receipt',
      ],
      [
        'abortAfterFence',
        ['source_fenced', 'final_snapshot_verified'],
        'aborted',
        'abort-and-source-unfence-receipt',
      ],
    ])
    expect(authority.transferProtocol.failureBehavior).toMatchObject({
      commandFailureAdvancesPhase: false,
      failedBeforeFence: 'source-remains-active-target-remains-candidate',
      failedAfterFence: 'both-remain-read-only-until-retry-or-explicit-abort',
      failedAfterActivation: 'target-remains-current-authority',
    })
  })

  it('binds activation to the fence, final snapshot, BYOK proof and epoch', () => {
    expect(authority.transferProtocol.activationPreconditions).toEqual([
      'source-state-is-fenced',
      'target-state-is-candidate',
      'final-snapshot-verified-against-fence-token',
      'destination-byok-proof-current',
      'expected-authority-epoch-matches',
      'activation-idempotency-fingerprint-matches',
    ])
    expect(authority.snapshotContract.finalSnapshotMustReferenceFence).toBe(true)
    expect(
      phases.find((phase) => phase.phase === 'activated'),
    ).toMatchObject({
      sourceState: 'fenced',
      targetState: 'active',
      sourceWritable: false,
      targetWritable: true,
    })
  })

  it('permits explicit abort only before activation and makes reversal a new transfer', () => {
    expect(authority.transferProtocol.abort).toMatchObject({
      allowedBeforeActivation: true,
      allowedAfterActivation: false,
      callerCancellation: 'does-not-abort-transfer',
    })
    expect(authority.transferProtocol.reverseTransfer).toEqual({
      reuseOldActivationReceipt: false,
      newTransferId: true,
      newAuthorityEpoch: true,
      formerSourceIsCandidateOnly: true,
      sameProtocolRequired: true,
    })
  })

  it('keeps plaintext, local handles and key material outside portable state', () => {
    expect(authority.snapshotContract).toMatchObject({
      plaintextSecrets: false,
      localFilesystemPaths: false,
      logsOrErrorBodiesContainSensitiveValues: false,
    })
    expect(authority.secretContract.neverPortable).toEqual([
      'plaintext-secret-values',
      'local-protected-storage-handles',
      'local-secret-resolution-results',
      'user-key-material',
      'credential-bearing-error-text',
    ])
    expect(authority.secretContract.byok).toMatchObject({
      controlPlaneReceivesKeyMaterial: false,
      destinationProofRequiredBeforeFence: true,
      proofRequiredAgainBeforeActivation: true,
      missingKeyBehavior: 'fail-closed-and-keep-current-authority',
    })
  })

  it('defines a unique, closed and actionable failure matrix', () => {
    const expectedFailures = [
      ['capability_unsupported', 409, 'conflict'],
      ['capability_temporarily_unavailable', 503, 'unavailable'],
      ['workspace_not_found', 404, 'not_found'],
      ['workspace_identity_conflict', 409, 'conflict'],
      ['protocol_version_unsupported', 409, 'conflict'],
      ['authority_unavailable', 503, 'unavailable'],
      ['authority_epoch_conflict', 409, 'conflict'],
      ['workspace_fenced', 409, 'conflict'],
      ['workspace_retired', 409, 'conflict'],
      ['active_work_conflict', 409, 'conflict'],
      ['quiesce_timeout', 409, 'conflict'],
      ['revision_conflict', 409, 'conflict'],
      ['idempotency_conflict', 409, 'conflict'],
      ['snapshot_invalid', 422, 'validation'],
      ['snapshot_incompatible', 409, 'conflict'],
      ['snapshot_integrity_failed', 409, 'integrity'],
      ['transfer_phase_conflict', 409, 'conflict'],
      ['transfer_not_found', 404, 'not_found'],
      ['receipt_not_found', 404, 'not_found'],
      ['abort_not_allowed', 409, 'conflict'],
      ['byok_key_unavailable', 503, 'unavailable'],
      ['secure_storage_unavailable', 503, 'unavailable'],
      ['ciphertext_incompatible', 409, 'integrity'],
      ['secret_material_forbidden', 422, 'validation'],
      ['authentication_required', 401, 'authentication'],
      ['authority_forbidden', 403, 'authorization'],
      ['rate_limited', 429, 'rate_limit'],
      ['internal_error', 500, 'internal'],
    ]
    expect(
      failures.map((entry) => [entry.code, entry.httpStatus, entry.kind]),
    ).toEqual(expectedFailures)
    expect(new Set(failures.map((entry) => entry.code)).size).toBe(failures.length)
    expect(failures.every((entry) => entry.retry.length > 0)).toBe(true)
    expect(
      failures.find((entry) => entry.code === 'authority_unavailable')?.retry,
    ).toContain('never-queue-offline-mutation')

    expect(authority.releasedFailureCompatibility).toMatchObject({
      policy:
        'preserve-exact-code-status-and-kind-add-cross-cutting-authority-failures-without-aliasing',
      endpointSpecificFailurePrecedesCrossCuttingFallback: true,
    })
    const releasedFailures = authority.releasedFailureCompatibility.failures
    expect(releasedFailures).toHaveLength(28)
    expect(
      new Set(releasedFailures.map((entry) => `${entry.surface}:${entry.code}`)).size,
    ).toBe(releasedFailures.length)
    expect(releasedFailures.map(({ surface, code, httpStatus, kind }) => [
      surface,
      code,
      httpStatus,
      kind,
    ])).toEqual([
      ['secrets.local.resolve', 'secret_not_found', 404, 'not_found'],
      ['secrets.local.resolve', 'local_secret_resolution_unsupported', 409, 'conflict'],
      ['secrets.local.resolve', 'local_secret_resolution_unauthorized', 403, 'authorization'],
      ['secrets.local.resolve', 'secure_storage_unavailable', 503, 'unavailable'],
      ['profile.document', 'invalid_profile_document', 422, 'validation'],
      ['profile.document', 'unsupported_profile_schema_version', 409, 'conflict'],
      ['profile.document', 'profile_revision_conflict', 409, 'conflict'],
      ['profile.document', 'profile_document_unavailable', 404, 'not_found'],
      ['profile.document', 'profile_backup_unavailable', 404, 'not_found'],
      ['connectors.schedules', 'connector_scheduling_unavailable', 503, 'unavailable'],
      ['connectors.schedules', 'invalid_timezone', 422, 'validation'],
      ['connectors.schedules', 'invalid_cadence', 422, 'validation'],
      ['connectors.schedules', 'schedule_too_frequent', 422, 'validation'],
      ['connectors.schedules', 'stale_schedule_revision', 409, 'conflict'],
      ['connectors.schedules', 'schedule_dispatch_conflict', 409, 'conflict'],
      ['connectors.remove', 'connector_retirement_active_work_conflict', 409, 'conflict'],
      ['connectors.create', 'already_configured', 409, 'conflict'],
      ['connectors.options.query', 'unsupported_descriptor', 409, 'conflict'],
      ['connectors.options.query', 'connector_version_mismatch', 409, 'conflict'],
      ['connectors.options.query', 'filter_schema_version_mismatch', 409, 'conflict'],
      ['connectors.options.query', 'option_catalog_version_mismatch', 409, 'conflict'],
      ['connectors.options.query', 'option_source_version_mismatch', 409, 'conflict'],
      ['connectors.options.query', 'option_source_undeclared', 422, 'validation'],
      ['connectors.options.query', 'option_dependency_undeclared', 422, 'validation'],
      ['connectors.options.query', 'option_dependency_invalid', 422, 'validation'],
      ['connectors.options.query', 'option_value_invalid', 422, 'validation'],
      ['connectors.options.query', 'option_query_unavailable', 409, 'conflict'],
      ['connectors.overview.list', 'invalid_connector_overview_cursor', 400, 'validation'],
    ])
  })

  it('keeps implementation deferred to the explicit package and recovery gates', () => {
    expect(authority.implementationGates.P11).toContain(
      'provide-conformance-fixtures-for-fence-activation-abort-and-reverse-transfer',
    )
    expect(authority.implementationGates.P13).toContain(
      'inject-interruption-at-every-transfer-phase',
    )
    expect(authority.implementationGates.futureCloud).toContain(
      'implement-real-vertical-slice-before-repository-or-package-creation',
    )
  })
})
