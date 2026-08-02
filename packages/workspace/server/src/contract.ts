import {
  endpointFailuresForOperation,
  type ReleasedEndpointFailure,
} from './released-failures.js'
import {
  releasedOperationSchemas,
  type ReleasedOperationSchema,
} from './released-operation-schemas.js'

/**
 * The workspace HTTP contract is intentionally authored here, at the producer
 * boundary.  Route handlers may continue to use the existing application
 * services, but this registry is the only source used to describe caller-visible
 * operations, generate OpenAPI, and generate the private client.
 */

export type WorkspaceHttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

export type WorkspaceOperationClass =
  | 'authoritative_execution'
  | 'authoritative_mutation'
  | 'authoritative_read'
  | 'discovery'
  | 'external_query'
  | 'local_secret_resolution'
  | 'secret_administration'

export type WorkspaceCapability =
  | 'workspace.discovery'
  | 'workspace.filesystem'
  | 'workspace.lifecycle'
  | 'workspace.operations'
  | 'workspace.profile'
  | 'workspace.secrets.admin'
  | 'workspace.secrets.localResolve'

export type WorkspaceRoute = Readonly<{
  operationId: string
  method: WorkspaceHttpMethod
  path: string
  capability: WorkspaceCapability
  operationClass: WorkspaceOperationClass
  /** A route body is an authored JSON object, validated by the adapted server. */
  requestBody: boolean
  /** Local-only operations never cross a managed authority boundary. */
  localOnly?: boolean
  /** The route can be called without the optional local bearer token. */
  authentication: 'none' | 'optional-bearer'
  /** Exhaustive safe protocol failures callers may branch on for this operation. */
  safeErrors: readonly import('./authority-protocol.js').WorkspaceFailureCode[]
  /** Released endpoint-specific failures precede cross-cutting authority fallback. */
  endpointFailures: readonly ReleasedEndpointFailure[]
  schemas: ReleasedOperationSchema
  successStatus: 200 | 201 | 204
}>

const route = (
  operationId: string,
  method: WorkspaceHttpMethod,
  path: string,
  capability: WorkspaceCapability,
  operationClass: WorkspaceOperationClass,
  options: Partial<Pick<WorkspaceRoute, 'authentication' | 'localOnly' | 'requestBody' | 'safeErrors' | 'successStatus'>> = {},
): WorkspaceRoute => ({
  operationId,
  method,
  path,
  capability,
  operationClass,
  requestBody: options.requestBody ?? !['GET', 'DELETE'].includes(method),
  authentication: options.authentication ?? 'optional-bearer',
  safeErrors: options.safeErrors ?? safeErrorsFor(operationClass),
  endpointFailures: endpointFailuresForOperation(operationId),
  schemas: releasedOperationSchemas[operationId as keyof typeof releasedOperationSchemas],
  successStatus: options.successStatus ?? 200,
  ...(options.localOnly ? { localOnly: true } : {}),
})

function safeErrorsFor(
  operationClass: WorkspaceOperationClass,
): readonly import('./authority-protocol.js').WorkspaceFailureCode[] {
  const common = [
    'workspace_not_found',
    'authority_unavailable',
    'rate_limited',
    'internal_error',
  ] as const
  if (operationClass === 'discovery') {
    return ['capability_temporarily_unavailable', 'rate_limited', 'internal_error']
  }
  if (operationClass === 'authoritative_read' || operationClass === 'external_query') {
    return [
      ...common,
      'capability_unsupported',
      'workspace_fenced',
      'workspace_retired',
      'authentication_required',
      'authority_forbidden',
    ]
  }
  return [
    ...common,
    'capability_unsupported',
    'authority_epoch_conflict',
    'workspace_fenced',
    'workspace_retired',
    'revision_conflict',
    'idempotency_conflict',
    'authentication_required',
    'authority_forbidden',
  ]
}

/**
 * Every wire operation currently served by the local workspace authority.
 * Keep this list explicit: a prefix check is not an operation registry.
 */
export const workspaceRouteRegistry = [
  route('health.get', 'GET', '/v1/health', 'workspace.discovery', 'discovery', {
    authentication: 'none',
  }),
  route('capabilities.get', 'GET', '/v1/capabilities', 'workspace.discovery', 'discovery', {
    authentication: 'none',
  }),
  route('workspaces.list', 'GET', '/v1/workspaces', 'workspace.discovery', 'discovery'),
  route('workspaces.open', 'POST', '/v1/workspaces/open', 'workspace.filesystem', 'discovery'),
  route('workspaces.create', 'POST', '/v1/workspaces/create', 'workspace.filesystem', 'discovery'),

  route('captures.list', 'GET', '/v1/captures', 'workspace.lifecycle', 'authoritative_read'),
  route('captures.create', 'POST', '/v1/captures', 'workspace.lifecycle', 'authoritative_mutation'),
  route('captures.get', 'GET', '/v1/captures/{captureId}', 'workspace.lifecycle', 'authoritative_read'),
  route('captures.correct', 'PATCH', '/v1/captures/{captureId}', 'workspace.lifecycle', 'authoritative_mutation'),
  route('captures.remove', 'POST', '/v1/captures/{captureId}/remove', 'workspace.lifecycle', 'authoritative_mutation'),
  route('captures.restore', 'POST', '/v1/captures/{captureId}/restore', 'workspace.lifecycle', 'authoritative_mutation'),
  route('captures.history', 'GET', '/v1/captures/{captureId}/history', 'workspace.lifecycle', 'authoritative_read'),
  route('captures.promoteToJob', 'POST', '/v1/captures/{captureId}/promote-to-job', 'workspace.lifecycle', 'authoritative_mutation'),

  route('captureResolution.list', 'GET', '/v1/capture-resolution/captures', 'workspace.lifecycle', 'authoritative_read'),
  route('captureResolution.get', 'GET', '/v1/capture-resolution/captures/{captureId}', 'workspace.lifecycle', 'authoritative_read'),
  route('captureResolution.retry', 'POST', '/v1/capture-resolution/captures/{captureId}/retry', 'workspace.lifecycle', 'authoritative_mutation'),
  route('captureResolution.replay', 'POST', '/v1/capture-resolution/captures/{captureId}/replay', 'workspace.lifecycle', 'authoritative_mutation'),
  route('captureResolution.correct', 'PATCH', '/v1/capture-resolution/captures/{captureId}/correction', 'workspace.lifecycle', 'authoritative_mutation'),
  route('captureResolution.complete', 'POST', '/v1/capture-resolution/captures/{captureId}/completion', 'workspace.lifecycle', 'authoritative_mutation'),
  route('captureResolutionV2.list', 'GET', '/v2/capture-resolution/captures', 'workspace.lifecycle', 'authoritative_read'),
  route('captureResolutionV2.get', 'GET', '/v2/capture-resolution/captures/{captureId}', 'workspace.lifecycle', 'authoritative_read'),
  route('captureResolutionV2.complete', 'POST', '/v2/capture-resolution/captures/{captureId}/completion', 'workspace.lifecycle', 'authoritative_mutation'),

  route('jobs.list', 'GET', '/v1/jobs', 'workspace.lifecycle', 'authoritative_read'),
  route('jobs.create', 'POST', '/v1/jobs', 'workspace.lifecycle', 'authoritative_mutation'),
  route('jobs.get', 'GET', '/v1/jobs/{jobId}', 'workspace.lifecycle', 'authoritative_read'),
  route('jobs.correctFacts', 'PATCH', '/v1/jobs/{jobId}/facts', 'workspace.lifecycle', 'authoritative_mutation'),
  route('jobs.updateAvailability', 'PATCH', '/v1/jobs/{jobId}/availability', 'workspace.lifecycle', 'authoritative_mutation'),
  route('jobs.externalIdentities.add', 'POST', '/v1/jobs/{jobId}/external-identities', 'workspace.lifecycle', 'authoritative_mutation'),
  route('jobs.externalIdentities.remove', 'POST', '/v1/jobs/{jobId}/external-identities/remove', 'workspace.lifecycle', 'authoritative_mutation'),
  route('jobs.remove', 'POST', '/v1/jobs/{jobId}/remove', 'workspace.lifecycle', 'authoritative_mutation'),
  route('jobs.restore', 'POST', '/v1/jobs/{jobId}/restore', 'workspace.lifecycle', 'authoritative_mutation'),
  route('jobs.history', 'GET', '/v1/jobs/{jobId}/history', 'workspace.lifecycle', 'authoritative_read'),
  route('jobs.promoteToOpportunity', 'POST', '/v1/jobs/{jobId}/promote-to-opportunity', 'workspace.lifecycle', 'authoritative_mutation'),

  route('opportunities.list', 'GET', '/v1/opportunities', 'workspace.lifecycle', 'authoritative_read'),
  route('opportunities.create', 'POST', '/v1/opportunities', 'workspace.lifecycle', 'authoritative_mutation'),
  route('opportunities.get', 'GET', '/v1/opportunities/{opportunityId}', 'workspace.lifecycle', 'authoritative_read'),
  route('opportunities.updateEvaluation', 'PATCH', '/v1/opportunities/{opportunityId}/evaluation', 'workspace.lifecycle', 'authoritative_mutation'),
  route('opportunities.updateDisposition', 'PATCH', '/v1/opportunities/{opportunityId}/disposition', 'workspace.lifecycle', 'authoritative_mutation'),
  route('opportunities.remove', 'POST', '/v1/opportunities/{opportunityId}/remove', 'workspace.lifecycle', 'authoritative_mutation'),
  route('opportunities.restore', 'POST', '/v1/opportunities/{opportunityId}/restore', 'workspace.lifecycle', 'authoritative_mutation'),
  route('opportunities.history', 'GET', '/v1/opportunities/{opportunityId}/history', 'workspace.lifecycle', 'authoritative_read'),
  route('opportunities.promoteToApplication', 'POST', '/v1/opportunities/{opportunityId}/promote-to-application', 'workspace.lifecycle', 'authoritative_mutation'),

  route('applications.list', 'GET', '/v1/applications', 'workspace.lifecycle', 'authoritative_read'),
  route('applications.create', 'POST', '/v1/applications', 'workspace.lifecycle', 'authoritative_mutation'),
  route('applications.get', 'GET', '/v1/applications/{applicationId}', 'workspace.lifecycle', 'authoritative_read'),
  route('applications.updateStatus', 'PATCH', '/v1/applications/{applicationId}/status', 'workspace.lifecycle', 'authoritative_mutation'),
  route('applications.updateCompany', 'PATCH', '/v1/applications/{applicationId}/company', 'workspace.lifecycle', 'authoritative_mutation'),
  route('applications.updateSource', 'PATCH', '/v1/applications/{applicationId}/source', 'workspace.lifecycle', 'authoritative_mutation'),
  route('applications.links.create', 'POST', '/v1/applications/{applicationId}/links', 'workspace.lifecycle', 'authoritative_mutation'),
  route('applications.links.update', 'PATCH', '/v1/applications/{applicationId}/links/{linkId}', 'workspace.lifecycle', 'authoritative_mutation'),
  route('applications.links.remove', 'POST', '/v1/applications/{applicationId}/links/{linkId}/remove', 'workspace.lifecycle', 'authoritative_mutation'),
  route('applications.refreshSnapshot', 'POST', '/v1/applications/{applicationId}/snapshot/refresh', 'workspace.lifecycle', 'authoritative_mutation'),
  route('applications.remove', 'POST', '/v1/applications/{applicationId}/remove', 'workspace.lifecycle', 'authoritative_mutation'),
  route('applications.restore', 'POST', '/v1/applications/{applicationId}/restore', 'workspace.lifecycle', 'authoritative_mutation'),
  route('applications.history', 'GET', '/v1/applications/{applicationId}/history', 'workspace.lifecycle', 'authoritative_read'),
  route('applications.attempts.list', 'GET', '/v1/applications/{applicationId}/attempts', 'workspace.lifecycle', 'authoritative_read'),
  route('applications.events.list', 'GET', '/v1/applications/{applicationId}/events', 'workspace.lifecycle', 'authoritative_read'),

  route('companies.directory.list', 'GET', '/v1/companies', 'workspace.lifecycle', 'authoritative_read'),
  route('companies.create', 'POST', '/v1/companies', 'workspace.lifecycle', 'authoritative_mutation'),
  route('companies.search', 'GET', '/v1/companies/search', 'workspace.lifecycle', 'authoritative_read'),
  route('companies.previewMatches', 'POST', '/v1/companies/match-preview', 'workspace.lifecycle', 'authoritative_read'),
  route('companies.duplicates.list', 'GET', '/v1/companies/duplicate-candidates', 'workspace.lifecycle', 'authoritative_read'),
  route('companies.duplicates.get', 'GET', '/v1/companies/duplicate-candidates/{candidateId}', 'workspace.lifecycle', 'authoritative_read'),
  route('companies.duplicates.markDistinct', 'POST', '/v1/companies/duplicate-candidates/{candidateId}/mark-distinct', 'workspace.lifecycle', 'authoritative_mutation'),
  route('companies.duplicates.merge', 'POST', '/v1/companies/merge', 'workspace.lifecycle', 'authoritative_mutation'),
  route('companies.get', 'GET', '/v1/companies/{companyId}', 'workspace.lifecycle', 'authoritative_read'),
  route('companies.update', 'PATCH', '/v1/companies/{companyId}', 'workspace.lifecycle', 'authoritative_mutation'),
  route('companies.lookup', 'GET', '/v1/companies/{companyId}/lookup', 'workspace.lifecycle', 'authoritative_read'),
  route('companies.notes.update', 'PATCH', '/v1/companies/{companyId}/notes', 'workspace.lifecycle', 'authoritative_mutation'),
  route('companies.aliases.add', 'POST', '/v1/companies/{companyId}/aliases', 'workspace.lifecycle', 'authoritative_mutation'),
  route('companies.aliases.update', 'PATCH', '/v1/companies/{companyId}/aliases/{aliasId}', 'workspace.lifecycle', 'authoritative_mutation'),
  route('companies.aliases.remove', 'DELETE', '/v1/companies/{companyId}/aliases/{aliasId}', 'workspace.lifecycle', 'authoritative_mutation', { requestBody: true }),
  route('companies.archive', 'POST', '/v1/companies/{companyId}/archive', 'workspace.lifecycle', 'authoritative_mutation'),
  route('companies.restore', 'POST', '/v1/companies/{companyId}/restore', 'workspace.lifecycle', 'authoritative_mutation'),
  route('companies.assignedJobs.list', 'GET', '/v1/companies/{companyId}/assigned-jobs', 'workspace.lifecycle', 'authoritative_read'),
  route('companies.history.list', 'GET', '/v1/companies/{companyId}/history', 'workspace.lifecycle', 'authoritative_read'),
  route('companyAssignments.get', 'GET', '/v1/jobs/{jobId}/company-assignment', 'workspace.lifecycle', 'authoritative_read'),
  route('companyAssignments.reassign', 'POST', '/v1/jobs/{jobId}/company-assignment/reassign', 'workspace.lifecycle', 'authoritative_mutation'),

  route('actionQueue.list', 'GET', '/v1/action-queue', 'workspace.operations', 'authoritative_read'),
  route('receipts.getByIdempotencyKey', 'GET', '/v1/receipts/by-idempotency-key', 'workspace.operations', 'authoritative_read', {
    safeErrors: [
      'capability_unsupported',
      'receipt_not_found',
      'workspace_not_found',
      'authority_epoch_conflict',
      'authentication_required',
      'authority_forbidden',
      'rate_limited',
      'internal_error',
    ],
  }),
  route('scores.record', 'POST', '/v1/scores', 'workspace.operations', 'authoritative_mutation'),
  route('runs.list', 'GET', '/v1/runs', 'workspace.operations', 'authoritative_read'),
  route('runs.start', 'POST', '/v1/runs', 'workspace.operations', 'authoritative_execution'),
  route('runs.step', 'POST', '/v1/runs/{workflowRunId}/steps', 'workspace.operations', 'authoritative_execution'),
  route('runs.complete', 'PATCH', '/v1/runs/{workflowRunId}/complete', 'workspace.operations', 'authoritative_execution'),

  route('connectors.list', 'GET', '/v1/connectors', 'workspace.operations', 'authoritative_read'),
  route('connectors.create', 'POST', '/v1/connectors', 'workspace.operations', 'authoritative_mutation'),
  route('connectors.overview.list', 'GET', '/v1/connectors/overview', 'workspace.operations', 'authoritative_read'),
  route('connectors.inspect', 'GET', '/v1/connectors/{connectorInstanceId}/status', 'workspace.operations', 'authoritative_read'),
  route('connectors.update', 'PATCH', '/v1/connectors/{connectorInstanceId}', 'workspace.operations', 'authoritative_mutation'),
  route('connectors.remove', 'DELETE', '/v1/connectors/{connectorInstanceId}', 'workspace.operations', 'authoritative_mutation', { successStatus: 200 }),
  route('connectors.runs.list', 'GET', '/v1/connectors/{connectorInstanceId}/runs', 'workspace.operations', 'authoritative_read'),
  route('connectors.runs.trigger', 'POST', '/v1/connectors/{connectorInstanceId}/runs', 'workspace.operations', 'authoritative_execution'),
  route('connectors.checkpoints.list', 'GET', '/v1/connectors/{connectorInstanceId}/checkpoints', 'workspace.operations', 'authoritative_read'),
  route('connectors.observations.list', 'GET', '/v1/connectors/{connectorInstanceId}/observations', 'workspace.operations', 'authoritative_read'),
  route('connectors.options.query', 'POST', '/v1/connectors/{connectorInstanceId}/options/query', 'workspace.operations', 'external_query'),
  route('connectors.descriptors.list', 'GET', '/v1/connector-descriptors', 'workspace.operations', 'authoritative_read'),
  route('connectors.descriptors.get', 'GET', '/v1/connector-descriptors/{connectorId}/versions/{connectorVersion}', 'workspace.operations', 'authoritative_read'),
  route('connectors.schedules.get', 'GET', '/v1/connectors/{connectorInstanceId}/schedule', 'workspace.operations', 'authoritative_read'),
  route('connectors.schedules.upsert', 'PUT', '/v1/connectors/{connectorInstanceId}/schedule', 'workspace.operations', 'authoritative_mutation'),
  route('connectors.schedules.delete', 'DELETE', '/v1/connectors/{connectorInstanceId}/schedule', 'workspace.operations', 'authoritative_mutation', { requestBody: true, successStatus: 204 }),
  route('connectors.schedules.pause', 'POST', '/v1/connectors/{connectorInstanceId}/schedule/pause', 'workspace.operations', 'authoritative_mutation'),
  route('connectors.schedules.resume', 'POST', '/v1/connectors/{connectorInstanceId}/schedule/resume', 'workspace.operations', 'authoritative_mutation'),
  route('connectors.schedules.listAudit', 'GET', '/v1/connectors/{connectorInstanceId}/schedule/audit', 'workspace.operations', 'authoritative_read'),
  route('connectors.schedules.listOccurrences', 'GET', '/v1/connectors/{connectorInstanceId}/schedule/occurrences', 'workspace.operations', 'authoritative_read'),
  route('connectors.schedules.dispatchDue', 'POST', '/v1/connectors/{connectorInstanceId}/schedule/dispatch-due', 'workspace.operations', 'authoritative_execution'),

  route('policy.config.get', 'GET', '/v1/policy/config', 'workspace.operations', 'authoritative_read'),
  route('policy.config.update', 'PATCH', '/v1/policy/config', 'workspace.operations', 'authoritative_mutation'),
  route('policy.config.reset', 'POST', '/v1/policy/config/reset', 'workspace.operations', 'authoritative_mutation'),
  route('policy.evidence.list', 'GET', '/v1/policy/evidence', 'workspace.operations', 'authoritative_read'),
  route('policy.evidence.record', 'POST', '/v1/policy/evidence', 'workspace.operations', 'authoritative_mutation'),
  route('policy.evaluate.application', 'POST', '/v1/policy/evaluate/application', 'workspace.operations', 'authoritative_read'),
  route('policy.evaluate.opportunity', 'POST', '/v1/policy/evaluate/opportunity', 'workspace.operations', 'authoritative_read'),
  route('policy.evaluate.runWindow', 'POST', '/v1/policy/evaluate/run-window', 'workspace.operations', 'authoritative_read'),

  route('profile.get', 'GET', '/v1/profile', 'workspace.profile', 'authoritative_read'),
  route('profile.update', 'PATCH', '/v1/profile', 'workspace.profile', 'authoritative_mutation'),
  route('profile.agentContext.get', 'GET', '/v1/profile/agent-context', 'workspace.profile', 'authoritative_read'),
  route('profile.document.get', 'GET', '/v1/profile/document', 'workspace.profile', 'authoritative_read'),
  route('profile.document.update', 'PUT', '/v1/profile/document', 'workspace.profile', 'authoritative_mutation'),
  route('profile.document.validate', 'POST', '/v1/profile/document/validate', 'workspace.profile', 'authoritative_read', { requestBody: false }),
  route('profile.document.format', 'POST', '/v1/profile/document/format', 'workspace.profile', 'authoritative_mutation'),
  route('profile.document.restore', 'POST', '/v1/profile/document/restore', 'workspace.profile', 'authoritative_mutation'),

  route('secrets.list', 'GET', '/v1/secrets', 'workspace.secrets.admin', 'authoritative_read'),
  route('secrets.upsert', 'PUT', '/v1/secrets/{secretKey}', 'workspace.secrets.admin', 'secret_administration'),
  route('secrets.delete', 'DELETE', '/v1/secrets/{secretKey}', 'workspace.secrets.admin', 'secret_administration'),
  route('secrets.local.resolve', 'POST', '/v1/secrets/local/resolve', 'workspace.secrets.localResolve', 'local_secret_resolution', { localOnly: true }),
] as const satisfies readonly WorkspaceRoute[]

export type WorkspaceOperationId = (typeof workspaceRouteRegistry)[number]['operationId']

/** SDK client factories are not wire operations and therefore have no OpenAPI path. */
export const workspaceNonWireOperations = [
  { operationId: 'forWorkspace', kind: 'client-factory' },
] as const

const pathPatternCache = new Map<string, RegExp>()

function pathPattern(path: string): RegExp {
  const cached = pathPatternCache.get(path)
  if (cached) return cached
  const pattern = new RegExp(`^${path.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&').replace(/\\\{[^}]+\\\}/g, '[^/]+')}$`)
  pathPatternCache.set(path, pattern)
  return pattern
}

/** Resolve a concrete request path to its declared operation. Query strings are ignored. */
export function findWorkspaceRoute(
  pathname: string,
  method?: string,
): WorkspaceRoute | undefined {
  return workspaceRouteRegistry.find((candidate) => {
    if (method && candidate.method !== method) return false
    return pathPattern(candidate.path).test(pathname)
  })
}

/** Used by local-server dispatch before handling a domain path. */
export function isDeclaredWorkspacePath(pathname: string): boolean {
  return workspaceRouteRegistry.some((candidate) => pathPattern(candidate.path).test(pathname))
}

export function isDeclaredWorkspaceRequest(pathname: string, method: string): boolean {
  return findWorkspaceRoute(pathname, method) !== undefined
}

export function sortWorkspaceRoutes(routes: readonly WorkspaceRoute[]): WorkspaceRoute[] {
  return [...routes].sort((left, right) =>
    left.path.localeCompare(right.path)
    || left.method.localeCompare(right.method)
    || left.operationId.localeCompare(right.operationId),
  )
}
