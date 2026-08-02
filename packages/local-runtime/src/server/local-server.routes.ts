import http from 'node:http'
import {
  defaultLocalCapabilities,
  localSecretResolutionErrorBodies,
  type ConnectorSchedulingCapability,
  type ProfileUpdateInput,
} from '@sparxie/sdk'
import { resolveConnectorSchedulingCapability } from '../modules/connectors/public.js'
import {
  readJsonBody,
  readOptionalBooleanField,
  readRequiredOpaqueStringField,
  readStringField,
  writeJson,
  writeNoStoreJson,
} from './local-server.http.js'
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
} from './local-server.parsers.js'
import type { WorkspaceClientResolver } from './local-server.js'
import type { LocalValedictorianClient } from '../runtime/local-connector-client.contract.js'
import type { LocalWorkspaceManager } from './local-workspaces.js'
import { handleConnectorRoutes } from './local-server.routes.connectors.js'
import { handleLifecycleRoutes } from './local-server.routes.lifecycle.js'
import { handleCompanyRoutes } from './local-server.routes.companies.js'
import { handleCaptureResolutionRoutes } from './local-server.routes.capture-resolution.js'
import {
  handleHttpRequestError,
  type ValedictorianHttpRequestErrorLogger,
} from './local-server.error-boundary.js'
import {
  assertWorkspaceRouterCoverage,
  createWorkspaceFailure,
  findWorkspaceRoute,
  isDeclaredWorkspacePath,
} from '@sparxie/valedictorian-workspace-server'
import { workspaceAuthorityAdmissionForClient } from '../runtime/workspace-authority-admission.js'

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
    const declaredWorkspaceRoute = findWorkspaceRoute(requestUrl.pathname, request.method)
    const isLocalSecretResolveRoute = isLocalSecretResolvePath(requestUrl.pathname)

    if (request.method === 'GET' && requestUrl.pathname === '/v1/health') {
      assertWorkspaceRouterCoverage(declaredWorkspaceRoute, true)
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/capabilities') {
      assertWorkspaceRouterCoverage(declaredWorkspaceRoute, true)
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
      assertWorkspaceRouterCoverage(declaredWorkspaceRoute, true)
      if (!workspaceManager) {
        writeJson(response, 404, { message: 'Workspace registry is unavailable' })
        return
      }

      writeJson(response, 200, await workspaceManager.list())
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/workspaces/open') {
      assertWorkspaceRouterCoverage(declaredWorkspaceRoute, true)
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
      assertWorkspaceRouterCoverage(declaredWorkspaceRoute, true)
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

    const workspaceMatch = requestUrl.pathname.match(/^\/v([12])\/workspaces\/([^/]+)(\/.*)$/)

    if (workspaceMatch) {
      const workspaceClientResolver =
        resolveWorkspaceClient ?? workspaceManager?.resolveClient.bind(workspaceManager) ?? (() => client)

      let workspaceClient: LocalValedictorianClient
      try {
        workspaceClient = await workspaceClientResolver(decodeURIComponent(workspaceMatch[2]))
      } catch (error) {
        if (isLocalSecretResolvePath(requestUrl.pathname)) {
          writeNoStoreJson(response, 404, { message: 'Not found' })
          return
        }
        throw error
      }
      const originalUrl = request.url
      request.url = `/v${workspaceMatch[1]}${workspaceMatch[3]}${requestUrl.search}`

      try {
        const workspaceRoute = findWorkspaceRoute(
          new URL(request.url, 'http://127.0.0.1').pathname,
          request.method,
        )
        const admission = workspaceAuthorityAdmissionForClient(workspaceClient)
        const dispatch = () => handleRequest({
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
        if (
          admission?.mode === 'portable'
          && workspaceRoute
          && isMutationOperationClass(workspaceRoute.operationClass)
        ) {
          await admission.runWithContext({
            authorityEpoch: readAuthorityEpoch(request.headers['x-workspace-authority-epoch']),
            idempotencyKey: readHeader(request.headers['idempotency-key']),
            operation: workspaceRoute.operationId,
            requestFingerprint: readHeader(request.headers['x-request-fingerprint']),
            workspaceId: decodeURIComponent(workspaceMatch[2]),
          }, dispatch)
        } else {
          await dispatch()
        }
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

    if (
      workspaceScoped
      && !declaredWorkspaceRoute
    ) {
      if (isLocalSecretResolvePath(pathname)) {
        writeNoStoreJson(response, 404, { message: 'Not found' })
      } else {
        writeJson(response, 404, { message: 'Not found' })
      }
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/receipts/by-idempotency-key') {
      writeJson(
        response,
        409,
        createWorkspaceFailure(
          'capability_unsupported',
          'Durable receipt lookup is unavailable on this v1 local authority.',
        ),
      )
      return
    }

    if (await handleConnectorRoutes({ client, request, requestUrl, response })) {
      return
    }

    if (await handleLifecycleRoutes({ client, request, requestUrl, response })) {
      return
    }

    if (await handleCaptureResolutionRoutes({ client, request, requestUrl, response })) {
      return
    }

    if (await handleCompanyRoutes({ client, request, requestUrl, response })) {
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

    if (declaredWorkspaceRoute) {
      assertWorkspaceRouterCoverage(declaredWorkspaceRoute, false)
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
  return isDeclaredWorkspacePath(pathname)
}

export function isLocalSecretResolvePath(pathname: string) {
  return pathname === '/v1/secrets/local/resolve'
    || /^\/v1\/workspaces\/[^/]+\/secrets\/local\/resolve$/.test(pathname)
}

function isMutationOperationClass(operationClass: string): boolean {
  return operationClass === 'authoritative_execution'
    || operationClass === 'authoritative_mutation'
    || operationClass === 'secret_administration'
}

function readHeader(value: string | readonly string[] | undefined): string {
  return typeof value === 'string' ? value : value?.[0] ?? ''
}

function readAuthorityEpoch(value: string | readonly string[] | undefined): number {
  const epoch = Number(readHeader(value))
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : Number.NaN
}
