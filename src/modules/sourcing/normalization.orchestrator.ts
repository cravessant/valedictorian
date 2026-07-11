import crypto from 'node:crypto'
import type {
  CanonicalCandidateField, CanonicalSourceCandidate, FieldResolutionOutcome, JsonValue,
  NormalizationAttempt, NormalizationGateOutcome, RawSourceNormalizationResult,
  RawSourceFieldDirective, ResolverApplicabilityDecision, ResolverCapability, ResolverVersionRef,
} from 'sparxie'
import {
  canonicalEmploymentTypes,
  canonicalSeniorities,
  fieldResolutionStatuses,
  normalizeApplicationUrlPreservingQuery,
  workModes,
} from 'sparxie'
import { classifyDeterministicDestination } from './destination-classifier'
import { createSqliteNormalizationRepository } from './normalization.repository'
import {
  hashJson,
  isDeterministicCanonicalCompensation,
  isDeterministicCanonicalPostedAt,
  RESOLVER_SUPPRESSION_POLICY_VERSION,
  createNormalizationResolverRegistry,
  type NormalizationResolverRegistry,
} from './normalization.registry'

export const CANONICAL_CANDIDATE_SCHEMA_VERSION = 'canonical-source-candidate/v1'
export const NORMALIZATION_GATE_POLICY_VERSION = 'sourcing-admission/v1'

export function createNormalizationOrchestrator(options: {
  repository: ReturnType<typeof createSqliteNormalizationRepository>
  registry: NormalizationResolverRegistry
  now?: () => Date
  enabledCapabilities?: readonly ResolverCapability[]
}) {
  const now = options.now ?? (() => new Date())
  const enabledCapabilities = options.enabledCapabilities ?? ['pure']

  return {
    async normalize(
      rawRecordId: string,
      rawRevisionId: string,
      trigger: { kind: 'intake' } | { kind: 'replay'; replayId: string; fieldDirectives: RawSourceFieldDirective[]; targetResolverVersions: ResolverVersionRef[] } = { kind: 'intake' },
    ): Promise<RawSourceNormalizationResult> {
      const raw = options.repository.getRawContext(rawRevisionId)
      if (!raw || raw.revision.rawRecordId !== rawRecordId) throw new Error('Raw source revision not found')
      const registry = trigger.kind === 'replay' && trigger.targetResolverVersions.length
        ? selectTargetResolverVersions(options.registry, trigger.targetResolverVersions)
        : options.registry
      const inputHash = hashJson({ rawRevisionId, contentHash: raw.revision.contentHash })
      const cached = trigger.kind === 'intake'
        ? options.repository.findCached(rawRevisionId, inputHash, registry.resolverSetHash, CANONICAL_CANDIDATE_SCHEMA_VERSION, NORMALIZATION_GATE_POLICY_VERSION)
        : null
      if (cached) return cached

      const attempts: NormalizationAttempt[] = []
      const winners = new Map<CanonicalCandidateField, Extract<FieldResolutionOutcome, { status: 'resolved' | 'locked' }>>()
      const conflicts = new Set<CanonicalCandidateField>()
      const rejectedFields = new Set<CanonicalCandidateField>()
      const failedFields = new Set<CanonicalCandidateField>()
      const terminalFields = new Map<CanonicalCandidateField, { status: 'blocked' | 'retry'; reason: string }>()
      let infrastructureFailure: string | null = null

      if (trigger.kind === 'replay') {
        trigger.fieldDirectives.forEach((directive, index) => {
          const resolverId = `replay.directive.${directive.action}.${index}`
          const timestamp = now().toISOString()
          const outcome: FieldResolutionOutcome = directive.action === 'lock'
            ? { resolverId, resolverVersion: directive.policyVersion, field: directive.field, inputHash: directive.inputHash, status: 'locked', value: directive.value, reason: directive.reason, policyVersion: directive.policyVersion }
            : { resolverId, resolverVersion: directive.policyVersion, field: directive.field, inputHash: directive.inputHash, status: 'suppressed', reason: directive.reason, policyVersion: directive.policyVersion }
          attempts.push({
            id: crypto.randomUUID(), rawRevisionId,
            resolver: { id: resolverId, version: directive.policyVersion, requiredInputs: ['replayDirective'], outputFields: [directive.field], capabilities: ['pure'], costClass: 'none', precedence: Number.MAX_SAFE_INTEGER },
            inputHash: directive.inputHash, status: 'completed',
            applicability: [{ resolverId, resolverVersion: directive.policyVersion, field: directive.field, inputHash: directive.inputHash, status: 'applicable' }],
            startedAt: timestamp, completedAt: timestamp, outcomes: [outcome],
          })
          if (outcome.status === 'locked') winners.set(directive.field, outcome)
          else terminalFields.set(directive.field, { status: 'blocked', reason: directive.reason })
        })
      }

      for (const resolver of registry.resolvers) {
        const startedAt = now().toISOString()
        const attemptInputHash = hashJson({ raw: raw.revision.contentHash, resolver: resolver.declaration })
        const applicability = resolver.declaration.outputFields.map((field): ResolverApplicabilityDecision => applicabilityFor(resolver.declaration, field, attemptInputHash, raw.revision.adapter, raw.revision.providerSchema, enabledCapabilities))
        let outcomes: FieldResolutionOutcome[] = []
        let invoked = false
        const allSuppressed = resolver.declaration.outputFields.every((field) => isSuppressionBarrier(field, winners, rejectedFields, failedFields, terminalFields))
        try {
          if (allSuppressed) {
            outcomes = resolver.declaration.outputFields.map((field) => suppressedOutcome(resolver.declaration.id, resolver.declaration.version, field, attemptInputHash))
          } else if (applicability.some(({ status }) => status === 'blocked')) {
            outcomes = applicability.map((decision) => isSuppressionBarrier(decision.field, winners, rejectedFields, failedFields, terminalFields)
              ? suppressedOutcome(resolver.declaration.id, resolver.declaration.version, decision.field, decision.inputHash)
              : { resolverId: resolver.declaration.id, resolverVersion: resolver.declaration.version, field: decision.field, inputHash: decision.inputHash, status: 'blocked', reason: decision.reason ?? 'Capability blocked' })
          } else if (applicability.every(({ status }) => status === 'not_applicable')) {
            outcomes = applicability.map((decision) => isSuppressionBarrier(decision.field, winners, rejectedFields, failedFields, terminalFields)
              ? suppressedOutcome(resolver.declaration.id, resolver.declaration.version, decision.field, decision.inputHash)
              : { resolverId: resolver.declaration.id, resolverVersion: resolver.declaration.version, field: decision.field, inputHash: decision.inputHash, status: 'not_applicable', reason: decision.reason ?? 'Resolver not applicable' })
          } else {
            invoked = true
            const issuedInputHashes = new Set<string>()
            const context = Object.freeze({ rawRevision: deepFreeze(structuredClone(raw.revision)), sourceEntity: raw.sourceEntity ? deepFreeze(structuredClone(raw.sourceEntity)) : null, enabledCapabilities: Object.freeze([...enabledCapabilities]), resolverId: resolver.declaration.id, hashInput(value: JsonValue) { const hash = hashJson(value); issuedInputHashes.add(hash); return hash } })
            outcomes = await resolver.resolve(context)
            validateOutcomes(resolver.declaration.id, resolver.declaration.version, resolver.declaration.outputFields, outcomes, issuedInputHashes)
            outcomes = outcomes.map((outcome) => isSuppressionBarrier(outcome.field, winners, rejectedFields, failedFields, terminalFields)
              ? suppressedOutcome(resolver.declaration.id, resolver.declaration.version, outcome.field, outcome.inputHash)
              : outcome)
          }
        } catch (error) {
          infrastructureFailure = error instanceof Error ? error.message : 'Resolver failed'
          outcomes = resolver.declaration.outputFields.map((field) => ({ resolverId: resolver.declaration.id, resolverVersion: resolver.declaration.version, field, inputHash: attemptInputHash, status: 'failed', reason: infrastructureFailure! }))
        }
        const persistedConflicts: FieldResolutionOutcome[] = []
        for (const outcome of outcomes) {
          if (outcome.status === 'failed' && infrastructureFailure === null) infrastructureFailure = outcome.reason
          if (invoked && (outcome.status === 'blocked' || outcome.status === 'retry') && !winners.has(outcome.field)) terminalFields.set(outcome.field, { status: outcome.status, reason: outcome.reason })
          const current = winners.get(outcome.field)
          if (current && (outcome.status === 'resolved' || outcome.status === 'locked')) {
            const currentStrength = current.status === 'locked' ? 2 : current.confidence
            const nextStrength = outcome.status === 'locked' ? 2 : outcome.confidence
            if (currentStrength === nextStrength && !jsonValuesEqual(valueOf(current), valueOf(outcome))) {
              persistedConflicts.push({
                resolverId: outcome.resolverId, resolverVersion: outcome.resolverVersion,
                field: outcome.field, inputHash: outcome.inputHash, status: 'conflict',
                reason: 'Equal-strength resolvers emitted distinct values',
                values: [valueOf(current)!, valueOf(outcome)!],
              })
            }
          }
          reconcile(outcome, winners, conflicts, rejectedFields, failedFields)
        }
        outcomes.push(...persistedConflicts)
        attempts.push({ id: crypto.randomUUID(), rawRevisionId, resolver: resolver.declaration, inputHash: attemptInputHash, status: outcomes.some(({ status }) => status === 'failed') ? 'failed' : 'completed', applicability, startedAt, completedAt: now().toISOString(), outcomes })
      }

      const evaluatedAt = now().toISOString()
      const destination = valueOf(winners.get('destinationUrl')) as CanonicalSourceCandidate['destination'] | null
      const entity = raw.sourceEntity
      let identity = valueOf(winners.get('canonicalIdentity')) as CanonicalSourceCandidate['canonicalIdentity'] | null
      if (!identity && destination) {
        identity = { kind: 'destination_url', value: destination.url }
      }
      let expectedIdentity: { kind: 'provider_job' | 'destination_url'; value: string } | null = null
      if (raw.sourceEntity?.identityKind === 'provider_job') {
        expectedIdentity = { kind: 'provider_job', value: JSON.stringify([raw.sourceEntity.identityNamespace, raw.sourceEntity.identityValue]) }
      } else if (raw.sourceEntity?.identityKind === 'destination_url') {
        expectedIdentity = { kind: 'destination_url', value: raw.sourceEntity.identityValue }
        if (!destination || raw.sourceEntity.identityValue !== destination.url) conflicts.add('canonicalIdentity')
      } else if (raw.sourceEntity) {
        conflicts.add('canonicalIdentity')
      } else if (destination) {
        expectedIdentity = { kind: 'destination_url', value: destination.url }
      }
      if (identity && (!expectedIdentity || identity.kind !== expectedIdentity.kind || identity.value !== expectedIdentity.value)) {
        conflicts.add('canonicalIdentity')
      }
      const missingFields: CanonicalCandidateField[] = []
      const companyName = valueOf(winners.get('companyName'))
      const roleTitle = valueOf(winners.get('roleTitle'))
      if (!identity) missingFields.push('canonicalIdentity')
      if (typeof companyName !== 'string' || !companyName.trim()) missingFields.push('companyName')
      if (typeof roleTitle !== 'string' || !roleTitle.trim()) missingFields.push('roleTitle')
      if (!destination) missingFields.push('destinationUrl')
      const requiredFields: CanonicalCandidateField[] = ['canonicalIdentity','companyName','roleTitle','destinationUrl']
      const rejectedRequiredFields = requiredFields.filter((field) => rejectedFields.has(field))
      const terminalRequiredFields = requiredFields.flatMap((field) => { const outcome = terminalFields.get(field); return outcome ? [{ field, ...outcome }] : [] })
      const initialStatus = infrastructureFailure ? 'failed' : rejectedRequiredFields.length ? 'rejected' : missingFields.length || conflicts.size ? 'needs_enrichment' : 'passed'
      const materialize = (resolvedEntity: typeof entity, reconciliationConflict = false) => {
        const status = reconciliationConflict ? 'needs_enrichment' : initialStatus
        const conflictingFields = reconciliationConflict
          ? [...new Set([...conflicts, 'canonicalIdentity' as const])]
          : [...conflicts]
        const runId = crypto.randomUUID()
        const candidate: CanonicalSourceCandidate | null = status === 'passed' && resolvedEntity && identity ? {
          id: crypto.randomUUID(), sourceEntityId: resolvedEntity.id, rawRecordId, rawRevisionId, schemaVersion: CANONICAL_CANDIDATE_SCHEMA_VERSION,
          canonicalIdentity: identity, companyName: companyName as string, roleTitle: roleTitle as string,
          employmentType: (valueOf(winners.get('employmentType')) ?? 'unknown') as CanonicalSourceCandidate['employmentType'],
          seniority: (valueOf(winners.get('seniority')) ?? 'unknown') as CanonicalSourceCandidate['seniority'],
          workMode: (valueOf(winners.get('workMode')) ?? 'unclear') as CanonicalSourceCandidate['workMode'],
          location: (valueOf(winners.get('location')) ?? null) as CanonicalSourceCandidate['location'],
          compensation: (valueOf(winners.get('compensation')) ?? null) as CanonicalSourceCandidate['compensation'],
          postedAt: (valueOf(winners.get('postedAt')) ?? { value: null, precision: 'unknown', raw: null }) as unknown as CanonicalSourceCandidate['postedAt'],
          destination, sourceUrl: (valueOf(winners.get('sourceUrl')) ?? null) as string | null,
          providerJobId: (valueOf(winners.get('providerJobId')) ?? null) as string | null, observedAt: raw.revision.observedAt,
        } : null
        const gateBase = { policyVersion: NORMALIZATION_GATE_POLICY_VERSION, requiredFields, missingFields, conflictingFields, reason: infrastructureFailure ?? (rejectedRequiredFields.length ? `Required canonical fields rejected: ${rejectedRequiredFields.join(', ')}` : terminalRequiredFields.length ? `Required canonical fields need enrichment: ${terminalRequiredFields.map(({ field, status, reason }) => `${field} (${status}: ${reason})`).join(', ')}` : null), evaluatedAt }
        let gate: NormalizationGateOutcome
        if (status === 'passed' && candidate) {
          gate = {
            ...gateBase,
            missingFields: [],
            conflictingFields: [],
            status: 'passed',
            candidate: { id: candidate.id, sourceEntityId: candidate.sourceEntityId, rawRecordId, rawRevisionId, schemaVersion: CANONICAL_CANDIDATE_SCHEMA_VERSION },
          }
        } else if (status === 'failed') {
          gate = { ...gateBase, status: 'failed', candidate: null }
        } else if (status === 'rejected') {
          gate = { ...gateBase, status: 'rejected', candidate: null }
        } else {
          gate = { ...gateBase, status: 'needs_enrichment', candidate: null }
        }
        return { runId, rawRecordId, rawRevisionId, inputHash, resolverSetHash: registry.resolverSetHash, canonicalSchemaVersion: CANONICAL_CANDIDATE_SCHEMA_VERSION, gatePolicyVersion: NORMALIZATION_GATE_POLICY_VERSION, status: status === 'failed' ? 'failed' as const : 'completed' as const, attempts, candidate, gate, now: evaluatedAt, triggerId: trigger.kind === 'replay' ? trigger.replayId : undefined }
      }
      if (initialStatus === 'passed' && destination) {
        const destinationOutcome = winners.get('destinationUrl')
        if (!destinationOutcome) throw new Error('Passed normalization is missing destination provenance')
        return options.repository.persistWithStrongDestination({
          sourceEntity: raw.sourceEntity,
          rawRevisionId,
          destination,
          destinationOutcome,
          createdAt: evaluatedAt,
          materialize: (reconciliation) => materialize(reconciliation.sourceEntity, reconciliation.conflict),
        })
      }
      return options.repository.persist(materialize(entity))
    },
  }
}

function selectTargetResolverVersions(
  registry: NormalizationResolverRegistry,
  targets: ResolverVersionRef[],
) {
  const targetById = new Map(targets.map((target) => [target.resolverId, target.version]))
  return createNormalizationResolverRegistry(registry.resolvers.filter(({ declaration }) => {
    const targetVersion = targetById.get(declaration.id)
    return targetVersion === undefined || declaration.version === targetVersion
  }))
}

function applicabilityFor(declaration: NormalizationAttempt['resolver'], field: CanonicalCandidateField, inputHash: string, adapter: { id: string; kind: 'connector' | 'cli' | 'manual' | 'import'; version: string }, providerSchema: string | null, enabled: readonly ResolverCapability[]): ResolverApplicabilityDecision {
  const missingCapabilities = declaration.capabilities.filter((capability) => !enabled.includes(capability))
  if (missingCapabilities.length) return { resolverId: declaration.id, resolverVersion: declaration.version, field, inputHash, status: 'blocked', reason: 'Required capability is disabled', missingCapabilities }
  const supported = declaration.supportedAdapters
  if ((supported?.kinds && !supported.kinds.includes(adapter.kind)) || (supported?.ids && !supported.ids.includes(adapter.id)) || (supported?.versions && !supported.versions.includes(adapter.version)) || (declaration.supportedProviderSchemas && (!providerSchema || !declaration.supportedProviderSchemas.includes(providerSchema)))) return { resolverId: declaration.id, resolverVersion: declaration.version, field, inputHash, status: 'not_applicable', reason: 'Raw revision is outside the resolver declaration' }
  return { resolverId: declaration.id, resolverVersion: declaration.version, field, inputHash, status: 'applicable' }
}
function validateOutcomes(id: string, version: string, fields: CanonicalCandidateField[], outcomes: FieldResolutionOutcome[], issuedInputHashes: Set<string>) { const counts = new Map(fields.map((field) => [field, 0])); for (const outcome of outcomes) { if (!isValidFieldResolutionOutcome(outcome)) throw new Error(`Resolver ${id}@${version} emitted an invalid outcome shape`); counts.set(outcome.field, (counts.get(outcome.field) ?? 0) + 1); if (outcome.resolverId !== id || outcome.resolverVersion !== version || !fields.includes(outcome.field) || !issuedInputHashes.has(outcome.inputHash) || ((outcome.status === 'resolved' || outcome.status === 'locked') && !isValidCanonicalFieldValue(outcome.field, outcome.value))) throw new Error(`Resolver ${id}@${version} emitted an outcome outside its declaration, context, or bounded field contract`) } if ([...counts.values()].some((count) => count !== 1)) throw new Error(`Resolver ${id}@${version} did not emit exactly one outcome per declared field`) }
function isValidFieldResolutionOutcome(value: unknown): value is FieldResolutionOutcome {
  if (!isUnknownRecord(value) || typeof value.status !== 'string' || !fieldResolutionStatuses.some((status) => status === value.status)) return false
  if (typeof value.resolverId !== 'string' || typeof value.resolverVersion !== 'string' || typeof value.field !== 'string' || typeof value.inputHash !== 'string') return false
  if (Object.prototype.hasOwnProperty.call(value, 'evidence') && (!Array.isArray(value.evidence) || !value.evidence.every(isValidResolutionEvidence))) return false
  const baseKeys = ['resolverId','resolverVersion','field','inputHash','status','evidence']
  if (value.status === 'resolved') {
    return hasOnlyAllowedKeys(value, [...baseKeys,'value','confidence','authoritative']) && isJsonSafe(value.value) && typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1 && (!Object.prototype.hasOwnProperty.call(value, 'authoritative') || typeof value.authoritative === 'boolean')
  }
  if (['not_applicable','abstained','blocked','rejected','failed'].includes(value.status)) {
    return hasOnlyAllowedKeys(value, [...baseKeys,'reason']) && isNonblankString(value.reason)
  }
  if (value.status === 'retry') {
    return hasOnlyAllowedKeys(value, [...baseKeys,'reason','retryAfter']) && isNonblankString(value.reason) && (!Object.prototype.hasOwnProperty.call(value, 'retryAfter') || value.retryAfter === null || isNonblankString(value.retryAfter))
  }
  if (value.status === 'conflict') {
    return hasOnlyAllowedKeys(value, [...baseKeys,'reason','values']) && isNonblankString(value.reason) && Array.isArray(value.values) && value.values.every(isJsonSafe)
  }
  if (value.status === 'suppressed') {
    return hasOnlyAllowedKeys(value, [...baseKeys,'reason','policyVersion']) && isNonblankString(value.reason) && isNonblankString(value.policyVersion)
  }
  return hasOnlyAllowedKeys(value, [...baseKeys,'value','reason','policyVersion']) && isJsonSafe(value.value) && isNonblankString(value.reason) && isNonblankString(value.policyVersion)
}
function isValidResolutionEvidence(value: unknown) {
  if (!isUnknownRecord(value) || !hasOnlyAllowedKeys(value, ['kind','value','path','sourceUrl']) || !isNonblankString(value.kind) || !isJsonSafe(value.value)) return false
  if (Object.prototype.hasOwnProperty.call(value, 'path') && !isNonblankString(value.path)) return false
  return !Object.prototype.hasOwnProperty.call(value, 'sourceUrl') || isNonblankString(value.sourceUrl)
}
function isJsonSafe(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonSafe)
  if (!isUnknownRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && Object.values(value).every(isJsonSafe)
}
function isUnknownRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function hasOnlyAllowedKeys(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).every((key) => allowed.includes(key)) }
function isNonblankString(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()) }
function isAuthoritative(outcome: FieldResolutionOutcome | undefined) { return outcome?.status === 'locked' || (outcome?.status === 'resolved' && outcome.authoritative === true) }
function isSuppressionBarrier(field: CanonicalCandidateField, winners: Map<CanonicalCandidateField, Extract<FieldResolutionOutcome, { status: 'resolved' | 'locked' }>>, rejectedFields: Set<CanonicalCandidateField>, failedFields: Set<CanonicalCandidateField>, terminalFields: ReadonlyMap<CanonicalCandidateField, unknown>) { return rejectedFields.has(field) || failedFields.has(field) || terminalFields.has(field) || isAuthoritative(winners.get(field)) }
function suppressedOutcome(resolverId: string, resolverVersion: string, field: CanonicalCandidateField, inputHash: string): FieldResolutionOutcome { return { resolverId, resolverVersion, field, inputHash, status: 'suppressed', reason: 'Higher-precedence field outcome is authoritative, locked, rejected, failed, blocked, or awaiting retry', policyVersion: RESOLVER_SUPPRESSION_POLICY_VERSION } }
function valueOf(outcome: FieldResolutionOutcome | undefined): JsonValue | undefined { return outcome && (outcome.status === 'resolved' || outcome.status === 'locked') ? outcome.value : undefined }
function reconcile(outcome: FieldResolutionOutcome, winners: Map<CanonicalCandidateField, Extract<FieldResolutionOutcome, { status: 'resolved' | 'locked' }>>, conflicts: Set<CanonicalCandidateField>, rejectedFields: Set<CanonicalCandidateField>, failedFields: Set<CanonicalCandidateField>) { if (outcome.status === 'conflict') { conflicts.add(outcome.field); return } if (outcome.status === 'rejected') { if (!winners.has(outcome.field)) rejectedFields.add(outcome.field); return } if (outcome.status === 'failed') { failedFields.add(outcome.field); return } if (outcome.status !== 'resolved' && outcome.status !== 'locked') return; const current = winners.get(outcome.field); if (!current) { winners.set(outcome.field, outcome); return } const currentStrength = current.status === 'locked' ? 2 : current.confidence; const nextStrength = outcome.status === 'locked' ? 2 : outcome.confidence; if (nextStrength > currentStrength) winners.set(outcome.field, outcome); else if (nextStrength === currentStrength && !jsonValuesEqual(valueOf(current), valueOf(outcome))) conflicts.add(outcome.field) }
function jsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => jsonValuesEqual(value, right[index]))
  }
  if (!isObjectValue(left) || !isObjectValue(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && jsonValuesEqual(left[key], right[key]))
}
function isObjectValue(value: JsonValue | undefined): value is { [key: string]: JsonValue } { return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child) } return value }
export function isValidCanonicalFieldValue(field: CanonicalCandidateField, value: JsonValue): boolean {
  if (field === 'companyName' || field === 'roleTitle' || field === 'providerJobId') return typeof value === 'string' && value.length > 0 && value === value.trim()
  if (field === 'employmentType') return typeof value === 'string' && canonicalEmploymentTypes.some((item) => item === value)
  if (field === 'seniority') return typeof value === 'string' && canonicalSeniorities.some((item) => item === value)
  if (field === 'workMode') return typeof value === 'string' && workModes.some((item) => item === value)
  if (field === 'sourceUrl') { if (typeof value !== 'string') return false; try { return value === normalizeApplicationUrlPreservingQuery(value) } catch { return false } }
  if (field === 'destinationUrl') {
    if (!isObject(value) || !hasExactObjectKeys(value, ['class','url'], ['intermediaryUrl']) || typeof value.url !== 'string' || typeof value.class !== 'string') return false
    const classified = classifyDeterministicDestination(value.url)
    return classified?.url === value.url && classified.class === value.class && (value.intermediaryUrl === null || value.intermediaryUrl === undefined || typeof value.intermediaryUrl === 'string')
  }
  if (field === 'canonicalIdentity') return isObject(value) && hasExactObjectKeys(value, ['kind','value']) && typeof value.kind === 'string' && ['provider_job','destination_url','source_alias'].includes(value.kind) && typeof value.value === 'string' && value.value.length > 0 && value.value === value.value.trim()
  if (field === 'location') return value === null || (isObject(value) && hasExactObjectKeys(value, ['raw','city','region','country']) && ['raw','city','region','country'].every((key) => value[key] === null || typeof value[key] === 'string'))
  if (field === 'compensation') return isDeterministicCanonicalCompensation(value)
  if (field === 'postedAt') return isDeterministicCanonicalPostedAt(value)
  return false
}
function isObject(value: JsonValue): value is { [key: string]: JsonValue } { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function hasExactObjectKeys(value: { [key: string]: JsonValue }, required: string[], optional: string[] = []) {
  const allowed = [...required, ...optional]
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every((key) => allowed.includes(key))
}
