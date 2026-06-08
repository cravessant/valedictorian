import { randomUUID } from 'node:crypto'
import { and, desc, eq, type SQL } from 'drizzle-orm'
import {
  defaultPolicyConfig,
  isPolicyEvidenceTag,
  isPolicySubjectType,
  normalizePolicyConfig,
  type EvaluateApplicationPolicyInput,
  type EvaluateRunWindowPolicyInput,
  type EvaluateSourcingCandidatePolicyInput,
  type PolicyConfig,
  type PolicyConfigPatch,
  type PolicyDecision,
  type PolicyEvidenceInput,
  type PolicyEvidenceListInput,
  type PolicyEvidenceRecord,
  type PolicyEvidenceTag,
  type PolicyReason,
  type PolicyRunWindowDecision,
} from 'sparxie'
import {
  applications,
  companies,
  policyConfig,
  policyEvidence,
  workflowRunSteps,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import { isPassedFinalReviewReceipt } from '../applications/application.repository.helpers'

const ACTIVE_POLICY_CONFIG_ID = 'active'
const DEFAULT_POLICY_EVIDENCE_LIMIT = 100
const blockerOutcomes = new Set(['manual_captcha', 'security_gate', 'login_needed', 'platform_error'])

export function createSqlitePolicyRepository(database: DrizzleDatabase) {
  return {
    async getConfig(): Promise<PolicyConfig> {
      return readPolicyConfig(database)
    },
    async resetConfig(): Promise<PolicyConfig> {
      return writePolicyConfig(database, defaultPolicyConfig)
    },
    async updateConfig(patch: PolicyConfigPatch): Promise<PolicyConfig> {
      const current = readPolicyConfig(database)
      return writePolicyConfig(database, normalizePolicyConfig(deepMerge(current, patch)))
    },
    async listEvidence(input: PolicyEvidenceListInput = {}): Promise<PolicyEvidenceRecord[]> {
      const limit = input.limit ?? DEFAULT_POLICY_EVIDENCE_LIMIT
      const offset = input.offset ?? 0
      const filters: SQL[] = []

      if (input.subjectType) {
        if (!isPolicySubjectType(input.subjectType)) {
          throw new Error(`Invalid policy subject type: ${input.subjectType}`)
        }

        filters.push(eq(policyEvidence.subjectType, input.subjectType))
      }

      if (input.subjectId) {
        filters.push(eq(policyEvidence.subjectId, input.subjectId))
      }

      if (input.tag) {
        if (!isPolicyEvidenceTag(input.tag)) {
          throw new Error(`Invalid policy evidence tag: ${input.tag}`)
        }

        filters.push(eq(policyEvidence.tag, input.tag))
      }

      return database
        .select()
        .from(policyEvidence)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(policyEvidence.createdAt))
        .limit(limit)
        .offset(offset)
        .all()
        .map(mapPolicyEvidence)
    },
    async recordEvidence(input: PolicyEvidenceInput): Promise<PolicyEvidenceRecord> {
      if (!isPolicySubjectType(input.subjectType)) {
        throw new Error(`Invalid policy subject type: ${input.subjectType}`)
      }

      if (!isPolicyEvidenceTag(input.tag)) {
        throw new Error(`Invalid policy evidence tag: ${input.tag}`)
      }

      const now = new Date().toISOString()
      const id = randomUUID()

      database
        .insert(policyEvidence)
        .values({
          id,
          subjectType: input.subjectType,
          subjectId: requiredText(input.subjectId, 'subjectId'),
          tag: input.tag,
          source: input.source?.trim() || 'agent',
          note: input.note === undefined ? null : nullableText(input.note),
          payloadJson: JSON.stringify(input.payload ?? {}),
          createdAt: now,
        })
        .run()

      const created = database.select().from(policyEvidence).where(eq(policyEvidence.id, id)).get()

      if (!created) {
        throw new Error(`Policy evidence not found: ${id}`)
      }

      return mapPolicyEvidence(created)
    },
    async evaluateApplication(input: EvaluateApplicationPolicyInput): Promise<PolicyDecision> {
      return evaluateApplicationPolicy(database, readPolicyConfig(database), input)
    },
    async evaluateSourcingCandidate(input: EvaluateSourcingCandidatePolicyInput): Promise<PolicyDecision> {
      return evaluateSourcingCandidatePolicy(database, readPolicyConfig(database), input)
    },
    async evaluateRunWindow(input: EvaluateRunWindowPolicyInput): Promise<PolicyRunWindowDecision> {
      return evaluateRunWindowPolicy(readPolicyConfig(database), input)
    },
  }
}

export function readPolicyConfig(database: Pick<DrizzleDatabase, 'select'>): PolicyConfig {
  const row = database
    .select()
    .from(policyConfig)
    .where(eq(policyConfig.id, ACTIVE_POLICY_CONFIG_ID))
    .get()

  if (!row) {
    return normalizePolicyConfig(defaultPolicyConfig)
  }

  try {
    return normalizePolicyConfig(JSON.parse(row.configJson) as unknown)
  } catch {
    return normalizePolicyConfig(defaultPolicyConfig)
  }
}

function writePolicyConfig(
  database: Pick<DrizzleDatabase, 'insert' | 'select' | 'update'>,
  config: PolicyConfig,
) {
  const normalized = normalizePolicyConfig(config)
  const now = new Date().toISOString()
  const existing = database
    .select({ id: policyConfig.id })
    .from(policyConfig)
    .where(eq(policyConfig.id, ACTIVE_POLICY_CONFIG_ID))
    .get()

  if (existing) {
    database
      .update(policyConfig)
      .set({
        configJson: JSON.stringify(normalized),
        updatedAt: now,
      })
      .where(eq(policyConfig.id, ACTIVE_POLICY_CONFIG_ID))
      .run()
    return normalized
  }

  database
    .insert(policyConfig)
    .values({
      id: ACTIVE_POLICY_CONFIG_ID,
      configJson: JSON.stringify(normalized),
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return normalized
}

export function evaluateSourcingCandidatePolicy(
  database: Pick<DrizzleDatabase, 'select'>,
  config: PolicyConfig,
  input: EvaluateSourcingCandidatePolicyInput,
): PolicyDecision {
  const evidence = input.findingId
    ? listEvidenceForSubject(database, 'sourcing_finding', input.findingId)
    : input.evidence ?? []
  const evidenceTags = tagSet(evidence)

  if (!input.officialUrl && !input.sourceUrl) {
    return decision({
      action: 'block_sourcing_candidate',
      status: 'needs_evidence',
      reasons: [
        {
          code: 'official_path_missing',
          message: 'Candidate requires an officialUrl or sourceUrl before promotion.',
        },
      ],
      requiredEvidence: ['official_path_verified'],
    })
  }

  if (
    input.priorityScore !== undefined &&
    input.priorityScore !== null &&
    input.priorityScore < config.scoring.applyCutoff &&
    !evidenceTags.has('apply_cutoff_override')
  ) {
    return decision({
      action: 'skip_below_cutoff',
      status: 'skip',
      reasons: [
        {
          code: 'below_policy_cutoff',
          message: `Priority score ${input.priorityScore} is below policy cutoff ${config.scoring.applyCutoff}.`,
        },
      ],
      requiredEvidence: ['apply_cutoff_override'],
    })
  }

  return decision({
    action: 'promote_sourcing_candidate',
    status: 'allow',
    reasons: [
      {
        code: 'sourcing_candidate_eligible',
        message: 'Candidate satisfies policy requirements for promotion.',
      },
    ],
  })
}

export function evaluateApplicationPolicy(
  database: Pick<DrizzleDatabase, 'select'>,
  config: PolicyConfig,
  input: EvaluateApplicationPolicyInput,
): PolicyDecision {
  const application = selectApplicationPolicyContext(database, input.applicationId)
  const outcome = input.outcome ?? application.status
  const evidence = listEvidenceForSubject(database, 'application', input.applicationId)
  const evidenceTags = tagSet(evidence)

  if (evidenceTags.has('do_not_submit') && outcome === 'submitted') {
    return decision({
      action: 'deny_submit',
      status: 'deny',
      reasons: [
        {
          code: 'do_not_submit',
          message: 'Policy evidence marks this application as do-not-submit.',
        },
      ],
    })
  }

  if (outcome === 'submitted') {
    if (
      config.verification.requireFinalReviewReceiptForSubmit &&
      input.attemptId &&
      !isPassedFinalReviewReceipt(latestVerificationReceipt(database, input.attemptId))
    ) {
      return decision({
        action: 'needs_evidence',
        status: 'needs_evidence',
        reasons: [
          {
            code: 'final_review_receipt_required',
            message: 'Submitted attempts require a passed final-review verification receipt.',
          },
        ],
        requiredEvidence: ['final_review_verification_receipt'],
      })
    }

    const approvalRequired =
      matchesAnyPattern(application.companyName, config.manualReview.explicitApprovalCompanyPatterns) ||
      matchesAnyPattern(application.companyName, config.manualReview.manualReviewCompanyPatterns) ||
      config.manualReview.nonOverridableTags.some((tag) => evidenceTags.has(tag))

    if (approvalRequired && !evidenceTags.has('explicit_user_approval')) {
      return decision({
        action: 'hold_for_user_review',
        status: 'needs_review',
        reasons: [
          {
            code: 'explicit_approval_required',
            message: 'Policy requires explicit user approval before submitted.',
          },
        ],
        requiredEvidence: ['explicit_user_approval'],
      })
    }

    if (evidenceTags.has('high_risk_form') && !evidenceTags.has('high_risk_form_verified')) {
      return decision({
        action: 'needs_evidence',
        status: 'needs_evidence',
        reasons: [
          {
            code: 'high_risk_form_unverified',
            message: 'High-risk third-party form requires verification before submit.',
          },
        ],
        requiredEvidence: ['high_risk_form_verified'],
      })
    }

    if (
      config.verification.requireSecondPassForSubmit &&
      evidenceTags.has('requires_second_pass') &&
      !evidenceTags.has('second_pass_verified')
    ) {
      return decision({
        action: 'needs_evidence',
        status: 'needs_evidence',
        reasons: [
          {
            code: 'second_pass_required',
            message: 'Policy requires second-pass verification evidence before submit.',
          },
        ],
        requiredEvidence: ['second_pass_verified'],
      })
    }

    return decision({
      action: 'allow_submit',
      status: 'allow',
      reasons: [
        {
          code: 'submit_allowed',
          message: 'Policy allows submitted outcome.',
        },
      ],
    })
  }

  if (blockerOutcomes.has(String(outcome))) {
    const requiredAttempts =
      outcome === 'platform_error'
        ? config.retries.platformErrorMinProfileAttempts
        : config.retries.captchaSecurityMinProfileAttempts
    const retryCount = evidence.filter((item) => (
      item.tag === 'profile_retry_completed' || item.tag === 'headed_profile_retry_completed'
    )).length

    if (retryCount < requiredAttempts) {
      return decision({
        action: 'needs_evidence',
        status: 'needs_evidence',
        reasons: [
          {
            code: 'retry_evidence_required',
            message: `${outcome} requires ${requiredAttempts} profile retry evidence record(s).`,
          },
        ],
        requiredEvidence: ['profile_retry_completed'],
      })
    }
  }

  return decision({
    action: 'allow_outcome',
    status: 'allow',
    reasons: [
      {
        code: 'outcome_allowed',
        message: `Policy allows ${outcome} outcome.`,
      },
    ],
  })
}

export function evaluateRunWindowPolicy(
  config: PolicyConfig,
  input: EvaluateRunWindowPolicyInput,
): PolicyRunWindowDecision {
  const now = input.now ? new Date(input.now) : new Date()

  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid policy run window now: ${input.now}`)
  }

  const timezone = input.timezone?.trim() || config.sourcing.timezone
  const parts = localDateParts(now, timezone)
  const cadenceHours = parts.weekend
    ? config.sourcing.weekendCadenceHours
    : parts.hour >= config.sourcing.overnightStartHour &&
        parts.hour <= config.sourcing.overnightEndHour
      ? config.sourcing.weekdayOvernightCadenceHours
      : config.sourcing.weekdayNormalCadenceHours
  const previousCompletedAt = input.previousRunCompletedAt
    ? new Date(input.previousRunCompletedAt)
    : null
  const coverageStartedAt =
    previousCompletedAt && !Number.isNaN(previousCompletedAt.getTime())
      ? new Date(previousCompletedAt.getTime() - config.sourcing.overlapMinutes * 60_000)
      : new Date(
          now.getTime() -
            (cadenceHours * 60 + config.sourcing.overlapMinutes) * 60_000,
        )

  return {
    ...decision({
      action: 'recommend_run_window',
      status: 'allow',
      reasons: [
        {
          code: 'scheduler_ready_only',
          message: 'Policy computed a run window without scheduling or launching automation.',
        },
      ],
    }),
    cadenceHours,
    overlapMinutes: config.sourcing.overlapMinutes,
    recommendedCoverageStartedAt: coverageStartedAt.toISOString(),
    recommendedCoverageEndedAt: now.toISOString(),
    timezone,
  }
}

export function listEvidenceForSubject(
  database: Pick<DrizzleDatabase, 'select'>,
  subjectType: PolicyEvidenceRecord['subjectType'],
  subjectId: string,
) {
  return database
    .select()
    .from(policyEvidence)
    .where(and(eq(policyEvidence.subjectType, subjectType), eq(policyEvidence.subjectId, subjectId)))
    .orderBy(desc(policyEvidence.createdAt))
    .all()
    .map(mapPolicyEvidence)
}

function selectApplicationPolicyContext(
  database: Pick<DrizzleDatabase, 'select'>,
  applicationId: string,
) {
  const row = database
    .select({
      id: applications.id,
      companyName: companies.name,
      status: applications.status,
    })
    .from(applications)
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .where(eq(applications.id, applicationId))
    .get()

  if (!row) {
    throw new Error(`Application not found: ${applicationId}`)
  }

  return row
}

function latestVerificationReceipt(
  database: Pick<DrizzleDatabase, 'select'>,
  attemptId: string,
) {
  const step = database
    .select()
    .from(workflowRunSteps)
    .where(and(eq(workflowRunSteps.workflowRunId, attemptId), eq(workflowRunSteps.type, 'verification_receipt')))
    .orderBy(desc(workflowRunSteps.sequence))
    .get()

  if (!step) {
    return null
  }

  try {
    return JSON.parse(step.payloadJson) as unknown
  } catch {
    return null
  }
}

function decision({
  action,
  reasons,
  requiredEvidence = [],
  status,
  tags = [],
}: {
  action: string
  reasons: PolicyReason[]
  requiredEvidence?: PolicyEvidenceTag[]
  status: PolicyDecision['status']
  tags?: PolicyEvidenceTag[]
}): PolicyDecision {
  return {
    action,
    configVersion: 1,
    reasons,
    requiredEvidence,
    status,
    tags,
  }
}

function mapPolicyEvidence(row: typeof policyEvidence.$inferSelect): PolicyEvidenceRecord {
  return {
    id: row.id,
    subjectType: row.subjectType as PolicyEvidenceRecord['subjectType'],
    subjectId: row.subjectId,
    tag: row.tag as PolicyEvidenceRecord['tag'],
    source: row.source,
    note: row.note,
    payloadJson: row.payloadJson,
    createdAt: row.createdAt,
  }
}

function tagSet(evidence: PolicyEvidenceRecord[]) {
  return new Set(evidence.map((item) => item.tag))
}

function matchesAnyPattern(value: string, patterns: string[]) {
  const normalized = value.toLowerCase()

  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()))
}

function localDateParts(date: Date, timezone: string) {
  if (timezone === 'local') {
    return {
      hour: date.getHours(),
      weekend: date.getDay() === 0 || date.getDay() === 6,
    }
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone,
    weekday: 'short',
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? date.getUTCHours())
  const weekday = parts.find((part) => part.type === 'weekday')?.value

  return {
    hour,
    weekend: weekday === 'Sat' || weekday === 'Sun',
  }
}

function deepMerge(left: unknown, right: unknown): unknown {
  if (!isRecord(left) || !isRecord(right)) {
    return right ?? left
  }

  const merged: Record<string, unknown> = { ...left }

  for (const [key, value] of Object.entries(right)) {
    merged[key] = Array.isArray(value) ? [...value] : deepMerge(merged[key], value)
  }

  return merged
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requiredText(value: string, fieldName: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${fieldName} is required`)
  }

  return trimmed
}

function nullableText(value: string | null) {
  if (value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}
