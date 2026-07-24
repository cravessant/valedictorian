import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  jobFactsSchema,
  type CompanyCommandFailure,
  type LifecycleActor,
  type WorkspaceCompany,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import { companyAliases, workspaceCompanies } from './company.schema'

export type CompanyRow = typeof workspaceCompanies.$inferSelect
export type CompanyExec = Pick<PgliteDatabase, 'select'>

export class CompanyNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('The requested Company was not found.')
    this.name = 'CompanyNotFoundError'
  }
}

export function normalizeCompanyText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function websiteHost(value: string | null): string | null {
  return value ? new URL(value).hostname.toLocaleLowerCase('en-US') : null
}

export function serializeActor(actor: LifecycleActor): string {
  return JSON.stringify(actor)
}

export function parseActor(value: string): LifecycleActor {
  return JSON.parse(value) as LifecycleActor
}

export function roleAndAssertedCompany(factsJson: string) {
  let value: unknown
  try {
    value = JSON.parse(factsJson) as unknown
  } catch {
    return { companyName: 'Unknown company', roleTitle: 'Unknown role' }
  }
  const parsed = jobFactsSchema.safeParse(value)
  if (parsed.success) {
    return {
      companyName: parsed.data.companyName,
      roleTitle: parsed.data.roleTitle,
    }
  }
  const facts = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  return {
    companyName: boundedFact(facts.companyName, 'Unknown company'),
    roleTitle: boundedFact(facts.roleTitle, 'Unknown role'),
  }
}

function boundedFact(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 500)
    : fallback
}

export async function selectCompany(
  exec: CompanyExec,
  workspaceId: string,
  companyId: string,
): Promise<CompanyRow | null> {
  const [row] = await exec
    .select()
    .from(workspaceCompanies)
    .where(and(
      eq(workspaceCompanies.workspaceId, workspaceId),
      eq(workspaceCompanies.id, companyId),
    ))
    .limit(1)
  return row ?? null
}

export async function toWorkspaceCompany(
  exec: CompanyExec,
  row: CompanyRow,
): Promise<WorkspaceCompany> {
  const aliases = await exec
    .select({ id: companyAliases.id, value: companyAliases.value })
    .from(companyAliases)
    .where(and(
      eq(companyAliases.workspaceId, row.workspaceId),
      eq(companyAliases.companyId, row.id),
      isNull(companyAliases.removedAt),
    ))
    .orderBy(asc(companyAliases.normalizedValue), asc(companyAliases.id))
  return {
    id: row.id as WorkspaceCompany['id'],
    workspaceId: row.workspaceId,
    displayName: row.displayName,
    aliases,
    websiteUrl: row.websiteUrl,
    notes: row.notes,
    revision: row.revision,
    status: row.status as WorkspaceCompany['status'],
    mergedIntoCompanyId: row.mergedIntoCompanyId as WorkspaceCompany['mergedIntoCompanyId'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function staleCompanyFailure(
  companyId: WorkspaceCompany['id'],
  expectedRevision: number,
  currentRevision: number,
): CompanyCommandFailure {
  return {
    kind: 'stale_guard',
    blocker: {
      code: 'impossible_state',
      message: 'The Company changed. Refresh and submit the change again.',
    },
    recovery: {
      action: 'refresh_and_resubmit',
      guards: [{
        kind: 'company_revision',
        companyId,
        expectedRevision,
        currentRevision,
      }],
    },
  }
}

export function lifecycleFailure(
  code: 'impossible_state' | 'workspace_ownership' | 'invalid_input' | 'missing_lineage',
  message: string,
): CompanyCommandFailure {
  return {
    kind: 'lifecycle_failure',
    blocker: { code, message },
  }
}

type CursorValue = {
  readonly primary: string
  readonly id: string
}

export function encodeCompanyCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function decodeCompanyCursor(value: string): CursorValue {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (
      !parsed
      || typeof parsed !== 'object'
      || typeof (parsed as CursorValue).primary !== 'string'
      || typeof (parsed as CursorValue).id !== 'string'
    ) {
      throw new Error('invalid cursor')
    }
    return parsed as CursorValue
  } catch (error) {
    throw Object.assign(new Error('Invalid Company cursor.'), {
      cause: error,
      code: 'invalid_company_cursor',
      statusCode: 400,
    })
  }
}
