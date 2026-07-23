import { and, desc, eq, isNull } from 'drizzle-orm'
import {
  applicationScores,
  applicationWorkflowStates,
  applications,
  pursuitLinks,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'
import { deriveApplicationSnapshot } from '../applications/application.dto'
import { readPolicyConfig } from '../policy/policy.repository'
import type { JobWorkMode, PolicyConfig, PolicyReason, PursuitApplicationStatus } from '@sparxie/sdk'

export const actionQueueBuckets = [
  'apply_now',
  'manual_review_pickup',
  'needs_user_info',
  'stale_lock_recovery',
  'user_review_required',
  'blocked',
  'skip_below_cutoff',
] as const

export type ActionQueueBucket = (typeof actionQueueBuckets)[number]
export type NextAction = ActionQueueBucket

export interface ActionQueueListQuery {
  actionBucket?: ActionQueueBucket
  limit?: number
  offset?: number
}

export interface ActionQueueListItem {
  id: string
  companyName: string
  roleTitle: string
  sourceName: string
  status: PursuitApplicationStatus
  location: string
  workMode: JobWorkMode
  hasApplied: boolean
  currentPriorityScore: number | null
  currentPriorityBand: string | null
  primaryLink: {
    label: string
    url: string
  } | null
  createdAt: string
  updatedAt: string
  actionBucket: ActionQueueBucket
  nextAction: NextAction
  reason: string
  policyReasons: PolicyReason[]
}

export interface ActionQueueListResult {
  items: ActionQueueListItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  actionBucketCounts: Record<ActionQueueBucket, number>
}

interface ActionQueueRow {
  id: string
  companyName: string
  roleTitle: string
  sourceName: string
  status: string
  locationRaw: string | null
  city: string | null
  region: string | null
  country: string
  workMode: string
  hasApplied: boolean
  currentPriorityScore: number | null
  currentPriorityBand: string | null
  primaryLinkLabel: string | null
  primaryLinkUrl: string | null
  lockStartedAt: string | null
  holdStartedAt: string | null
  manualReviewKind: string | null
  missingUserInfo: string | null
  blockerReason: string | null
  createdAt: string
  updatedAt: string
}

const DEFAULT_ACTION_QUEUE_LIMIT = 50
const actionBucketOrder: Record<ActionQueueBucket, number> = {
  apply_now: 0,
  manual_review_pickup: 1,
  needs_user_info: 2,
  stale_lock_recovery: 3,
  user_review_required: 4,
  blocked: 5,
  skip_below_cutoff: 6,
}
const blockerStatuses = new Set([
  'manual_captcha',
  'security_gate',
  'login_needed',
  'platform_error',
  'closed',
  'not_fit',
  'not_pursued',
])

export function createPgliteActionQueueRepository(
  database: PgliteDatabase,
  options: {
    now?: () => Date
  } = {},
) {
  return {
    async listActionQueue(query: ActionQueueListQuery = {}): Promise<ActionQueueListResult> {
      const limit = query.limit ?? DEFAULT_ACTION_QUEUE_LIMIT
      const offset = query.offset ?? 0
      const policyConfig = await readPolicyConfig(database)
      const now = options.now?.() ?? new Date()
      // Explicit NULLS LAST: PG DESC defaults to NULLS FIRST; final public order is
      // compareActionQueueItems (bucket → score with null as -1 → updatedAt).
      const joinedRows = await database
        .select({
          application: applications,
          currentPriorityScore: applicationScores.score,
          currentPriorityBand: applicationScores.band,
          primaryLinkLabel: pursuitLinks.label,
          primaryLinkUrl: pursuitLinks.url,
          operationalStatus: applicationWorkflowStates.operationalStatus,
          hasApplied: applicationWorkflowStates.hasApplied,
          lockStartedAt: applicationWorkflowStates.lockStartedAt,
          holdStartedAt: applicationWorkflowStates.holdStartedAt,
          manualReviewKind: applicationWorkflowStates.manualReviewKind,
          missingUserInfo: applicationWorkflowStates.missingUserInfo,
          blockerReason: applicationWorkflowStates.blockerReason,
        })
        .from(applications)
        .leftJoin(
          pursuitLinks,
          and(
            eq(pursuitLinks.applicationId, applications.id),
            eq(pursuitLinks.isPrimary, true),
          ),
        )
        .leftJoin(
          applicationWorkflowStates,
          eq(applicationWorkflowStates.applicationId, applications.id),
        )
        .leftJoin(applicationScores, eq(applicationScores.applicationId, applications.id))
        .where(isNull(applications.removedAt))
        .orderBy(
          desc(applications.updatedAt),
          desc(applicationScores.createdAt),
          desc(applicationScores.id),
        )

      const rowsByApplication = new Map<string, ActionQueueRow>()
      for (const joined of joinedRows) {
        if (rowsByApplication.has(joined.application.id)) continue
        const snapshot = deriveApplicationSnapshot(joined.application)
        const location = snapshot.location
        rowsByApplication.set(joined.application.id, {
          id: joined.application.id,
          companyName: joined.application.companyName,
          roleTitle: snapshot.roleTitle,
          sourceName: joined.application.sourceName,
          status: joined.operationalStatus ?? defaultOperationalStatus(joined.application.status),
          locationRaw: location?.display ?? null,
          city: location?.city ?? null,
          region: location?.region ?? null,
          country: location?.country ?? 'Unknown',
          workMode: snapshot.workMode,
          hasApplied: joined.hasApplied ?? joined.application.status !== 'active',
          currentPriorityScore: joined.currentPriorityScore,
          currentPriorityBand: joined.currentPriorityBand,
          primaryLinkLabel: joined.primaryLinkLabel,
          primaryLinkUrl: joined.primaryLinkUrl,
          lockStartedAt: joined.lockStartedAt,
          holdStartedAt: joined.holdStartedAt,
          manualReviewKind: joined.manualReviewKind,
          missingUserInfo: joined.missingUserInfo,
          blockerReason: joined.blockerReason,
          createdAt: joined.application.createdAt,
          updatedAt: joined.application.updatedAt,
        })
      }
      const rows = [...rowsByApplication.values()]

      const actionQueueItems = rows
        .flatMap((row) => mapActionQueueRow(row, policyConfig, now))
        .sort(compareActionQueueItems)

      const actionBucketCounts = createEmptyBucketCounts()

      for (const item of actionQueueItems) {
        actionBucketCounts[item.actionBucket] += 1
      }

      const filteredItems = query.actionBucket
        ? actionQueueItems.filter((item) => item.actionBucket === query.actionBucket)
        : actionQueueItems
      const items = filteredItems.slice(offset, offset + limit)

      return {
        items,
        total: filteredItems.length,
        limit,
        offset,
        hasMore: offset + items.length < filteredItems.length,
        actionBucketCounts,
      }
    },
  }
}

function defaultOperationalStatus(status: string) {
  return status === 'active' ? 'queued' : status
}

function mapActionQueueRow(row: ActionQueueRow, policyConfig: PolicyConfig, now: Date): ActionQueueListItem[] {
  if (row.blockerReason) {
    const reason = prefixedSentence('Blocked', row.blockerReason)
    return [
      createActionQueueItem({
        row,
        actionBucket: 'blocked',
        reason,
        policyReasons: [{ code: 'workflow_blocker', message: reason }],
      }),
    ]
  }

  if (blockerStatuses.has(row.status)) {
    const reason = `Application status is ${row.status}.`
    return [
      createActionQueueItem({
        row,
        actionBucket: 'blocked',
        reason,
        policyReasons: [{ code: 'blocked_status', message: reason }],
      }),
    ]
  }

  if (row.missingUserInfo || row.status === 'needs_user_info') {
    const reason = row.missingUserInfo
      ? prefixedSentence('Missing user info', row.missingUserInfo)
      : 'Application needs user-specific information.'
    return [
      createActionQueueItem({
        row,
        actionBucket: 'needs_user_info',
        reason,
        policyReasons: [{ code: 'missing_user_info', message: reason }],
      }),
    ]
  }

  if (
    row.status === 'ready_for_review' &&
    row.manualReviewKind === 'overridable' &&
    isAtLeastHoursOld(row.holdStartedAt, policyConfig.manualReview.pickupDelayHours, now) &&
    isWithinPolicyWindow(now, policyConfig.manualReview.daytimeWindow)
  ) {
    const reason = `Manual review hold is overridable and eligible for pickup after ${policyConfig.manualReview.pickupDelayHours} hours.`
    return [
      createActionQueueItem({
        row,
        actionBucket: 'manual_review_pickup',
        reason,
        policyReasons: [{ code: 'manual_review_pickup_eligible', message: reason }],
      }),
    ]
  }

  if (row.status === 'ready_for_review' && row.manualReviewKind === 'non_overridable') {
    const reason = 'Manual review hold is non-overridable.'
    return [
      createActionQueueItem({
        row,
        actionBucket: 'user_review_required',
        reason,
        policyReasons: [{ code: 'manual_review_non_overridable', message: reason }],
      }),
    ]
  }

  if (
    row.status === 'in_progress' &&
    isAtLeastHoursOld(row.lockStartedAt, policyConfig.actionQueue.staleLockHours, now)
  ) {
    const reason = `In-progress lock is older than ${policyConfig.actionQueue.staleLockHours} hours.`
    return [
      createActionQueueItem({
        row,
        actionBucket: 'stale_lock_recovery',
        reason,
        policyReasons: [{ code: 'stale_lock', message: reason }],
      }),
    ]
  }

  if (row.status !== 'queued') {
    return []
  }

  if (row.currentPriorityScore === null) {
    const reason = 'Queued application has no priority score; record a score before applying.'
    return [
      createActionQueueItem({
        row,
        actionBucket: 'user_review_required',
        reason,
        policyReasons: [{ code: 'priority_score_missing', message: reason }],
      }),
    ]
  }

  if (row.currentPriorityScore < policyConfig.scoring.applyCutoff) {
    const reason = `Queued score ${row.currentPriorityScore} is below policy cutoff ${policyConfig.scoring.applyCutoff}.`
    return [
      createActionQueueItem({
        row,
        actionBucket: 'skip_below_cutoff',
        reason,
        policyReasons: [{ code: 'below_policy_cutoff', message: reason }],
      }),
    ]
  }

  const reason = `Queued score ${row.currentPriorityScore} meets policy cutoff ${policyConfig.scoring.applyCutoff}.`
  return [
    createActionQueueItem({
      row,
      actionBucket: 'apply_now',
      reason,
      policyReasons: [{ code: 'meets_policy_cutoff', message: reason }],
    }),
  ]
}

function createActionQueueItem({
  actionBucket,
  policyReasons,
  reason,
  row,
}: {
  actionBucket: ActionQueueBucket
  policyReasons: PolicyReason[]
  reason: string
  row: ActionQueueRow
}): ActionQueueListItem {
  return {
    id: row.id,
    companyName: row.companyName,
    roleTitle: row.roleTitle,
    sourceName: row.sourceName,
    status: row.status as PursuitApplicationStatus,
    location: row.locationRaw ?? [row.city, row.region, row.country].filter(Boolean).join(', '),
    workMode: row.workMode as JobWorkMode,
    hasApplied: row.hasApplied,
    currentPriorityScore: row.currentPriorityScore,
    currentPriorityBand: row.currentPriorityBand,
    primaryLink:
      row.primaryLinkLabel && row.primaryLinkUrl
        ? {
            label: row.primaryLinkLabel,
            url: row.primaryLinkUrl,
          }
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    actionBucket,
    nextAction: actionBucket,
    reason,
    policyReasons,
  }
}

function createEmptyBucketCounts(): Record<ActionQueueBucket, number> {
  return {
    apply_now: 0,
    manual_review_pickup: 0,
    needs_user_info: 0,
    stale_lock_recovery: 0,
    user_review_required: 0,
    blocked: 0,
    skip_below_cutoff: 0,
  }
}

function compareActionQueueItems(left: ActionQueueListItem, right: ActionQueueListItem) {
  const bucketComparison =
    actionBucketOrder[left.actionBucket] - actionBucketOrder[right.actionBucket]

  if (bucketComparison !== 0) {
    return bucketComparison
  }

  const leftScore = left.currentPriorityScore ?? -1
  const rightScore = right.currentPriorityScore ?? -1

  if (leftScore !== rightScore) {
    return rightScore - leftScore
  }

  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
}

function prefixedSentence(prefix: string, value: string) {
  const trimmedValue = value.trim()
  const terminalPunctuation = /[.!?]$/.test(trimmedValue)
  return `${prefix}: ${trimmedValue}${terminalPunctuation ? '' : '.'}`
}

function isAtLeastHoursOld(timestamp: string | null, hours: number, now: Date) {
  if (!timestamp) {
    return false
  }

  return now.getTime() - new Date(timestamp).getTime() >= hours * 60 * 60 * 1000
}

function isWithinPolicyWindow(
  now: Date,
  window: PolicyConfig['manualReview']['daytimeWindow'],
) {
  const minutes = minutesInTimezone(now, window.timezone)
  const start = parseTimeMinutes(window.start)
  const end = parseTimeMinutes(window.end)

  if (start <= end) {
    return minutes >= start && minutes <= end
  }

  return minutes >= start || minutes <= end
}

function minutesInTimezone(now: Date, timezone: string) {
  if (timezone === 'local') {
    return now.getHours() * 60 + now.getMinutes()
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    minute: 'numeric',
    timeZone: timezone,
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? now.getHours())
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? now.getMinutes())

  return hour * 60 + minute
}

function parseTimeMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)

  return hours * 60 + minutes
}
