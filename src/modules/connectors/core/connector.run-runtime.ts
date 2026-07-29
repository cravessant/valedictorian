import type {
  ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorProgressRuntime,
} from '@sparxie/valedictorian-connectors-core'
import type { SourceExecutionScopeId } from '@sparxie/sdk'
import type {
  AppConnectorAuthGrant,
  AppConnectorAuthHost,
  AppConnectorAuthRequirement,
  AppConnectorAuthResolveInput,
  AppConnectorRuntime,
  AppConnectorRuntimePorts,
} from '../ports/connector.runner-contracts'
import type { ConnectorSourceSession } from '../ports/connector.source-execution.port'

const REDACTED_SECRET_VALUE = '[redacted-secret]'

export function createRunRuntime(
  runtime: AppConnectorRuntimePorts,
  authReferences: ConnectorAuthReference[],
  authRequirements: ConnectorAuthRequirement[],
  authHost: AppConnectorAuthHost | undefined,
  sensitiveValues: Set<string>,
  executionScopeId: SourceExecutionScopeId,
  sessionExecutor: ConnectorSourceSession | null,
  allowActionRequiredRefresh: boolean,
  progress: ConnectorProgressRuntime | undefined,
  dataRuntime?: Pick<AppConnectorRuntime, 'captureIntake'>,
  reconnectToken?: string,
  onReconnectRefresh?: () => void,
): AppConnectorRuntime {
  const grants = new Map<string, Promise<AppConnectorAuthGrant>>()
  let establishing = 0
  return {
    ...runtime,
    ...dataRuntime,
    ...(progress ? { progress } : {}),
    auth: {
      async resolve(input) {
        if (establishing === 0 && sessionExecutor) {
          const session = await sessionExecutor.resolve(executionScopeId)
          if (session.status === 'ready') {
            const reference = authReferences.find((candidate) => candidate.id === input.id)
            return { id: input.id, mode: input.mode ?? reference?.mode ?? 'none', status: 'ready', sessionId: session.sessionId }
          }
        }
        const cacheKey = `${input.id}\u0000${input.mode ?? ''}`
        const cached = grants.get(cacheKey)
        if (cached) {
          return await cached
        }
        const grant = resolveAuthGrant(
          input,
          authReferences,
          authRequirements,
          authHost,
          sensitiveValues,
        )
        grants.set(cacheKey, grant)
        try {
          const resolved = await grant
          return resolved
        } catch (error) {
          grants.delete(cacheKey)
          throw error
        }
      },
      async refresh(input, establish) {
        if (input.executionScopeId !== executionScopeId) {
          return { status: 'failed', reason: 'source_execution_scope_mismatch' }
        }
        if (!sessionExecutor) return { status: 'failed', reason: 'source_session_host_unavailable' }
        const establishSession = async () => {
          establishing += 1
          grants.clear()
          try { return await establish() } finally { establishing -= 1; grants.clear() }
        }
        return reconnectToken
          ? (onReconnectRefresh?.(), sessionExecutor.reconnect(executionScopeId, establishSession, reconnectToken))
          : sessionExecutor.refresh(executionScopeId, establishSession, { allowActionRequired: allowActionRequiredRefresh })
      },
    },
  }
}

async function resolveAuthGrant(
  input: AppConnectorAuthResolveInput,
  authReferences: ConnectorAuthReference[],
  authRequirements: AppConnectorAuthRequirement[],
  authHost: AppConnectorAuthHost | undefined,
  sensitiveValues: Set<string>,
): Promise<AppConnectorAuthGrant> {
  const reference = authReferences.find(
    (authReference) =>
      authReference.id === input.id &&
      (input.mode === undefined || authReference.mode === input.mode),
  )
  const requirement = authRequirements.find(
    (authRequirement) =>
      authRequirement.id === input.id &&
      (input.mode === undefined || authRequirement.mode === input.mode),
  )
  const mode = input.mode ?? reference?.mode ?? requirement?.mode
  if (mode === 'none') {
    return {
      id: input.id,
      mode,
      status: 'ready',
    }
  }
  if (!reference) {
    return {
      id: input.id,
      mode: mode ?? 'none',
      reason: 'auth_reference_missing',
      status: 'missing',
    }
  }
  return resolveSecretGrant(reference, authHost, sensitiveValues)
}

async function resolveSecretGrant(
  reference: ConnectorAuthReference,
  authHost: AppConnectorAuthHost | undefined,
  sensitiveValues: Set<string>,
): Promise<AppConnectorAuthGrant> {
  if (!reference.secretKey) {
    return {
      id: reference.id,
      mode: reference.mode,
      reason: 'secret_reference_missing',
      status: 'missing',
    }
  }
  const secret = await authHost?.secrets?.revealSecret(reference.secretKey)
  if (!secret) {
    return {
      id: reference.id,
      mode: reference.mode,
      reason: 'secret_missing',
      secretKey: reference.secretKey,
      status: 'missing',
    }
  }
  if (secret.value.length > 0) {
    sensitiveValues.add(secret.value)
  }
  return {
    id: reference.id,
    mode: reference.mode,
    secretKey: reference.secretKey,
    status: 'ready',
    value: secret.value,
  }
}

export function redactSensitiveValue(value: unknown, sensitiveValues: Set<string>, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === 'string') return redactSensitiveString(value, sensitiveValues)
  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value)
    seen.set(value, null)
    const redacted = value.map((item) => redactSensitiveValue(item, sensitiveValues, seen))
    seen.set(value, redacted)
    return redacted
  }
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  seen.set(value, null)
  const redacted = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSensitiveValue(item, sensitiveValues, seen)]))
  seen.set(value, redacted)
  return redacted
}

export function redactSensitiveString(value: string, sensitiveValues: Set<string>): string {
  let next = value
  const sortedSensitiveValues = [...sensitiveValues].sort(
    (left, right) => right.length - left.length,
  )
  for (const sensitiveValue of sortedSensitiveValues) {
    next = next.split(sensitiveValue).join(REDACTED_SECRET_VALUE)
  }
  return next
}
