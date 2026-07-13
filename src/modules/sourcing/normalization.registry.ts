import crypto from 'node:crypto'
import {
  canonicalCandidateFields,
  normalizeApplicationUrlPreservingQuery,
  resolverCapabilities,
  resolverCostClasses,
  type CanonicalCandidateField,
  type FieldResolutionOutcome,
  type JsonValue,
  type RawSourceRevision,
  type ResolverCapability,
  type ResolverDeclaration,
} from 'sparxie'
import { classifyDeterministicDestination, DESTINATION_TAXONOMY_VERSION } from './destination-classifier'

export const RESOLVER_VERSION = '1.0.0'
export const RESOLVER_SUPPRESSION_POLICY_VERSION = 'resolver-precedence/v1'

export function isDeterministicCanonicalCompensation(value: JsonValue) {
  if (value === null) return true
  if (!isJsonObject(value) || !hasOnlyKeys(value, ['minimum','maximum','currency','interval','raw'])) return false
  const minimum = value.minimum
  const maximum = value.maximum
  const validAmount = (amount: JsonValue | undefined) => amount === null || (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)
  if (!validAmount(minimum) || !validAmount(maximum)) return false
  if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) return false
  if (value.currency !== null && (typeof value.currency !== 'string' || !value.currency.trim() || value.currency !== value.currency.trim() || value.currency !== value.currency.toUpperCase())) return false
  if (typeof value.interval !== 'string' || !['hour','day','week','month','year','one_time','unknown'].includes(value.interval)) return false
  if (value.raw !== null && (typeof value.raw !== 'string' || !value.raw.trim() || value.raw !== value.raw.trim())) return false
  return true
}

export function isDeterministicCanonicalPostedAt(value: JsonValue) {
  if (!isJsonObject(value) || !hasOnlyKeys(value, ['value','precision','raw'])) return false
  if (value.raw !== null && typeof value.raw !== 'string') return false
  if (value.precision === 'unknown') return value.value === null
  if (value.precision === 'relative') return value.value === null && typeof value.raw === 'string' && Boolean(value.raw.trim())
  if (value.precision === 'date') return typeof value.value === 'string' && isCalendarDate(value.value)
  if (value.precision === 'instant') return typeof value.value === 'string' && isExplicitTimezoneInstant(value.value)
  return false
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: { [key: string]: JsonValue }, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

export interface NormalizationResolverContext {
  readonly rawRevision: RawSourceRevision
  readonly sourceEntity: Readonly<{ id: string; identityKind: string; identityNamespace: string; identityValue: string }> | null
  readonly enabledCapabilities: readonly ResolverCapability[]
  hashInput(value: JsonValue): string
}

export interface NormalizationResolver {
  readonly declaration: ResolverDeclaration
  resolve(context: NormalizationResolverContext): FieldResolutionOutcome[] | Promise<FieldResolutionOutcome[]>
}

export interface NormalizationResolverRegistry {
  readonly resolvers: readonly NormalizationResolver[]
  readonly resolverSetHash: string
}

export function createNormalizationResolverRegistry(resolvers: readonly NormalizationResolver[]): NormalizationResolverRegistry {
  const identities = new Set<string>()
  for (const resolver of resolvers) {
    validateDeclaration(resolver.declaration)
    const identity = `${resolver.declaration.id}@${resolver.declaration.version}`
    if (identities.has(identity)) throw new Error(`Duplicate normalization resolver: ${identity}`)
    identities.add(identity)
  }
  const ordered = [...resolvers].sort((left, right) =>
    right.declaration.precedence - left.declaration.precedence ||
    compareCodePoints(left.declaration.id, right.declaration.id) ||
    compareCodePoints(left.declaration.version, right.declaration.version),
  )
  return Object.freeze({
    resolvers: Object.freeze(ordered),
    resolverSetHash: hashJson(ordered.map(({ declaration }) => declaration)),
  })
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function createDefaultNormalizationResolverRegistry() {
  return createNormalizationResolverRegistry([
    resolver('deterministic.provider-identity', ['canonicalIdentity', 'providerJobId'], 100, resolveIdentity),
    resolver('deterministic.explicit-company', ['companyName'], 90, (context) => resolveAliases(context, 'companyName', ['companyName', 'company'])),
    resolver('deterministic.explicit-title', ['roleTitle'], 90, (context) => resolveAliases(context, 'roleTitle', ['roleTitle', 'jobTitle', 'title', 'role'])),
    resolver('deterministic.explicit-facts', ['employmentType', 'seniority', 'workMode', 'location', 'compensation', 'postedAt'], 80, resolveFacts),
    resolver('deterministic.explicit-urls', ['destinationUrl', 'sourceUrl'], 70, resolveUrls),
  ])
}

function resolver(
  id: string,
  outputFields: CanonicalCandidateField[],
  precedence: number,
  resolve: NormalizationResolver['resolve'],
): NormalizationResolver {
  return { declaration: { id, version: RESOLVER_VERSION, requiredInputs: ['rawRevision'], outputFields, capabilities: ['pure'], costClass: 'none', precedence, scopeRequirement: 'none' }, resolve }
}

function validateDeclaration(declaration: ResolverDeclaration) {
  if (!declaration.id.trim() || !declaration.version.trim()) throw new Error('Resolver id and version are required')
  if (!Number.isFinite(declaration.precedence) || !resolverCostClasses.includes(declaration.costClass)) throw new Error(`Invalid resolver declaration: ${declaration.id}`)
  if (new Set(declaration.outputFields).size !== declaration.outputFields.length || declaration.outputFields.some((field) => !canonicalCandidateFields.includes(field))) throw new Error(`Invalid resolver output fields: ${declaration.id}`)
  if (declaration.capabilities.length === 0 || declaration.capabilities.some((capability) => !resolverCapabilities.includes(capability))) throw new Error(`Invalid resolver capabilities: ${declaration.id}`)
}

function resolveIdentity(context: NormalizationResolverContext) {
  const inputHash = context.hashInput({ providerRecordId: context.rawRevision.providerRecordId, sourceEntityId: context.sourceEntity?.id ?? null })
  if (!context.sourceEntity || context.sourceEntity.identityKind !== 'provider_job') {
    return ['canonicalIdentity', 'providerJobId'].map((field) => abstained(context, field as CanonicalCandidateField, inputHash, 'No persisted provider identity'))
  }
  const value = JSON.stringify([context.sourceEntity.identityNamespace, context.sourceEntity.identityValue])
  return [
    resolved(context, 'canonicalIdentity', inputHash, { kind: 'provider_job', value }, '$sourceEntity', true),
    resolved(context, 'providerJobId', inputHash, context.sourceEntity.identityValue, '$providerRecordId', true, context.rawRevision.providerRecordId),
  ]
}

function resolveAliases(context: NormalizationResolverContext, field: CanonicalCandidateField, paths: string[]) {
  const payload = context.rawRevision.payload ?? {}
  const values = paths.flatMap((path) => typeof payload[path] === 'string' && payload[path].trim() ? [{ path, value: payload[path].trim() }] : [])
  const distinct = [...new Set(values.map(({ value }) => value))]
  const inputHash = context.hashInput(Object.fromEntries(paths.map((path) => [path, payload[path] ?? null])))
  if (distinct.length === 0) return [abstained(context, field, inputHash, 'No nonblank explicit value')]
  if (distinct.length > 1) return [{ ...base(context, field, inputHash), status: 'conflict' as const, reason: 'Distinct explicit aliases conflict', values: distinct }]
  return [resolved(context, field, inputHash, distinct[0], values[0].path, true)]
}

function resolveFacts(context: NormalizationResolverContext): FieldResolutionOutcome[] {
  const payload = context.rawRevision.payload ?? {}
  const outcomes: FieldResolutionOutcome[] = []
  const enums = {
    employmentType: mapEnum(payload.employmentType, ['full_time','part_time','contract','temporary','internship','apprenticeship','other','unknown'], { ft: 'full_time', full_time: 'full_time', 'full-time': 'full_time', 'full time': 'full_time' }, 'unknown'),
    seniority: mapEnum(payload.seniority, ['internship','entry_level','associate','mid_level','senior','staff','principal','manager','director','executive','unknown'], {}, 'unknown'),
    workMode: mapEnum(payload.workMode, ['remote','hybrid','onsite','unclear'], { 'on-site': 'onsite', 'on site': 'onsite' }, 'unclear'),
  } as const
  for (const [field, value] of Object.entries(enums) as Array<[CanonicalCandidateField, JsonValue]>) outcomes.push(resolved(context, field, context.hashInput((payload[field] ?? null) as JsonValue), value, field, false, (payload[field] ?? null) as JsonValue))
  outcomes.push(resolved(context, 'location', context.hashInput((payload.location ?? null) as JsonValue), normalizeLocation(payload.location), 'location', false, (payload.location ?? null) as JsonValue))
  outcomes.push(resolved(context, 'compensation', context.hashInput((payload.compensation ?? null) as JsonValue), normalizeCompensation(payload.compensation), 'compensation', false, (payload.compensation ?? null) as JsonValue))
  outcomes.push(resolved(context, 'postedAt', context.hashInput((payload.postedAt ?? null) as JsonValue), normalizePostedAt(payload.postedAt), 'postedAt', false, (payload.postedAt ?? null) as JsonValue))
  return outcomes
}

function resolveUrls(context: NormalizationResolverContext): FieldResolutionOutcome[] {
  const payload = context.rawRevision.payload ?? {}
  const sourceHash = context.hashInput((payload.sourceUrl ?? null) as JsonValue)
  const outcomes: FieldResolutionOutcome[] = []
  if (typeof payload.sourceUrl === 'string') {
    try {
      outcomes.push(resolved(context, 'sourceUrl', sourceHash, normalizeApplicationUrlPreservingQuery(payload.sourceUrl), 'sourceUrl'))
    } catch { outcomes.push(abstained(context, 'sourceUrl', sourceHash, 'Malformed source URL')) }
  } else outcomes.push(abstained(context, 'sourceUrl', sourceHash, 'No explicit source URL'))

  const paths = ['destinationUrl', 'applicationUrl', 'officialUrl', 'url', 'href']
  const candidates = paths.flatMap((path) => typeof payload[path] === 'string' ? [{ path, classified: classifyDeterministicDestination(payload[path]) }] : []).filter((item) => item.classified)
  const distinct = [...new Map(candidates.map((item) => [item.classified!.url, item])).values()]
  const inputHash = context.hashInput(Object.fromEntries(paths.map((path) => [path, payload[path] ?? null])))
  if (distinct.length === 0) outcomes.push(abstained(context, 'destinationUrl', inputHash, `No usable destination (${DESTINATION_TAXONOMY_VERSION})`))
  else if (distinct.length > 1) outcomes.push({ ...base(context, 'destinationUrl', inputHash), status: 'conflict', reason: 'Distinct destination candidates conflict', values: distinct.map(({ classified }) => classified! as unknown as JsonValue) })
  else outcomes.push(resolved(context, 'destinationUrl', inputHash, distinct[0].classified! as unknown as JsonValue, distinct[0].path, true))
  return outcomes
}

function mapEnum(value: JsonValue | undefined, canonical: readonly string[], aliases: Record<string,string>, fallback: string) { if (typeof value !== 'string') return fallback; const normalized = value.trim().toLowerCase(); return canonical.includes(normalized) ? normalized : aliases[normalized] ?? fallback }
function normalizeLocation(value: JsonValue | undefined): JsonValue { if (typeof value === 'string') return { raw: value.trim() || null, city: null, region: null, country: null }; if (!value || Array.isArray(value) || typeof value !== 'object') return null; const item = value as Record<string, JsonValue>; for (const key of ['raw','city','region','country']) if (item[key] !== null && item[key] !== undefined && typeof item[key] !== 'string') return null; return { raw: item.raw ?? null, city: item.city ?? null, region: item.region ?? null, country: item.country ?? null } }
function normalizeCompensation(value: JsonValue | undefined): JsonValue {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null
  const item = value as Record<string, JsonValue>
  const interval = typeof item.interval === 'string' && ['hour','day','week','month','year','one_time','unknown'].includes(item.interval)
    ? item.interval
    : null
  const minimum = normalizeAmount(item.minimum)
  const maximum = normalizeAmount(item.maximum)
  if (!interval || minimum === undefined || maximum === undefined) return null
  if (minimum !== null && maximum !== null && minimum > maximum) return null
  let currency: string | null
  if (item.currency === null || item.currency === undefined) currency = null
  else if (typeof item.currency === 'string' && item.currency.trim()) currency = item.currency.trim().toUpperCase()
  else return null
  if (item.raw !== null && item.raw !== undefined && typeof item.raw !== 'string') return null
  const raw = typeof item.raw === 'string' && item.raw.trim() ? item.raw.trim() : null
  if (minimum === null && maximum === null && raw === null) return null
  return { minimum, maximum, currency, interval, raw }
}
function normalizeAmount(value: JsonValue | undefined) {
  if (value === null || value === undefined) return null
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
function normalizePostedAt(value: JsonValue | undefined): JsonValue {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return { value: null, precision: 'unknown', raw: typeof value === 'string' ? value : null }
  }
  const item = value as Record<string, JsonValue>
  const raw = typeof item.raw === 'string' ? item.raw : null
  const candidate = typeof item.value === 'string' ? item.value : null
  if (item.precision === 'date' && candidate && isCalendarDate(candidate)) {
    return { value: candidate, precision: 'date', raw }
  }
  if (item.precision === 'instant' && candidate && isExplicitTimezoneInstant(candidate)) {
    return { value: candidate, precision: 'instant', raw }
  }
  if (item.precision === 'relative') {
    const relativeRaw = raw?.trim() ? raw : candidate?.trim() ? candidate : null
    return relativeRaw
      ? { value: null, precision: 'relative', raw: relativeRaw }
      : { value: null, precision: 'unknown', raw }
  }
  return { value: null, precision: 'unknown', raw }
}
function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
function isExplicitTimezoneInstant(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match || !isCalendarDate(match[1])) return false
  const hour = Number(match[2])
  const minute = Number(match[3])
  const second = Number(match[4])
  const offsetHour = match[5] === 'Z' ? 0 : Number(match[6])
  const offsetMinute = match[5] === 'Z' ? 0 : Number(match[7])
  return hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 14 && offsetMinute <= 59 && !(offsetHour === 14 && offsetMinute !== 0) && Number.isFinite(Date.parse(value))
}
function base(context: NormalizationResolverContext, field: CanonicalCandidateField, inputHash: string) { return { resolverId: currentResolverId(context), resolverVersion: RESOLVER_VERSION, field, inputHash } }
function currentResolverId(context: NormalizationResolverContext) { return (context as NormalizationResolverContext & { resolverId: string }).resolverId }
function resolved(context: NormalizationResolverContext, field: CanonicalCandidateField, inputHash: string, value: JsonValue, path: string, authoritative = false, evidenceValue: JsonValue = value): FieldResolutionOutcome { return { ...base(context, field, inputHash), status: 'resolved', value, confidence: authoritative ? 1 : 0.9, authoritative, evidence: [{ kind: 'raw_field', path, value: evidenceValue }] } }
function abstained(context: NormalizationResolverContext, field: CanonicalCandidateField, inputHash: string, reason: string): FieldResolutionOutcome { return { ...base(context, field, inputHash), status: 'abstained', reason } }
export function hashJson(value: unknown) { return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}` }
