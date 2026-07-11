import http from 'node:http'
import { defaultLocalCapabilities, isApplicationStatus, type BatchRawSourceRecordsInput, type ValedictorianWorkspaceClient, type ProfileUpdateInput } from 'sparxie'
import {
  readJsonBody,
  readOptionalBooleanField,
  readOptionalStringField,
  readStringField,
  writeJson,
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
  parseConnectorCheckpointsListQuery,
  parseConnectorObservationsListQuery,
  parseConnectorRunsListQuery,
  parseConnectorRunTriggerInput,
  parseCreateConnectorInstanceInput,
  parseUpdateConnectorInstanceInput,
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

const localCapabilities = {
  ...defaultLocalCapabilities,
  workflowRuns: true,
  applicationAttempts: true,
  sourcing: true,
  connectors: true,
}

const MAX_RAW_SOURCE_BATCH_BODY_BYTES = 128 * 1024 * 1024
const MAX_RAW_SOURCE_REPLAY_BODY_BYTES = 1024 * 1024

export async function handleRequest({
  client,
  request,
  resolveWorkspaceClient,
  response,
  token,
  workspaceManager,
  workspaceScoped = false,
}: {
  client: ValedictorianWorkspaceClient
  request: http.IncomingMessage
  resolveWorkspaceClient?: WorkspaceClientResolver
  response: http.ServerResponse
  token?: string
  workspaceManager?: LocalWorkspaceManager
  workspaceScoped?: boolean
}) {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (request.method === 'GET' && requestUrl.pathname === '/v1/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/capabilities') {
      writeJson(response, 200, localCapabilities)
      return
    }

    if (token && request.headers.authorization !== `Bearer ${token}`) {
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

      const workspaceClient = await workspaceClientResolver(decodeURIComponent(workspaceMatch[1]))
      const originalUrl = request.url
      request.url = `/v1${workspaceMatch[2]}${requestUrl.search}`

      try {
        await handleRequest({ client: workspaceClient, request, response, workspaceScoped: true })
      } finally {
        request.url = originalUrl
      }

      return
    }

    if (!workspaceScoped && isDomainRoute(requestUrl.pathname)) {
      writeJson(response, 404, { message: 'Not found' })
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

    if (request.method === 'GET' && requestUrl.pathname === '/v1/connectors') {
      writeJson(response, 200, await connectorExtensions(client).list())
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/connectors') {
      writeJson(
        response,
        200,
        await connectorExtensions(client).create(
          parseCreateConnectorInstanceInput(await readJsonBody(request)),
        ),
      )
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

    if (request.method === 'GET' && requestUrl.pathname === '/v1/profile/sensitive') {
      writeJson(response, 200, await profileExtensions(client).sensitive.get())
      return
    }

    if (request.method === 'PATCH' && requestUrl.pathname === '/v1/profile/sensitive') {
      writeJson(
        response,
        200,
        await profileExtensions(client).sensitive.update(await readJsonBody(request)),
      )
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/secrets') {
      writeJson(response, 200, { items: await profileExtensions(client).secrets.list() })
      return
    }

    const secretMatch = requestUrl.pathname.match(/^\/v1\/secrets\/([^/]+)$/)

    if (request.method === 'PUT' && secretMatch) {
      const body = await readJsonBody(request)

      writeJson(
        response,
        200,
        await profileExtensions(client).secrets.upsert({
          key: decodeURIComponent(secretMatch[1]),
          kind: readStringField(body, 'kind') as never,
          label: readStringField(body, 'label'),
          value: readStringField(body, 'value'),
        }),
      )
      return
    }

    if (request.method === 'DELETE' && secretMatch) {
      await profileExtensions(client).secrets.delete(decodeURIComponent(secretMatch[1]))
      writeJson(response, 200, { ok: true })
      return
    }

    const connectorStatusMatch = requestUrl.pathname.match(/^\/v1\/connectors\/([^/]+)\/status$/)

    const connectorInstanceMatch = requestUrl.pathname.match(/^\/v1\/connectors\/([^/]+)$/)

    if (request.method === 'PATCH' && connectorInstanceMatch) {
      writeJson(
        response,
        200,
        await connectorExtensions(client).update(
          parseUpdateConnectorInstanceInput(
            decodeURIComponent(connectorInstanceMatch[1]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    if (request.method === 'GET' && connectorStatusMatch) {
      writeJson(
        response,
        200,
        await connectorExtensions(client).inspect(decodeURIComponent(connectorStatusMatch[1])),
      )
      return
    }

    const connectorRunsMatch = requestUrl.pathname.match(/^\/v1\/connectors\/([^/]+)\/runs$/)

    if (request.method === 'GET' && connectorRunsMatch) {
      writeJson(
        response,
        200,
        await connectorExtensions(client).runs.list(
          parseConnectorRunsListQuery(decodeURIComponent(connectorRunsMatch[1]), requestUrl),
        ),
      )
      return
    }

    if (request.method === 'POST' && connectorRunsMatch) {
      writeJson(
        response,
        200,
        await connectorExtensions(client).runs.trigger(
          parseConnectorRunTriggerInput(
            decodeURIComponent(connectorRunsMatch[1]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const connectorCheckpointsMatch = requestUrl.pathname.match(
      /^\/v1\/connectors\/([^/]+)\/checkpoints$/,
    )

    if (request.method === 'GET' && connectorCheckpointsMatch) {
      writeJson(
        response,
        200,
        await connectorExtensions(client).checkpoints.list(
          parseConnectorCheckpointsListQuery(
            decodeURIComponent(connectorCheckpointsMatch[1]),
            requestUrl,
          ),
        ),
      )
      return
    }

    const connectorObservationsMatch = requestUrl.pathname.match(
      /^\/v1\/connectors\/([^/]+)\/observations$/,
    )

    if (request.method === 'GET' && connectorObservationsMatch) {
      writeJson(
        response,
        200,
        await connectorExtensions(client).observations.list(
          parseConnectorObservationsListQuery(
            decodeURIComponent(connectorObservationsMatch[1]),
            requestUrl,
          ),
        ),
      )
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

    const rawRecordNormalizationMatch = requestUrl.pathname.match(
      /^\/v1\/sourcing\/raw-records\/([^/]+)\/normalization$/,
    )

    if (request.method === 'GET' && rawRecordNormalizationMatch) {
      writeJson(
        response,
        200,
        await client.sourcing.rawRecords.normalization.get(
          decodeURIComponent(rawRecordNormalizationMatch[1]),
        ),
      )
      return
    }

    const rawRecordMatch = requestUrl.pathname.match(/^\/v1\/sourcing\/raw-records\/([^/]+)$/)

    if (request.method === 'GET' && rawRecordMatch) {
      writeJson(
        response,
        200,
        await client.sourcing.rawRecords.get(decodeURIComponent(rawRecordMatch[1])),
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
    const body: { code?: string; message: string } = {
      message: error instanceof Error ? error.message : String(error),
    }

    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'capability_unavailable'
    ) {
      body.code = 'capability_unavailable'
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
  return /^\/v1\/(applications|action-queue|connectors|policy|profile|runs|sourcing|scores|secrets)(?:\/|$)/.test(
    pathname,
  )
}

type ConnectorExtensionsClient = ValedictorianWorkspaceClient & {
  connectors: {
    list(): Promise<unknown>
    create(input: unknown): Promise<unknown>
    update(input: unknown): Promise<unknown>
    inspect(connectorInstanceId: string): Promise<unknown>
    runs: {
      list(input: unknown): Promise<unknown>
      trigger(input: unknown): Promise<unknown>
    }
    checkpoints: {
      list(input: unknown): Promise<unknown>
    }
    observations: {
      list(input: unknown): Promise<unknown>
    }
  }
}

function connectorExtensions(client: ValedictorianWorkspaceClient) {
  return (client as ConnectorExtensionsClient).connectors
}

type ProfileExtensionsClient = ValedictorianWorkspaceClient & {
  profile: ValedictorianWorkspaceClient['profile'] & {
    secrets: {
      delete(key: string): Promise<void>
      list(): Promise<unknown[]>
      upsert(input: {
        key: string
        kind: never
        label: string
        value: string
      }): Promise<unknown>
    }
    sensitive: {
      get(): Promise<unknown>
      update(input: unknown): Promise<unknown>
    }
  }
}

function profileExtensions(client: ValedictorianWorkspaceClient) {
  return (client as ProfileExtensionsClient).profile
}
