import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type {
  CompanyCommandFailure,
  LifecycleActor,
  WorkspaceCompany,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import {
  companyCapabilityState,
  companyCommandReceipts,
  companyHistory,
  workspaceCompanies,
} from './company.schema'
import { workspaces } from '../../db/workspaces.schema'
import {
  lifecycleFailure,
  selectCompany,
  staleCompanyFailure,
  toWorkspaceCompany,
  type CompanyRow,
} from './company.values'

export type CompanyTx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

export type CompanyOperation =
  | 'create'
  | 'update'
  | 'notes'
  | 'alias_add'
  | 'alias_update'
  | 'alias_remove'
  | 'archive'
  | 'restore'
  | 'reassign'
  | 'mark_distinct'
  | 'merge'

export class CompanyCommandConflictError extends Error {
  readonly statusCode = 409

  constructor() {
    super('The idempotency key is already used by another Company command.')
    this.name = 'CompanyCommandConflictError'
  }
}

export class CompanyAdmissionError extends Error {
  readonly statusCode = 400

  constructor(cause: unknown) {
    super('The Company command representation is invalid.', { cause })
    this.name = 'CompanyAdmissionError'
  }
}

/**
 * Relabels an SDK command schema failure as the established fixed HTTP 400, without server
 * coupling. It admits nothing itself: the supplied `parse` stays the sole structural admission.
 */
export function admitCompanyCommand<Command>(parse: () => Command): Command {
  try {
    return parse()
  } catch (error) {
    throw new CompanyAdmissionError(error)
  }
}

export function companyCommandFingerprint(input: unknown): string {
  return createHash('sha256').update(stableJson(input)).digest('hex')
}

export async function capabilityFailure(
  database: PgliteDatabase,
  workspaceId: string,
): Promise<CompanyCommandFailure | null> {
  const [state] = await database
    .select({
      status: companyCapabilityState.status,
      message: companyCapabilityState.message,
    })
    .from(companyCapabilityState)
    .where(eq(companyCapabilityState.workspaceId, workspaceId))
    .limit(1)
  if (state?.status === 'ready') return null
  return lifecycleFailure(
    'impossible_state',
    state?.status === 'blocked'
      ? state.message ?? 'Workspace Companies are unavailable.'
      : 'Workspace Companies are still being prepared.',
  )
}

export async function guardedCompany(
  tx: CompanyTx,
  input: {
    readonly workspaceId: string
    readonly companyId: WorkspaceCompany['id']
    readonly expectedCompanyRevision: number
  },
  boundWorkspaceId: string,
  allowMerged: boolean,
): Promise<{ row: CompanyRow } | { failure: CompanyCommandFailure }> {
  if (input.workspaceId !== boundWorkspaceId) {
    return {
      failure: lifecycleFailure(
        'workspace_ownership',
        'The Company does not belong to this workspace.',
      ),
    }
  }
  const row = await selectCompany(tx, boundWorkspaceId, input.companyId)
  if (!row) {
    return {
      failure: lifecycleFailure('invalid_input', 'The Company does not exist.'),
    }
  }
  if (row.revision !== input.expectedCompanyRevision) {
    return {
      failure: staleCompanyFailure(
        input.companyId,
        input.expectedCompanyRevision,
        row.revision,
      ),
    }
  }
  if (!allowMerged && row.status === 'merged') {
    return {
      failure: lifecycleFailure(
        'impossible_state',
        'Merged Companies have read-only identity fields.',
      ),
    }
  }
  return { row }
}

export async function updateCompanyHead(
  tx: CompanyTx,
  row: CompanyRow,
  values: Partial<Pick<
    CompanyRow,
    | 'displayName'
    | 'normalizedDisplayName'
    | 'websiteUrl'
    | 'websiteHost'
    | 'notes'
    | 'status'
    | 'mergedIntoCompanyId'
  >>,
  updatedAt: string,
): Promise<CompanyRow> {
  const [updated] = await tx
    .update(workspaceCompanies)
    .set({
      ...values,
      revision: row.revision + 1,
      updatedAt,
    })
    .where(and(
      eq(workspaceCompanies.workspaceId, row.workspaceId),
      eq(workspaceCompanies.id, row.id),
      eq(workspaceCompanies.revision, row.revision),
    ))
    .returning()
  if (!updated) throw new Error('Company revision changed during mutation.')
  return updated
}

export async function appendCompanyHistory(
  tx: CompanyTx,
  input: {
    readonly newId: () => string
    readonly row: CompanyRow
    readonly kind: string
    readonly changedFields: readonly string[]
    readonly actor: LifecycleActor
    readonly rationale: string
    readonly aliasId?: string | null
    readonly relatedCompanyId?: string | null
    readonly affectedJobIds?: readonly string[]
    readonly occurredAt: string
  },
) {
  await tx.insert(companyHistory).values({
    id: input.newId(),
    workspaceId: input.row.workspaceId,
    companyId: input.row.id,
    sequence: input.row.revision,
    companyRevision: input.row.revision,
    kind: input.kind,
    changedFieldsJson: JSON.stringify(input.changedFields),
    actorJson: JSON.stringify(input.actor),
    rationale: input.rationale,
    aliasId: input.aliasId ?? null,
    relatedCompanyId: input.relatedCompanyId ?? null,
    affectedJobIdsJson: JSON.stringify(input.affectedJobIds ?? []),
    createdAt: input.occurredAt,
  })
}

export async function runCompanyCommand<Result extends { status: string }>(
  database: PgliteDatabase,
  input: {
    readonly workspaceId: string
    readonly idempotencyKey: string
    readonly operation: CompanyOperation
    readonly requestFingerprint: string
    readonly now: () => string
  },
  execute: (tx: CompanyTx) => Promise<Result>,
): Promise<Result> {
  return database.transaction(async (tx) => {
    await lockCompanyWorkspace(tx, input.workspaceId)
    const [receipt] = await tx
      .select({
        operation: companyCommandReceipts.operation,
        requestFingerprint: companyCommandReceipts.requestFingerprint,
        resultJson: companyCommandReceipts.resultJson,
      })
      .from(companyCommandReceipts)
      .where(and(
        eq(companyCommandReceipts.workspaceId, input.workspaceId),
        eq(companyCommandReceipts.idempotencyKey, input.idempotencyKey),
      ))
      .limit(1)
    if (receipt) {
      if (
        receipt.operation !== input.operation
        || receipt.requestFingerprint !== input.requestFingerprint
      ) {
        throw new CompanyCommandConflictError()
      }
      return JSON.parse(receipt.resultJson) as Result
    }
    const result = await execute(tx)
    if (result.status !== 'blocked') {
      await tx.insert(companyCommandReceipts).values({
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
        operation: input.operation,
        requestFingerprint: input.requestFingerprint,
        resultJson: JSON.stringify(result),
        createdAt: input.now(),
      })
    }
    return result
  })
}

export async function lockCompanyWorkspace(
  exec: Pick<PgliteDatabase, 'select'>,
  workspaceId: string,
): Promise<void> {
  const [workspace] = await exec
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)
    .for('update')
  if (!workspace) throw new Error('Company workspace does not exist.')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function blockedMutation(
  input: {
    readonly workspaceId: string
    readonly companyId: WorkspaceCompany['id']
    readonly expectedCompanyRevision: number
    readonly idempotencyKey: string
  },
  failure: CompanyCommandFailure,
) {
  return {
    status: 'blocked' as const,
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    requestCompanyRevision: input.expectedCompanyRevision,
    idempotencyKey: input.idempotencyKey,
    failure,
  }
}

export async function successCompany(
  tx: CompanyTx,
  row: CompanyRow,
) {
  return toWorkspaceCompany(tx, row)
}
