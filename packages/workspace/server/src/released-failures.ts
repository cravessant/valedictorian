export type ReleasedFailureKind =
  | 'authorization'
  | 'conflict'
  | 'not_found'
  | 'unavailable'
  | 'validation'

export type ReleasedEndpointFailure = Readonly<{
  code: string
  httpStatus: number
  kind: ReleasedFailureKind
  schema: string
  surface: string
}>

export const releasedEndpointFailures = [
  { surface: 'secrets.local.resolve', code: 'secret_not_found', httpStatus: 404, kind: 'not_found', schema: 'localSecretResolutionErrorBodySchema' },
  { surface: 'secrets.local.resolve', code: 'local_secret_resolution_unsupported', httpStatus: 409, kind: 'conflict', schema: 'localSecretResolutionErrorBodySchema' },
  { surface: 'secrets.local.resolve', code: 'local_secret_resolution_unauthorized', httpStatus: 403, kind: 'authorization', schema: 'localSecretResolutionErrorBodySchema' },
  { surface: 'secrets.local.resolve', code: 'secure_storage_unavailable', httpStatus: 503, kind: 'unavailable', schema: 'localSecretResolutionErrorBodySchema' },
  { surface: 'profile.document', code: 'invalid_profile_document', httpStatus: 422, kind: 'validation', schema: 'profileDocumentErrorBodySchema' },
  { surface: 'profile.document', code: 'unsupported_profile_schema_version', httpStatus: 409, kind: 'conflict', schema: 'profileDocumentErrorBodySchema' },
  { surface: 'profile.document', code: 'profile_revision_conflict', httpStatus: 409, kind: 'conflict', schema: 'profileDocumentErrorBodySchema' },
  { surface: 'profile.document', code: 'profile_document_unavailable', httpStatus: 404, kind: 'not_found', schema: 'profileDocumentErrorBodySchema' },
  { surface: 'profile.document', code: 'profile_backup_unavailable', httpStatus: 404, kind: 'not_found', schema: 'profileDocumentErrorBodySchema' },
  { surface: 'connectors.schedules', code: 'connector_scheduling_unavailable', httpStatus: 503, kind: 'unavailable', schema: 'connectorScheduleErrorBodySchema' },
  { surface: 'connectors.schedules', code: 'invalid_timezone', httpStatus: 422, kind: 'validation', schema: 'connectorScheduleErrorBodySchema' },
  { surface: 'connectors.schedules', code: 'invalid_cadence', httpStatus: 422, kind: 'validation', schema: 'connectorScheduleErrorBodySchema' },
  { surface: 'connectors.schedules', code: 'schedule_too_frequent', httpStatus: 422, kind: 'validation', schema: 'connectorScheduleErrorBodySchema' },
  { surface: 'connectors.schedules', code: 'stale_schedule_revision', httpStatus: 409, kind: 'conflict', schema: 'connectorScheduleErrorBodySchema' },
  { surface: 'connectors.schedules', code: 'schedule_dispatch_conflict', httpStatus: 409, kind: 'conflict', schema: 'connectorScheduleErrorBodySchema' },
  { surface: 'connectors.remove', code: 'connector_retirement_active_work_conflict', httpStatus: 409, kind: 'conflict', schema: 'connectorRetirementActiveWorkConflictSchema' },
  { surface: 'connectors.create', code: 'already_configured', httpStatus: 409, kind: 'conflict', schema: 'connectorCreateErrorBodySchema' },
  { surface: 'connectors.options.query', code: 'unsupported_descriptor', httpStatus: 409, kind: 'conflict', schema: 'connectorOptionQueryErrorBodySchema' },
  { surface: 'connectors.options.query', code: 'connector_version_mismatch', httpStatus: 409, kind: 'conflict', schema: 'connectorOptionQueryErrorBodySchema' },
  { surface: 'connectors.options.query', code: 'filter_schema_version_mismatch', httpStatus: 409, kind: 'conflict', schema: 'connectorOptionQueryErrorBodySchema' },
  { surface: 'connectors.options.query', code: 'option_catalog_version_mismatch', httpStatus: 409, kind: 'conflict', schema: 'connectorOptionQueryErrorBodySchema' },
  { surface: 'connectors.options.query', code: 'option_source_version_mismatch', httpStatus: 409, kind: 'conflict', schema: 'connectorOptionQueryErrorBodySchema' },
  { surface: 'connectors.options.query', code: 'option_source_undeclared', httpStatus: 422, kind: 'validation', schema: 'connectorOptionQueryErrorBodySchema' },
  { surface: 'connectors.options.query', code: 'option_dependency_undeclared', httpStatus: 422, kind: 'validation', schema: 'connectorOptionQueryErrorBodySchema' },
  { surface: 'connectors.options.query', code: 'option_dependency_invalid', httpStatus: 422, kind: 'validation', schema: 'connectorOptionQueryErrorBodySchema' },
  { surface: 'connectors.options.query', code: 'option_value_invalid', httpStatus: 422, kind: 'validation', schema: 'connectorOptionQueryErrorBodySchema' },
  { surface: 'connectors.options.query', code: 'option_query_unavailable', httpStatus: 409, kind: 'conflict', schema: 'connectorOptionQueryErrorBodySchema' },
  { surface: 'connectors.overview.list', code: 'invalid_connector_overview_cursor', httpStatus: 400, kind: 'validation', schema: 'connectorOverviewErrorPayloadSchema' },
] as const satisfies readonly ReleasedEndpointFailure[]

export type ReleasedEndpointFailureCode = (typeof releasedEndpointFailures)[number]['code']

export function releasedFailureSurface(operationId: string): string | undefined {
  if (operationId === 'secrets.local.resolve') return operationId
  if (operationId.startsWith('profile.document.')) return 'profile.document'
  if (operationId.startsWith('connectors.schedules.')) return 'connectors.schedules'
  if (
    operationId === 'connectors.remove'
    || operationId === 'connectors.create'
    || operationId === 'connectors.options.query'
    || operationId === 'connectors.overview.list'
  ) return operationId
  return undefined
}

export function endpointFailuresForOperation(
  operationId: string,
): readonly ReleasedEndpointFailure[] {
  const surface = releasedFailureSurface(operationId)
  return surface
    ? releasedEndpointFailures.filter((failure) => failure.surface === surface)
    : []
}
