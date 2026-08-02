import {
  WorkspaceAuthorityAdmissionController,
  workspaceRouteRegistry,
} from '@sparxie/valedictorian-workspace-server'
import type { LocalScheduledWorkSource } from '../modules/scheduling/public.js'
import type { LocalValedictorianClient } from './local-connector-client.contract.js'

const admittedOperationClasses = new Set([
  'authoritative_execution',
  'authoritative_mutation',
  'secret_administration',
])
const admittedOperations = new Set(
  workspaceRouteRegistry
    .filter((route) => admittedOperationClasses.has(route.operationClass))
    .map((route) => route.operationId),
)
const admissionByClient = new WeakMap<object, WorkspaceAuthorityAdmissionController>()

export function guardLocalValedictorianClient(
  client: LocalValedictorianClient,
  admission: WorkspaceAuthorityAdmissionController,
): LocalValedictorianClient {
  const proxy = createAdmissionProxy(
    client as object,
    admission,
    [],
  ) as LocalValedictorianClient
  admissionByClient.set(proxy, admission)
  return proxy
}

export function workspaceAuthorityAdmissionForClient(
  client: LocalValedictorianClient,
): WorkspaceAuthorityAdmissionController | undefined {
  return admissionByClient.get(client)
}

export function guardScheduledWorkSource(
  source: LocalScheduledWorkSource,
  admission: WorkspaceAuthorityAdmissionController,
): LocalScheduledWorkSource {
  return {
    ...source,
    async runDue(signal) {
      admission.admit(`scheduler.${source.id}.runDue`, {}, 'scheduler')
      await source.runDue(signal)
    },
  }
}

function createAdmissionProxy(
  target: object,
  admission: WorkspaceAuthorityAdmissionController,
  path: readonly string[],
): object {
  return new Proxy(target, {
    get(current, property, receiver) {
      const value = Reflect.get(current, property, receiver) as unknown
      if (typeof property !== 'string') return value
      const operationPath = [...path, property]
      if (typeof value === 'function') {
        const operation = operationPath.join('.')
        if (!admittedOperations.has(operation)) return value.bind(current)
        return (...args: unknown[]) => {
          try {
            admission.admit(operation, args[0], 'direct')
          } catch (error) {
            return Promise.reject(error)
          }
          return Reflect.apply(value, current, args)
        }
      }
      if (typeof value === 'object' && value !== null) {
        return createAdmissionProxy(value, admission, operationPath)
      }
      return value
    },
  })
}
