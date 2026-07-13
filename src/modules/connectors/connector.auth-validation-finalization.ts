import type { SourceExecutionScopeId } from 'sparxie'
import type { createSourceExecutionGovernor } from '../source-execution/source-execution-governor'
import type { AppConnectorAuthValidationResult } from './connector.runner'

export function finalizeReconnectValidation(input: {
  governor?: ReturnType<typeof createSourceExecutionGovernor>
  initialGeneration: number
  now: string
  refreshInvoked: boolean
  result: AppConnectorAuthValidationResult
  scopeId: SourceExecutionScopeId
  token?: string
}): AppConnectorAuthValidationResult {
  const { governor, result, scopeId } = input
  if (result.status === 'ready') {
    const scope = governor?.getScope(scopeId)
    const session = governor?.loadActiveSession(scopeId)
    const canonical = input.refreshInvoked && input.token !== undefined
      && scope?.status === 'available'
      && scope.authGeneration > input.initialGeneration
      && session?.authGeneration === scope.authGeneration
    if (canonical) return result
    if (input.token) governor?.finishReconnectValidation(scopeId, {
      now: input.now, reason: 'source_validation_unverified', status: 'action_required', token: input.token,
    })
    return {
      connectorInstanceId: result.connectorInstanceId,
      message: 'Connector credentials could not establish a canonical session.',
      reason: 'auth_validation_failed',
      status: 'failed',
    }
  }
  if (!governor || !input.token) return result
  if (result.status === 'rate_limited') {
    governor.cooldownRefresh(scopeId, { now: input.now, random: () => 1, token: input.token })
    return result
  }
  governor.finishReconnectValidation(scopeId, {
    now: input.now, reason: `source_validation_${result.status}`,
    status: 'action_required', token: input.token,
  })
  return result
}
