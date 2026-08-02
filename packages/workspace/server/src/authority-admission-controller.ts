import { AsyncLocalStorage } from 'node:async_hooks'
import {
  admitPortableMutation,
  type PortableMutationContext,
  type WorkspaceAdmissionState,
  type WorkspaceReplicaState,
  WorkspaceProtocolError,
} from './authority-protocol.js'

export type WorkspaceAdmissionMode = 'local-v1' | 'portable'
export type WorkspaceAdmissionChannel = 'direct' | 'http' | 'internal' | 'scheduler'

export class WorkspaceAuthorityAdmissionController {
  readonly mode: WorkspaceAdmissionMode
  #state: WorkspaceAdmissionState
  readonly #context = new AsyncLocalStorage<PortableMutationContext>()

  constructor(options: {
    authorityEpoch?: number
    authorityId?: string
    mode?: WorkspaceAdmissionMode
    replicaState?: WorkspaceReplicaState
    workspaceId: string
  }) {
    this.mode = options.mode ?? 'local-v1'
    this.#state = Object.freeze({
      authorityEpoch: options.authorityEpoch ?? 0,
      authorityId: options.authorityId ?? `local:${options.workspaceId}`,
      replicaState: options.replicaState ?? 'active',
      workspaceId: options.workspaceId,
    })
  }

  get state(): WorkspaceAdmissionState {
    return this.#state
  }

  updateState(update: Partial<Pick<WorkspaceAdmissionState, 'authorityEpoch' | 'authorityId' | 'replicaState'>>): void {
    this.#state = Object.freeze({ ...this.#state, ...update })
  }

  runWithContext<Result>(
    context: PortableMutationContext,
    task: () => Result,
  ): Result {
    return this.#context.run(context, task)
  }

  admit(
    operation: string,
    input: unknown,
    _channel: WorkspaceAdmissionChannel,
  ): PortableMutationContext {
    const inherited = this.#context.getStore()
    const context = inherited ?? (
      this.mode === 'local-v1'
        ? this.#localContext(operation, input)
        : this.#portableInputContext(operation, input)
    )
    if (
      this.mode === 'portable'
      && (
        !context.idempotencyKey.trim()
        || !context.requestFingerprint.trim()
        || !Number.isSafeInteger(context.authorityEpoch)
      )
    ) {
      throw new WorkspaceProtocolError(
        'authentication_required',
        'Portable mutation admission metadata is required.',
      )
    }
    if (context.operation !== operation) {
      throw new WorkspaceProtocolError(
        'idempotency_conflict',
        'Mutation admission operation does not match the dispatched operation.',
      )
    }
    admitPortableMutation(this.#state, context)
    return context
  }

  #localContext(operation: string, input: unknown): PortableMutationContext {
    const record = typeof input === 'object' && input !== null
      ? input as Record<string, unknown>
      : {}
    return {
      authorityEpoch: this.#state.authorityEpoch,
      idempotencyKey: typeof record.idempotencyKey === 'string'
        ? record.idempotencyKey
        : `local-v1:${operation}`,
      operation,
      requestFingerprint: `local-v1:${operation}:${stableFingerprint(record)}`,
      workspaceId: this.#state.workspaceId,
    }
  }

  #portableInputContext(operation: string, input: unknown): PortableMutationContext {
    const record = typeof input === 'object' && input !== null
      ? input as Record<string, unknown>
      : {}
    return {
      authorityEpoch: typeof record.authorityEpoch === 'number'
        ? record.authorityEpoch
        : Number.NaN,
      idempotencyKey: typeof record.idempotencyKey === 'string' ? record.idempotencyKey : '',
      operation,
      requestFingerprint: typeof record.requestFingerprint === 'string'
        ? record.requestFingerprint
        : '',
      workspaceId: typeof record.workspaceId === 'string'
        ? record.workspaceId
        : this.#state.workspaceId,
    }
  }
}

function stableFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableFingerprint).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableFingerprint(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}
