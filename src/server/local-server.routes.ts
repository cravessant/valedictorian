import http from 'node:http'
import {
  connectorScheduleErrorCodes,
  connectorOptionQueryErrorCodes,
  connectorRetirementActiveWorkConflictSchema,
  connectorOverviewErrorCodes,
  defaultLocalCapabilities,
  invalidPersistedRawDetailErrorBody,
  isApplicationStatus,
  localSecretResolutionErrorBodies,
  localSecretResolutionErrorCodes,
  profileDocumentErrorCodes,
  rawSourceRecordSchema,
  rawSourceRecordsListResultSchema,
  type BatchRawSourceRecordsInput,
  type ConnectorSchedulingCapability,
  type ValedictorianWorkspaceClient,
  type ProfileUpdateInput,
} from 'sparxie'
import { resolveConnectorSchedulingCapability } from '../modules/connectors/connector-schedule.capability'
import { toLocalSecretResolutionHttpFailure } from '../modules/secrets/local-secret-resolution'
import {
  readJsonBody,
  readOptionalBooleanField,
  readOptionalStringField,
  readRequiredOpaqueStringField,
  readStringField,
  writeJson,
  writeNoStoreJson,
} from './local-server.http'
import {
  parseApplicationAttemptsQuery,
  parseApplicationEventsQuery,
  parseApplicationLinksQuery,
  parseApplicationListQuery,
  parseApplicationUpdateInput,
  parseAttemptCompleteInput,
  parseAttemptStartInput,
  parseAttemptStepInput,
  parseCreateApplicationInput,
  parseEvaluateApplicationPolicyInput,
  parseEvaluateRunWindowPolicyInput,
  parseEvaluateSourcingCandidatePolicyInput,
  parseLinkCreateInput,
  parseLinkUpdateInput,
  parsePolicyConfigPatch,
  parsePolicyEvidenceInput,
  parsePolicyEvidenceListQuery,
  parseActionQueueListQuery,
  parseRunCompleteInput,
  parseRunStartInput,
  parseRunStepInput,
  parseRawSourceRecordsListQuery,
  parseSourcingCandidateProcessInput,
  parseSourcingFindingDecisionInput,
  parseSourcingFindingCreateInput,
  parseSourcingFindingsListQuery,
  parseSourcingFindingUpdateInput,
  parseWorkflowRunsListQuery,
  parseWorkflowUpdateInput,
} from './local-server.parsers'
import type { WorkspaceClientResolver } from './local-server'
import type { LocalWorkspaceManager } from './local-workspaces'
import { handleConnectorRoutes } from './local-server.routes.connectors'

function buildLocalCapabilities(
  connectorScheduling: ConnectorSchedulingCapability,
  localSecretResolutionEnabled: boolean,
) {
  return {
    ...defaultLocalCapabilities,
    workflowRuns: true,
    applicationAttempts: true,
    sourcing: true,
    connectors: true,
    connectorScheduling: resolveConnectorSchedulingCapability(connectorScheduling),
    localSecretResolution: localSecretResolutionEnabled,
  }
}

const MAX_RAW_SOURCE_BATCH_BODY_BYTES = 128 * 1024 * 1024
const MAX_RAW_SOURCE_REPLAY_BODY_BYTES = 1024 * 1024

export async function handleRequest({
  client,
  connectorScheduling = defaultLocalCapabilities.connectorScheduling,
  localSecretResolutionEnabled = false,
  request,
  resolveWorkspaceClient,
  response,
  token,
  workspaceManager,
  workspaceScoped = false,
}: {
  client: ValedictorianWorkspaceClient
  connectorScheduling?: ConnectorSchedulingCapability
  localSecretResolutionEnabled?: boolean
  request: http.IncomingMessage
  resolveWorkspaceClient?: WorkspaceClientResolver
  response: http.ServerResponse
  token?: string
  workspaceManager?: LocalWorkspaceManager
  workspaceScoped?: boolean
}) {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const isLocalSecretResolveRoute = isLocalSecretResolvePath(requestUrl.pathname)

    if (request.method === 'GET' && requestUrl.pathname === '/v1/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/capabilities') {
      writeJson(
        response,
        200,
        buildLocalCapabilities(connectorScheduling, localSecretResolutionEnabled),
      )
      return
    }

    if (isLocalSecretResolveRoute) {
      // Unscoped root never resolves a workspace; keep it canonical 404/no-store.
      if (requestUrl.pathname === '/v1/secrets/local/resolve' && !workspaceScoped) {
        writeNoStoreJson(response, 404, { message: 'Not found' })
        return
      }

      if (!token || request.headers.authorization !== `Bearer ${token}`) {
        writeNoStoreJson(
          response,
          403,
          localSecretResolutionErrorBodies.local_secret_resolution_unauthorized,
        )
        return
      }
    } else if (token && request.headers.authorization !== `Bearer ${token}`) {
      writeJson(response, 401, { message: 'Unauthorized' })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/workspaces') {
      if (!workspaceManager) {
        writeJson(response, 404, { message: 'Workspace registry is unavailable' })
        return
      }

      writeJson(response, 200, await workspaceManager.list())
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/workspaces/open') {
      if (!workspaceManager) {
        writeJson(response, 404, { message: 'Workspace registry is unavailable' })
        return
      }
      const body = await readJsonBody(request)

      writeJson(
        response,
        200,
        await workspaceManager.open({
          path: readStringField(body, 'path'),
          rekey: readOptionalBooleanField(body, 'rekey'),
        }),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/workspaces/create') {
      if (!workspaceManager) {
        writeJson(response, 404, { message: 'Workspace registry is unavailable' })
        return
      }
      const body = await readJsonBody(request)

      writeJson(
        response,
        200,
        await workspaceManager.create({
          path: readStringField(body, 'path'),
          rekey: readOptionalBooleanField(body, 'rekey'),
        }),
      )
      return
    }

    const workspaceMatch = requestUrl.pathname.match(/^\/v1\/workspaces\/([^/]+)(\/.*)$/)

    if (workspaceMatch) {
      const workspaceClientResolver =
        resolveWorkspaceClient ?? workspaceManager?.resolveClient.bind(workspaceManager) ?? (() => client)

      let workspaceClient: ValedictorianWorkspaceClient
      try {
        workspaceClient = await workspaceClientResolver(decodeURIComponent(workspaceMatch[1]))
      } catch (error) {
        if (isLocalSecretResolvePath(requestUrl.pathname)) {
          writeNoStoreJson(response, 404, { message: 'Not found' })
          return
        }
        throw error
      }
      const originalUrl = request.url
      request.url = `/v1${workspaceMatch[2]}${requestUrl.search}`

      try {
        await handleRequest({
          client: workspaceClient,
          connectorScheduling,
          localSecretResolutionEnabled,
          request,
          response,
          token,
          workspaceScoped: true,
        })
      } finally {
        request.url = originalUrl
      }

      return
    }

    if (!workspaceScoped && isDomainRoute(requestUrl.pathname)) {
      if (isLocalSecretResolvePath(requestUrl.pathname)) {
        writeNoStoreJson(response, 404, { message: 'Not found' })
        return
      }
      writeJson(response, 404, { message: 'Not found' })
      return
    }

    if (await handleConnectorRoutes({ client, request, requestUrl, response })) {
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/applications') {
      writeJson(response, 200, await client.applications.list(parseApplicationListQuery(requestUrl)))
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/action-queue') {
      writeJson(response, 200, await client.actionQueue.list(parseActionQueueListQuery(requestUrl)))
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/policy/config') {
      writeJson(response, 200, await client.policy.config.get())
      return
    }

    if (request.method === 'PATCH' && requestUrl.pathname === '/v1/policy/config') {
      writeJson(response, 200, await client.policy.config.update(parsePolicyConfigPatch(await readJsonBody(request))))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/config/reset') {
      writeJson(response, 200, await client.policy.config.reset())
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/policy/evidence') {
      writeJson(response, 200, await client.policy.evidence.list(parsePolicyEvidenceListQuery(requestUrl)))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/evidence') {
      writeJson(
        response,
        200,
        await client.policy.evidence.record(parsePolicyEvidenceInput(await readJsonBody(request))),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/evaluate/application') {
      writeJson(
        response,
        200,
        await client.policy.evaluate.application(
          parseEvaluateApplicationPolicyInput(await readJsonBody(request)),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/evaluate/sourcing-candidate') {
      writeJson(
        response,
        200,
        await client.policy.evaluate.sourcingCandidate(
          parseEvaluateSourcingCandidatePolicyInput(await readJsonBody(request)),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/evaluate/run-window') {
      writeJson(
        response,
        200,
        await client.policy.evaluate.runWindow(
          parseEvaluateRunWindowPolicyInput(await readJsonBody(request)),
        ),
      )
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/profile') {
      writeJson(response, 200, await client.profile.get())
      return
    }

    if (request.method === 'PATCH' && requestUrl.pathname === '/v1/profile') {
      writeJson(response, 200, await client.profile.update((await readJsonBody(request)) as ProfileUpdateInput))
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/profile/agent-context') {
      writeJson(response, 200, await client.profile.agentContext.get())
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/profile/document') {
      writeJson(response, 200, await client.profile.document.get())
      return
    }

    if (request.method === 'PUT' && requestUrl.pathname === '/v1/profile/document') {
      writeJson(
        response,
        200,
        await client.profile.document.update(await readJsonBody(request) as never),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/profile/document/validate') {
      writeJson(response, 200, await client.profile.document.validate())
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/profile/document/format') {
      writeJson(
        response,
        200,
        await client.profile.document.format(await readJsonBody(request) as never),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/profile/document/restore') {
      writeJson(
        response,
        200,
        await client.profile.document.restore(await readJsonBody(request) as never),
      )
      return
    }

    if (requestUrl.pathname === '/v1/secrets/local/resolve') {
      if (request.method !== 'POST') {
        writeNoStoreJson(response, 404, { message: 'Not found' })
        return
      }

      if (!localSecretResolutionEnabled) {
        writeNoStoreJson(
          response,
          409,
          localSecretResolutionErrorBodies.local_secret_resolution_unsupported,
        )
        return
      }

      try {
        const result = await client.secrets.local.resolve(await readJsonBody(request) as never)
        writeNoStoreJson(response, 200, result)
      } catch (error) {
        const failure = toLocalSecretResolutionHttpFailure(error)
        writeNoStoreJson(response, failure.statusCode, failure.body)
      }
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/secrets') {
      writeJson(response, 200, await client.secrets.list())
      return
    }

    const secretMatch = requestUrl.pathname.match(/^\/v1\/secrets\/([^/]+)$/)

    if (request.method === 'PUT' && secretMatch) {
      const body = await readJsonBody(request)

      writeJson(
        response,
        200,
        await client.secrets.upsert({
          key: decodeURIComponent(secretMatch[1]),
          kind: readStringField(body, 'kind') as never,
          label: readStringField(body, 'label'),
          value: readRequiredOpaqueStringField(body, 'value'),
        }),
      )
      return
    }

    if (request.method === 'DELETE' && secretMatch) {
      await client.secrets.delete(decodeURIComponent(secretMatch[1]))
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/runs') {
      writeJson(response, 200, await client.runs.list(parseWorkflowRunsListQuery(requestUrl)))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/runs') {
      writeJson(response, 200, await client.runs.start(parseRunStartInput(await readJsonBody(request))))
      return
    }

    const runCompleteMatch = requestUrl.pathname.match(/^\/v1\/runs\/([^/]+)\/complete$/)

    if (request.method === 'PATCH' && runCompleteMatch) {
      writeJson(
        response,
        200,
        await client.runs.complete(
          parseRunCompleteInput(decodeURIComponent(runCompleteMatch[1]), await readJsonBody(request)),
        ),
      )
      return
    }

    const runStepMatch = requestUrl.pathname.match(/^\/v1\/runs\/([^/]+)\/steps$/)

    if (request.method === 'POST' && runStepMatch) {
      writeJson(
        response,
        200,
        await client.runs.step(
          parseRunStepInput(decodeURIComponent(runStepMatch[1]), await readJsonBody(request)),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/sourcing/candidates/process') {
      writeJson(
        response,
        200,
        await client.sourcing.candidates.process(
          parseSourcingCandidateProcessInput(await readJsonBody(request)),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/sourcing/raw-records/batch') {
      writeJson(
        response,
        200,
        await client.sourcing.rawRecords.ingestBatch(
          (await readJsonBody(request, {
            maxBytes: MAX_RAW_SOURCE_BATCH_BODY_BYTES,
          })) as BatchRawSourceRecordsInput,
        ),
      )
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/sourcing/raw-records') {
      writeJson(
        response,
        200,
        rawSourceRecordsListResultSchema.parse(
          await client.sourcing.rawRecords.list(parseRawSourceRecordsListQuery(requestUrl)),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/sourcing/raw-records/replay') {
      writeJson(
        response,
        200,
        await client.sourcing.rawRecords.replay(
          (await readJsonBody(request, {
            maxBytes: MAX_RAW_SOURCE_REPLAY_BODY_BYTES,
            maxBytesMessage: 'Request body exceeds the raw replay limit',
          })) as Parameters<
            ValedictorianWorkspaceClient['sourcing']['rawRecords']['replay']
          >[0],
        ),
      )
      return
    }

    const rawRevisionProjectionMatch = requestUrl.pathname.match(
      /^\/v1\/sourcing\/raw-revisions\/([^/]+)\/projection$/,
    )

    if (request.method === 'GET' && rawRevisionProjectionMatch) {
      writeJson(response, 200, await client.sourcing.rawRevisions.projection.get(
        decodeURIComponent(rawRevisionProjectionMatch[1]),
      ))
      return
    }

    const rawRecordNormalizationMatch = requestUrl.pathname.match(
      /^\/v1\/sourcing\/raw-records\/([^/]+)\/normalization$/,
    )

    if (request.method === 'GET' && rawRecordNormalizationMatch) {
      const normalization = await client.sourcing.rawRecords.normalization.get(
        decodeURIComponent(rawRecordNormalizationMatch[1]),
      )
      const { triggerOccurrence: _internalTriggerOccurrence, ...publicNormalization } = normalization as typeof normalization & {
        triggerOccurrence?: unknown
      }
      writeJson(
        response,
        200,
        publicNormalization,
      )
      return
    }

    const rawRecordMatch = requestUrl.pathname.match(/^\/v1\/sourcing\/raw-records\/([^/]+)$/)

    if (request.method === 'GET' && rawRecordMatch) {
      const rawRecord = rawSourceRecordSchema.safeParse(
        await client.sourcing.rawRecords.get(decodeURIComponent(rawRecordMatch[1])),
      )
      if (!rawRecord.success) {
        throw Object.assign(new Error(invalidPersistedRawDetailErrorBody.message), {
          code: invalidPersistedRawDetailErrorBody.code,
          statusCode: 500,
        })
      }
      writeJson(
        response,
        200,
        rawRecord.data,
      )
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/sourcing/findings') {
      writeJson(
        response,
        200,
        await client.sourcing.findings.list(parseSourcingFindingsListQuery(requestUrl)),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/sourcing/findings') {
      writeJson(
        response,
        200,
        await client.sourcing.findings.create(parseSourcingFindingCreateInput(await readJsonBody(request))),
      )
      return
    }

    const findingPromoteMatch = requestUrl.pathname.match(
      /^\/v1\/sourcing\/findings\/([^/]+)\/promote$/,
    )

    if (request.method === 'POST' && findingPromoteMatch) {
      writeJson(
        response,
        200,
        await client.sourcing.findings.promote({
          findingId: decodeURIComponent(findingPromoteMatch[1]),
        }),
      )
      return
    }

    const findingDecisionMatch = requestUrl.pathname.match(
      /^\/v1\/sourcing\/findings\/([^/]+)\/decide$/,
    )

    if (request.method === 'POST' && findingDecisionMatch) {
      writeJson(
        response,
        200,
        await client.sourcing.findings.decide(
          parseSourcingFindingDecisionInput(
            decodeURIComponent(findingDecisionMatch[1]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const findingMatch = requestUrl.pathname.match(/^\/v1\/sourcing\/findings\/([^/]+)$/)

    if (request.method === 'PATCH' && findingMatch) {
      writeJson(
        response,
        200,
        await client.sourcing.findings.update(
          parseSourcingFindingUpdateInput(
            decodeURIComponent(findingMatch[1]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/applications') {
      writeJson(
        response,
        200,
        await client.applications.create(parseCreateApplicationInput(await readJsonBody(request))),
      )
      return
    }

    const statusMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/status$/)

    if (request.method === 'PATCH' && statusMatch) {
      const body = await readJsonBody(request)
      const status = readStringField(body, 'status')

      if (!isApplicationStatus(status)) {
        writeJson(response, 400, { message: `Invalid application status: ${status}` })
        return
      }

      writeJson(
        response,
        200,
        await client.applications.updateStatus({
          applicationId: decodeURIComponent(statusMatch[1]),
          status,
          notes: readOptionalStringField(body, 'notes'),
        }),
      )
      return
    }

    const archiveMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/archive$/)

    if (request.method === 'PATCH' && archiveMatch) {
      await client.applications.archive({
        applicationId: decodeURIComponent(archiveMatch[1]),
        note: readOptionalStringField(await readJsonBody(request), 'note'),
      })
      writeJson(response, 200, { ok: true })
      return
    }

    const workflowMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/workflow$/)

    if (request.method === 'PATCH' && workflowMatch) {
      writeJson(
        response,
        200,
        await client.applications.workflow.update(
          parseWorkflowUpdateInput(
            decodeURIComponent(workflowMatch[1]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const notesMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/notes$/)

    if (request.method === 'POST' && notesMatch) {
      writeJson(
        response,
        200,
        await client.applications.notes.append({
          applicationId: decodeURIComponent(notesMatch[1]),
          message: readStringField(await readJsonBody(request), 'message'),
        }),
      )
      return
    }

    const linkMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/links\/([^/]+)$/)

    if (request.method === 'PATCH' && linkMatch) {
      writeJson(
        response,
        200,
        await client.applications.links.update(
          parseLinkUpdateInput(
            decodeURIComponent(linkMatch[1]),
            decodeURIComponent(linkMatch[2]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const linksMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/links$/)

    if (request.method === 'GET' && linksMatch) {
      writeJson(
        response,
        200,
        await client.applications.links.list(
          parseApplicationLinksQuery(decodeURIComponent(linksMatch[1]), requestUrl),
        ),
      )
      return
    }

    if (request.method === 'POST' && linksMatch) {
      writeJson(
        response,
        200,
        await client.applications.links.create(
          parseLinkCreateInput(decodeURIComponent(linksMatch[1]), await readJsonBody(request)),
        ),
      )
      return
    }

    const eventsMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/events$/)

    if (request.method === 'GET' && eventsMatch) {
      writeJson(
        response,
        200,
        await client.applications.events.list(
          parseApplicationEventsQuery(decodeURIComponent(eventsMatch[1]), requestUrl),
        ),
      )
      return
    }

    const attemptCompleteMatch = requestUrl.pathname.match(
      /^\/v1\/applications\/([^/]+)\/attempts\/([^/]+)\/complete$/,
    )

    if (request.method === 'PATCH' && attemptCompleteMatch) {
      writeJson(
        response,
        200,
        await client.applications.attempts.complete(
          parseAttemptCompleteInput(
            decodeURIComponent(attemptCompleteMatch[1]),
            decodeURIComponent(attemptCompleteMatch[2]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const attemptStepMatch = requestUrl.pathname.match(
      /^\/v1\/applications\/([^/]+)\/attempts\/([^/]+)\/steps$/,
    )

    if (request.method === 'POST' && attemptStepMatch) {
      writeJson(
        response,
        200,
        await client.applications.attempts.step(
          parseAttemptStepInput(
            decodeURIComponent(attemptStepMatch[1]),
            decodeURIComponent(attemptStepMatch[2]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const attemptsMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/attempts$/)

    if (request.method === 'GET' && attemptsMatch) {
      writeJson(
        response,
        200,
        await client.applications.attempts.list(
          parseApplicationAttemptsQuery(decodeURIComponent(attemptsMatch[1]), requestUrl),
        ),
      )
      return
    }

    if (request.method === 'POST' && attemptsMatch) {
      writeJson(
        response,
        200,
        await client.applications.attempts.start(
          parseAttemptStartInput(decodeURIComponent(attemptsMatch[1]), await readJsonBody(request)),
        ),
      )
      return
    }

    const applicationMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)$/)

    if (request.method === 'GET' && applicationMatch) {
      const applicationId = decodeURIComponent(applicationMatch[1])
      const application = await client.applications.get(applicationId)

      if (!application) {
        writeJson(response, 404, { message: `Application not found: ${applicationId}` })
        return
      }

      writeJson(response, 200, application)
      return
    }

    if (request.method === 'PATCH' && applicationMatch) {
      writeJson(
        response,
        200,
        await client.applications.update(
          parseApplicationUpdateInput(
            decodeURIComponent(applicationMatch[1]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/scores') {
      writeJson(
        response,
        200,
        await client.scores.record((await readJsonBody(request)) as Parameters<
          ValedictorianWorkspaceClient['scores']['record']
        >[0]),
      )
      return
    }

    writeJson(response, 404, { message: 'Not found' })
  } catch (error) {
    const retirementConflict = connectorRetirementActiveWorkConflictSchema.safeParse(
      error && typeof error === 'object' ? {
        code: 'code' in error ? error.code : undefined,
        connectorInstanceId: 'connectorInstanceId' in error
          ? error.connectorInstanceId
          : undefined,
        message: 'message' in error ? error.message : undefined,
        cancellationRequired: 'cancellationRequired' in error
          ? error.cancellationRequired
          : undefined,
        activeRuns: 'activeRuns' in error ? error.activeRuns : undefined,
      } : error,
    )
    if (retirementConflict.success) {
      writeJson(response, 409, retirementConflict.data)
      return
    }

    if (
      error &&
      typeof error === 'object' &&
      'body' in error &&
      error.body &&
      typeof error.body === 'object' &&
      'code' in error.body &&
      typeof (error.body as { code?: unknown }).code === 'string' &&
      (localSecretResolutionErrorCodes as readonly string[]).includes(
        (error.body as { code: string }).code,
      )
    ) {
      const failure = toLocalSecretResolutionHttpFailure(error)
      writeNoStoreJson(response, failure.statusCode, failure.body)
      return
    }

    if (
      error &&
      typeof error === 'object' &&
      'body' in error &&
      error.body &&
      typeof error.body === 'object' &&
      'code' in error.body &&
      typeof (error.body as { code?: unknown }).code === 'string' &&
      (profileDocumentErrorCodes as readonly string[]).includes(
        (error.body as { code: string }).code,
      )
    ) {
      writeJson(response, readErrorStatusCode(error), error.body)
      return
    }

    const body: { code?: string; message: string } = {
      message: error instanceof Error ? error.message : String(error),
    }

    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      (error.code === invalidPersistedRawDetailErrorBody.code
        || error.code === 'already_configured'
        || error.code === 'capability_unavailable'
        || (connectorOptionQueryErrorCodes as readonly string[]).includes(error.code)
        || (connectorScheduleErrorCodes as readonly string[]).includes(error.code)
        || (connectorOverviewErrorCodes as readonly string[]).includes(error.code))
    ) {
      body.code = error.code
    }

    writeJson(response, readErrorStatusCode(error), body)
  }
}

function readErrorStatusCode(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  ) {
    return error.statusCode
  }

  return 400
}

function isDomainRoute(pathname: string) {
  return /^\/v1\/(applications|action-queue|connector-descriptors|connectors|policy|profile|runs|sourcing|scores|secrets)(?:\/|$)/.test(
    pathname,
  )
}

export function isLocalSecretResolvePath(pathname: string) {
  return pathname === '/v1/secrets/local/resolve'
    || /^\/v1\/workspaces\/[^/]+\/secrets\/local\/resolve$/.test(pathname)
}
