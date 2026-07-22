import http from 'node:http'
import {
  defaultLocalCapabilities,
  localSecretResolutionErrorBodies,
  type ConnectorSchedulingCapability,
  type ProfileUpdateInput,
} from 'sparxie'
import { resolveConnectorSchedulingCapability } from '../modules/connectors/connector-schedule.capability'
import {
  readJsonBody,
  readOptionalBooleanField,
  readRequiredOpaqueStringField,
  readStringField,
  writeJson,
  writeNoStoreJson,
} from './local-server.http'
import {
  parseEvaluateApplicationPolicyInput,
  parseEvaluateOpportunityPolicyInput,
  parseEvaluateRunWindowPolicyInput,
  parsePolicyConfigPatch,
  parsePolicyEvidenceInput,
  parsePolicyEvidenceListQuery,
  parseActionQueueListQuery,
  parseRunCompleteInput,
  parseRunStartInput,
  parseRunStepInput,
  parseWorkflowRunsListQuery,
} from './local-server.parsers'
import type { WorkspaceClientResolver } from './local-server'
import type { LocalValedictorianClient } from '../runtime/local-connector-client.contract'
import type { LocalWorkspaceManager } from './local-workspaces'
import { handleConnectorRoutes } from './local-server.routes.connectors'
import { handleLifecycleRoutes } from './local-server.routes.lifecycle'
import {
  handleHttpRequestError,
  type ValedictorianHttpRequestErrorLogger,
} from './local-server.error-boundary'

function buildLocalCapabilities(
  connectorScheduling: ConnectorSchedulingCapability,
  localSecretResolutionEnabled: boolean,
) {
  return {
    ...defaultLocalCapabilities,
    workflowRuns: true,
    applicationAttempts: true,
    sourcing: false,
    connectors: true,
    connectorScheduling: resolveConnectorSchedulingCapability(connectorScheduling),
    localSecretResolution: localSecretResolutionEnabled,
  }
}

export async function handleRequest({
  client,
  connectorScheduling = defaultLocalCapabilities.connectorScheduling,
  localSecretResolutionEnabled = false,
  onRequestError,
  pathname: inboundPathname,
  request,
  resolveWorkspaceClient,
  response,
  token,
  workspaceManager,
  workspaceScoped = false,
}: {
  client: LocalValedictorianClient
  connectorScheduling?: ConnectorSchedulingCapability
  localSecretResolutionEnabled?: boolean
  onRequestError: ValedictorianHttpRequestErrorLogger
  pathname?: string
  request: http.IncomingMessage
  resolveWorkspaceClient?: WorkspaceClientResolver
  response: http.ServerResponse
  token?: string
  workspaceManager?: LocalWorkspaceManager
  workspaceScoped?: boolean
}) {
  const pathname = inboundPathname
    ?? new URL(request.url ?? '/', 'http://127.0.0.1').pathname
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

      let workspaceClient: LocalValedictorianClient
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
          onRequestError,
          pathname,
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

    if (await handleLifecycleRoutes({ client, request, requestUrl, response })) {
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

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/evaluate/opportunity') {
      writeJson(
        response,
        200,
        await client.policy.evaluate.opportunity(
          parseEvaluateOpportunityPolicyInput(await readJsonBody(request)),
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

      const result = await client.secrets.local.resolve(await readJsonBody(request) as never)
      writeNoStoreJson(response, 200, result)
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

    if (request.method === 'POST' && requestUrl.pathname === '/v1/scores') {
      writeJson(
        response,
        200,
        await client.scores.record((await readJsonBody(request)) as Parameters<
          typeof client.scores.record
        >[0]),
      )
      return
    }

    writeJson(response, 404, { message: 'Not found' })
  } catch (error) {
    handleHttpRequestError({
      error,
      isLocalSecretResolveRoute: isLocalSecretResolvePath(pathname),
      onRequestError,
      pathname,
      request,
      response,
    })
  }
}

function isDomainRoute(pathname: string) {
  return /^\/v1\/(applications|captures|jobs|opportunities|action-queue|connector-descriptors|connectors|policy|profile|runs|scores|secrets)(?:\/|$)/.test(
    pathname,
  )
}

export function isLocalSecretResolvePath(pathname: string) {
  return pathname === '/v1/secrets/local/resolve'
    || /^\/v1\/workspaces\/[^/]+\/secrets\/local\/resolve$/.test(pathname)
}
