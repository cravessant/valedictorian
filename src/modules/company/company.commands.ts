import { and, eq, isNull, ne } from 'drizzle-orm'
import {
  addCompanyAliasInputSchema,
  archiveCompanyInputSchema,
  createCompanyInputSchema,
  removeCompanyAliasInputSchema,
  restoreCompanyInputSchema,
  updateCompanyAliasInputSchema,
  updateCompanyInputSchema,
  updateCompanyNotesInputSchema,
  type ArchiveCompanyResult,
  type CreateCompanyResult,
  type RestoreCompanyResult,
  type UpdateCompanyNotesResult,
  type UpdateCompanyResult,
  type WorkspaceCompany,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import { createUuidV7Generator, type Clock, type UuidV7Generator } from '../../db/uuidv7'
import { companyAliases, workspaceCompanies } from './company.schema'
import {
  appendCompanyHistory,
  blockedMutation,
  capabilityFailure,
  companyCommandFingerprint,
  guardedCompany,
  runCompanyCommand,
  successCompany,
  updateCompanyHead,
  type CompanyTx,
} from './company.command-support'
import {
  lifecycleFailure,
  normalizeCompanyText,
  websiteHost,
} from './company.values'
import { enqueueCompanyDuplicateReconsideration } from './company.duplicate-maintenance'

export interface CompanyCommands {
  create(input: unknown): Promise<CreateCompanyResult>
  update(input: unknown): Promise<UpdateCompanyResult>
  updateNotes(input: unknown): Promise<UpdateCompanyNotesResult>
  addAlias(input: unknown): Promise<UpdateCompanyResult>
  updateAlias(input: unknown): Promise<UpdateCompanyResult>
  removeAlias(input: unknown): Promise<UpdateCompanyResult>
  archive(input: unknown): Promise<ArchiveCompanyResult>
  restore(input: unknown): Promise<RestoreCompanyResult>
}

export interface CompanyCommandOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}

/**
 * Company-owned composable creation conversation for a larger lifecycle
 * transaction. The enclosing command owns idempotency; this writes only the
 * canonical Company and its required history in the supplied transaction.
 */
export async function createInlineCompanyOn(
  tx: CompanyTx,
  input: {
    readonly workspaceId: string
    readonly displayName: string
    readonly websiteUrl?: string
    readonly actor: Parameters<typeof appendCompanyHistory>[1]['actor']
    readonly rationale: string
    readonly now: string
    readonly newId: () => string
  },
) {
  const parsed = createCompanyInputSchema.parse({
    workspaceId: input.workspaceId,
    displayName: input.displayName,
    websiteUrl: input.websiteUrl ?? null,
    notes: null,
    actor: input.actor,
    rationale: input.rationale,
    // The outer lifecycle receipt owns deduplication. This value is validation-only.
    idempotencyKey: 'inline-company-assignment',
  })
  const id = input.newId()
  const [row] = await tx.insert(workspaceCompanies).values({
    id,
    workspaceId: parsed.workspaceId,
    displayName: parsed.displayName,
    normalizedDisplayName: normalizeCompanyText(parsed.displayName),
    websiteUrl: parsed.websiteUrl,
    websiteHost: websiteHost(parsed.websiteUrl),
    notes: null,
    revision: 1,
    status: 'active',
    mergedIntoCompanyId: null,
    createdAt: input.now,
    updatedAt: input.now,
  }).returning()
  if (!row) throw new Error('Company creation did not return a row.')
  await appendCompanyHistory(tx, {
    newId: input.newId,
    row,
    kind: 'created',
    changedFields: parsed.websiteUrl ? ['display_name', 'website_url'] : ['display_name'],
    actor: input.actor,
    rationale: input.rationale,
    occurredAt: input.now,
  })
  return row
}

export function createCompanyCommands(
  database: PgliteDatabase,
  workspaceId: string,
  options: CompanyCommandOptions = {},
): CompanyCommands {
  const clock = options.now ?? (() => new Date())
  const newId = options.newId ?? createUuidV7Generator(clock)
  const nowIso = () => clock().toISOString()

  async function create(input: unknown): Promise<CreateCompanyResult> {
    const parsed = createCompanyInputSchema.parse(input)
    if (parsed.workspaceId !== workspaceId) {
      return blockedCreate(parsed, lifecycleFailure(
        'workspace_ownership',
        'The Company cannot be created in another workspace.',
      ))
    }
    const unavailable = await capabilityFailure(database, workspaceId)
    if (unavailable) return blockedCreate(parsed, unavailable)
    return runCompanyCommand(database, {
      workspaceId,
      idempotencyKey: parsed.idempotencyKey,
      operation: 'create',
      requestFingerprint: companyCommandFingerprint(parsed),
      now: nowIso,
    }, async (tx) => {
      const timestamp = nowIso()
      const id = newId()
      const [row] = await tx.insert(workspaceCompanies).values({
        id,
        workspaceId,
        displayName: parsed.displayName,
        normalizedDisplayName: normalizeCompanyText(parsed.displayName),
        websiteUrl: parsed.websiteUrl,
        websiteHost: websiteHost(parsed.websiteUrl),
        notes: parsed.notes,
        revision: 1,
        status: 'active',
        mergedIntoCompanyId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).returning()
      if (!row) throw new Error('Company creation did not return a row.')
      const changedFields = ['display_name']
      if (parsed.websiteUrl !== null) changedFields.push('website_url')
      if (parsed.notes !== null) changedFields.push('notes')
      await appendCompanyHistory(tx, {
        newId,
        row,
        kind: 'created',
        changedFields,
        actor: parsed.actor,
        rationale: parsed.rationale,
        occurredAt: timestamp,
      })
      await enqueueCompanyDuplicateReconsideration(tx, row, timestamp)
      return {
        status: 'created',
        workspaceId,
        companyId: id as WorkspaceCompany['id'],
        requestCompanyRevision: null,
        idempotencyKey: parsed.idempotencyKey,
        company: await successCompany(tx, row),
      }
    })
  }

  async function update(input: unknown): Promise<UpdateCompanyResult> {
    const parsed = updateCompanyInputSchema.parse(input)
    const changedFields = [
      ...(parsed.displayName === undefined ? [] : ['display_name']),
      ...(parsed.websiteUrl === undefined ? [] : ['website_url']),
    ]
    return mutateCompany(database, workspaceId, parsed, {
      operation: 'update',
      allowMerged: false,
      newId,
      nowIso,
      kind: 'updated',
      changedFields,
      apply: (tx, row, timestamp) => updateCompanyHead(tx, row, {
        ...(parsed.displayName === undefined ? {} : {
          displayName: parsed.displayName,
          normalizedDisplayName: normalizeCompanyText(parsed.displayName),
        }),
        ...(parsed.websiteUrl === undefined ? {} : {
          websiteUrl: parsed.websiteUrl,
          websiteHost: websiteHost(parsed.websiteUrl),
        }),
      }, timestamp),
    })
  }

  async function updateNotes(input: unknown): Promise<UpdateCompanyNotesResult> {
    const parsed = updateCompanyNotesInputSchema.parse(input)
    return mutateCompany(database, workspaceId, parsed, {
      operation: 'notes',
      allowMerged: true,
      newId,
      nowIso,
      kind: 'updated',
      changedFields: ['notes'],
      apply: (tx, row, timestamp) =>
        updateCompanyHead(tx, row, { notes: parsed.notes }, timestamp),
    })
  }

  async function addAlias(input: unknown): Promise<UpdateCompanyResult> {
    const parsed = addCompanyAliasInputSchema.parse(input)
    return mutateAlias(database, workspaceId, parsed, {
      operation: 'alias_add',
      kind: 'alias_added',
      newId,
      nowIso,
      apply: async (tx, companyId, timestamp) => {
        const duplicate = await findAlias(
          tx,
          workspaceId,
          companyId,
          normalizeCompanyText(parsed.value),
        )
        if (duplicate) return { duplicate: true } as const
        const aliasId = newId()
        await tx.insert(companyAliases).values({
          id: aliasId,
          workspaceId,
          companyId,
          value: parsed.value,
          normalizedValue: normalizeCompanyText(parsed.value),
          createdAt: timestamp,
          updatedAt: timestamp,
          removedAt: null,
        })
        return { duplicate: false, aliasId } as const
      },
    })
  }

  async function updateAlias(input: unknown): Promise<UpdateCompanyResult> {
    const parsed = updateCompanyAliasInputSchema.parse(input)
    return mutateAlias(database, workspaceId, parsed, {
      operation: 'alias_update',
      kind: 'alias_updated',
      newId,
      nowIso,
      apply: async (tx, companyId, timestamp) => {
        const normalized = normalizeCompanyText(parsed.value)
        const duplicate = await findAlias(
          tx,
          workspaceId,
          companyId,
          normalized,
          parsed.aliasId,
        )
        if (duplicate) return { duplicate: true } as const
        const [alias] = await tx
          .update(companyAliases)
          .set({ value: parsed.value, normalizedValue: normalized, updatedAt: timestamp })
          .where(and(
            eq(companyAliases.workspaceId, workspaceId),
            eq(companyAliases.companyId, companyId),
            eq(companyAliases.id, parsed.aliasId),
            isNull(companyAliases.removedAt),
          ))
          .returning({ id: companyAliases.id })
        return alias
          ? { duplicate: false, aliasId: alias.id } as const
          : { duplicate: false, aliasId: null } as const
      },
    })
  }

  async function removeAlias(input: unknown): Promise<UpdateCompanyResult> {
    const parsed = removeCompanyAliasInputSchema.parse(input)
    return mutateAlias(database, workspaceId, parsed, {
      operation: 'alias_remove',
      kind: 'alias_removed',
      newId,
      nowIso,
      apply: async (tx, companyId, timestamp) => {
        const [alias] = await tx
          .update(companyAliases)
          .set({ removedAt: timestamp, updatedAt: timestamp })
          .where(and(
            eq(companyAliases.workspaceId, workspaceId),
            eq(companyAliases.companyId, companyId),
            eq(companyAliases.id, parsed.aliasId),
            isNull(companyAliases.removedAt),
          ))
          .returning({ id: companyAliases.id })
        return alias
          ? { duplicate: false, aliasId: alias.id } as const
          : { duplicate: false, aliasId: null } as const
      },
    })
  }

  async function archive(input: unknown): Promise<ArchiveCompanyResult> {
    const parsed = archiveCompanyInputSchema.parse(input)
    return mutateCompany(database, workspaceId, parsed, {
      operation: 'archive',
      allowMerged: false,
      requiredStatus: 'active',
      newId,
      nowIso,
      kind: 'archived',
      changedFields: ['status'],
      apply: (tx, row, timestamp) =>
        updateCompanyHead(tx, row, { status: 'archived' }, timestamp),
    })
  }

  async function restore(input: unknown): Promise<RestoreCompanyResult> {
    const parsed = restoreCompanyInputSchema.parse(input)
    return mutateCompany(database, workspaceId, parsed, {
      operation: 'restore',
      allowMerged: false,
      requiredStatus: 'archived',
      newId,
      nowIso,
      kind: 'restored',
      changedFields: ['status'],
      apply: (tx, row, timestamp) =>
        updateCompanyHead(tx, row, { status: 'active' }, timestamp),
    })
  }

  return {
    addAlias,
    archive,
    create,
    removeAlias,
    restore,
    update,
    updateAlias,
    updateNotes,
  }
}

type RevisionInput = {
  readonly workspaceId: string
  readonly companyId: WorkspaceCompany['id']
  readonly expectedCompanyRevision: number
  readonly idempotencyKey: string
  readonly actor: Parameters<typeof appendCompanyHistory>[1]['actor']
  readonly rationale: string
}

async function mutateCompany<Result extends UpdateCompanyResult | ArchiveCompanyResult | RestoreCompanyResult>(
  database: PgliteDatabase,
  workspaceId: string,
  input: RevisionInput,
  options: {
    readonly operation: 'update' | 'notes' | 'archive' | 'restore'
    readonly allowMerged: boolean
    readonly requiredStatus?: 'active' | 'archived'
    readonly newId: () => string
    readonly nowIso: () => string
    readonly kind: 'updated' | 'archived' | 'restored'
    readonly changedFields: readonly string[]
    readonly apply: (
      tx: CompanyTx,
      row: typeof workspaceCompanies.$inferSelect,
      timestamp: string,
    ) => Promise<typeof workspaceCompanies.$inferSelect>
  },
): Promise<Result> {
  const unavailable = await capabilityFailure(database, workspaceId)
  if (unavailable) return blockedMutation(input, unavailable) as Result
  return runCompanyCommand(database, {
    workspaceId,
    idempotencyKey: input.idempotencyKey,
    operation: options.operation,
    requestFingerprint: companyCommandFingerprint(input),
    now: options.nowIso,
  }, async (tx) => {
    const guarded = await guardedCompany(
      tx,
      input,
      workspaceId,
      options.allowMerged,
    )
    if ('failure' in guarded) return blockedMutation(input, guarded.failure) as Result
    if (options.requiredStatus && guarded.row.status !== options.requiredStatus) {
      return blockedMutation(input, lifecycleFailure(
        'impossible_state',
        `Company must be ${options.requiredStatus} for this action.`,
      )) as Result
    }
    const timestamp = options.nowIso()
    const row = await options.apply(tx, guarded.row, timestamp)
    await appendCompanyHistory(tx, {
      newId: options.newId,
      row,
      kind: options.kind,
      changedFields: options.changedFields,
      actor: input.actor,
      rationale: input.rationale,
      occurredAt: timestamp,
    })
    await enqueueCompanyDuplicateReconsideration(tx, row, timestamp)
    return {
      status: options.kind === 'archived'
        ? 'archived'
        : options.kind === 'restored' ? 'restored' : 'updated',
      workspaceId,
      companyId: input.companyId,
      requestCompanyRevision: input.expectedCompanyRevision,
      idempotencyKey: input.idempotencyKey,
      company: await successCompany(tx, row),
    } as Result
  })
}

async function mutateAlias(
  database: PgliteDatabase,
  workspaceId: string,
  input: RevisionInput,
  options: {
    readonly operation: 'alias_add' | 'alias_update' | 'alias_remove'
    readonly kind: 'alias_added' | 'alias_updated' | 'alias_removed'
    readonly newId: () => string
    readonly nowIso: () => string
    readonly apply: (
      tx: CompanyTx,
      companyId: string,
      timestamp: string,
    ) => Promise<{ duplicate: boolean; aliasId?: string | null }>
  },
): Promise<UpdateCompanyResult> {
  const unavailable = await capabilityFailure(database, workspaceId)
  if (unavailable) return blockedMutation(input, unavailable)
  return runCompanyCommand(database, {
    workspaceId,
    idempotencyKey: input.idempotencyKey,
    operation: options.operation,
    requestFingerprint: companyCommandFingerprint(input),
    now: options.nowIso,
  }, async (tx) => {
    const guarded = await guardedCompany(tx, input, workspaceId, false)
    if ('failure' in guarded) return blockedMutation(input, guarded.failure)
    const timestamp = options.nowIso()
    const alias = await options.apply(tx, guarded.row.id, timestamp)
    if (alias.duplicate) {
      return blockedMutation(input, lifecycleFailure(
        'invalid_input',
        'That alias already exists on this Company.',
      ))
    }
    if (!alias.aliasId) {
      return blockedMutation(input, lifecycleFailure(
        'invalid_input',
        'The Company alias does not exist.',
      ))
    }
    const row = await updateCompanyHead(tx, guarded.row, {}, timestamp)
    await appendCompanyHistory(tx, {
      newId: options.newId,
      row,
      kind: options.kind,
      changedFields: ['aliases'],
      actor: input.actor,
      rationale: input.rationale,
      aliasId: alias.aliasId,
      occurredAt: timestamp,
    })
    await enqueueCompanyDuplicateReconsideration(tx, row, timestamp)
    return {
      status: 'updated',
      workspaceId,
      companyId: input.companyId,
      requestCompanyRevision: input.expectedCompanyRevision,
      idempotencyKey: input.idempotencyKey,
      company: await successCompany(tx, row),
    }
  })
}

async function findAlias(
  tx: CompanyTx,
  workspaceId: string,
  companyId: string,
  normalizedValue: string,
  exceptAliasId?: string,
) {
  const [row] = await tx
    .select({ id: companyAliases.id })
    .from(companyAliases)
    .where(and(
      eq(companyAliases.workspaceId, workspaceId),
      eq(companyAliases.companyId, companyId),
      eq(companyAliases.normalizedValue, normalizedValue),
      isNull(companyAliases.removedAt),
      ...(exceptAliasId ? [ne(companyAliases.id, exceptAliasId)] : []),
    ))
    .limit(1)
  return row ?? null
}

function blockedCreate(
  input: ReturnType<typeof createCompanyInputSchema.parse>,
  failure: ReturnType<typeof lifecycleFailure>,
): CreateCompanyResult {
  return {
    status: 'blocked',
    workspaceId: input.workspaceId,
    idempotencyKey: input.idempotencyKey,
    failure: {
      kind: 'lifecycle_failure',
      blocker: failure.kind === 'lifecycle_failure'
        ? failure.blocker
        : { code: 'impossible_state', message: failure.blocker.message },
    },
  }
}
