import type { ApplicationsPreloadApi } from '../ipc/applications.preload'
import type { PolicyPreloadApi } from '../ipc/policy.preload'
import type { ProfilePreloadApi } from '../ipc/profile.preload'
import type { QueuePreloadApi } from '../ipc/queue.preload'
import type { SettingsPreloadApi } from '../ipc/settings.preload'
import type { ProfileSensitiveDetails } from '../modules/profile/profile.repository'
import type {
  ApplicationAttemptsListResult,
  ApplicationDetail,
  ApplicationEventsListInput,
  ApplicationEventsListResult,
  ApplicationLinksListInput,
  ApplicationLinksListResult,
  AppendApplicationNoteInput,
  ArchiveApplicationInput,
  CreateApplicationInput,
  CreateApplicationLinkInput,
  ApplicationListQuery,
  ApplicationListResult,
  StatusUpdateInput,
  UpdateApplicationInput,
  UpdateApplicationLinkInput,
  UpdateApplicationWorkflowInput,
} from '../modules/applications/application.types'
import {
  defaultUserProfile,
  defaultPolicyConfig,
  type PromoteSourcingFindingInput,
  type CreateSourcingFindingInput,
  type QueueListQuery,
  type QueueListResult,
  type ScoreInput,
  type SetSourcingFindingDecisionInput,
  type SourcingFinding,
  type SourcingFindingsListInput,
  type SourcingFindingsListResult,
  type UpdateSourcingFindingInput,
} from 'sparxie'
import { defaultAppSettings, normalizeAppSettings } from '../settings/app-settings'
import { PAGE_LIMIT } from './types'

export const emptyApplicationResult: ApplicationListResult = {
  items: [],
  total: 0,
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
}

export const emptyQueueResult: QueueListResult = {
  items: [],
  total: 0,
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
  bucketCounts: {
    apply_now: 0,
    manual_review_pickup: 0,
    needs_user_info: 0,
    stale_lock_recovery: 0,
    user_review_required: 0,
    blocked: 0,
    skip_below_cutoff: 0,
  },
}

export const emptySourcingResult: SourcingFindingsListResult = {
  items: [],
  total: 0,
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
}

export const emptyAttemptResult: ApplicationAttemptsListResult = {
  items: [],
  total: 0,
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
}

export const emptyApplicationLinksResult: ApplicationLinksListResult = {
  items: [],
  total: 0,
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
}

export const emptyApplicationEventsResult: ApplicationEventsListResult = {
  items: [],
  total: 0,
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
}

export const defaultApplicationLoader = (query: ApplicationListQuery) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.list(query) ?? Promise.resolve(emptyApplicationResult)
}

export const defaultApplicationDetailLoader = (applicationId: string): Promise<ApplicationDetail | null> => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.get(applicationId) ?? Promise.resolve(null)
}

export const defaultApplicationLinksLoader = (input: ApplicationLinksListInput) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.links?.list(input) ??
    Promise.resolve(emptyApplicationLinksResult)
  )
}

export const defaultApplicationEventsLoader = (input: ApplicationEventsListInput) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.events?.list(input) ??
    Promise.resolve(emptyApplicationEventsResult)
  )
}

export const defaultAttemptLoader = (applicationId: string) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.attempts?.list({ applicationId }) ??
    Promise.resolve(emptyAttemptResult)
  )
}

export const defaultApplicationCreator = (input: CreateApplicationInput) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.create(input) ?? Promise.reject(new Error('Applications API is unavailable.'))
}

export const defaultApplicationUpdater = (input: UpdateApplicationInput) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.update(input) ?? Promise.reject(new Error('Applications API is unavailable.'))
}

export const defaultApplicationStatusUpdater = (input: StatusUpdateInput) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.updateStatus(input) ?? Promise.reject(new Error('Applications API is unavailable.'))
}

export const defaultApplicationArchiver = (input: ArchiveApplicationInput) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.archive(input) ?? Promise.reject(new Error('Applications API is unavailable.'))
}

export const defaultApplicationWorkflowUpdater = (input: UpdateApplicationWorkflowInput) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.workflow.update(input) ??
    Promise.reject(new Error('Applications API is unavailable.'))
  )
}

export const defaultApplicationNoteAppender = (input: AppendApplicationNoteInput) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.notes.append(input) ??
    Promise.reject(new Error('Applications API is unavailable.'))
  )
}

export const defaultApplicationLinkCreator = (input: CreateApplicationLinkInput) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.links.create(input) ??
    Promise.reject(new Error('Applications API is unavailable.'))
  )
}

export const defaultApplicationLinkUpdater = (input: UpdateApplicationLinkInput) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.links.update(input) ??
    Promise.reject(new Error('Applications API is unavailable.'))
  )
}

export const defaultQueueLoader = (query: QueueListQuery) => {
  const queueWindow = window as Window & { queue?: QueuePreloadApi }

  return queueWindow.queue?.list(query) ?? Promise.resolve(emptyQueueResult)
}

export const defaultSourcingLoader = (query: SourcingFindingsListInput) => {
  const sourcingWindow = window as Window & {
    sourcing?: { findings?: { list(query: SourcingFindingsListInput): Promise<SourcingFindingsListResult> } }
  }

  return sourcingWindow.sourcing?.findings?.list(query) ?? Promise.resolve(emptySourcingResult)
}

export const defaultPromoteSourcingFinding = (input: PromoteSourcingFindingInput) => {
  const sourcingWindow = window as Window & {
    sourcing?: { findings?: { promote(input: PromoteSourcingFindingInput): Promise<SourcingFinding> } }
  }

  return sourcingWindow.sourcing?.findings?.promote(input) ?? Promise.reject(new Error('Sourcing API is unavailable.'))
}

export const defaultCreateSourcingFinding = (input: CreateSourcingFindingInput) => {
  const sourcingWindow = window as Window & {
    sourcing?: { findings?: { create(input: CreateSourcingFindingInput): Promise<SourcingFinding> } }
  }

  return sourcingWindow.sourcing?.findings?.create(input) ?? Promise.reject(new Error('Sourcing API is unavailable.'))
}

export const defaultUpdateSourcingFinding = (input: UpdateSourcingFindingInput) => {
  const sourcingWindow = window as Window & {
    sourcing?: { findings?: { update(input: UpdateSourcingFindingInput): Promise<SourcingFinding> } }
  }

  return sourcingWindow.sourcing?.findings?.update(input) ?? Promise.reject(new Error('Sourcing API is unavailable.'))
}

export const defaultDecideSourcingFinding = (input: SetSourcingFindingDecisionInput) => {
  const sourcingWindow = window as Window & {
    sourcing?: { findings?: { decide(input: SetSourcingFindingDecisionInput): Promise<SourcingFinding> } }
  }

  return sourcingWindow.sourcing?.findings?.decide(input) ?? Promise.reject(new Error('Sourcing API is unavailable.'))
}

export const defaultScoreRecorder = (input: ScoreInput) => {
  const scoresWindow = window as Window & {
    scores?: { record(input: ScoreInput): Promise<void> }
  }

  return scoresWindow.scores?.record(input) ?? Promise.reject(new Error('Scores API is unavailable.'))
}

function getWindowSettingsApi() {
  return (window as Window & { settings?: SettingsPreloadApi }).settings
}

function getWindowPolicyApi() {
  return (window as Window & { policy?: PolicyPreloadApi }).policy
}

function getWindowProfileApi() {
  return (window as Window & { profile?: ProfilePreloadApi }).profile
}

export const defaultSettingsApi: SettingsPreloadApi = {
  get() {
    return getWindowSettingsApi()?.get() ?? Promise.resolve(defaultAppSettings)
  },
  reset() {
    return getWindowSettingsApi()?.reset() ?? Promise.resolve(defaultAppSettings)
  },
  update(patch) {
    return (
      getWindowSettingsApi()?.update(patch) ??
      Promise.resolve(normalizeAppSettings({ ...defaultAppSettings, ...patch }))
    )
  },
}

export const defaultPolicyApi: PolicyPreloadApi = {
  config: {
    get() {
      return getWindowPolicyApi()?.config.get() ?? Promise.resolve(defaultPolicyConfig)
    },
    reset() {
      return getWindowPolicyApi()?.config.reset() ?? Promise.resolve(defaultPolicyConfig)
    },
    update(patch) {
      return getWindowPolicyApi()?.config.update(patch) ?? Promise.resolve(defaultPolicyConfig)
    },
  },
  evidence: {
    list(query) {
      return getWindowPolicyApi()?.evidence.list(query) ?? Promise.resolve([])
    },
    record(input) {
      return (
        getWindowPolicyApi()?.evidence.record(input) ??
        Promise.resolve({
          id: 'local-policy-evidence',
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          tag: input.tag,
          source: input.source ?? 'agent',
          note: input.note ?? null,
          payloadJson: JSON.stringify(input.payload ?? {}),
          createdAt: new Date().toISOString(),
        })
      )
    },
  },
  evaluate: {
    application(input) {
      return (
        getWindowPolicyApi()?.evaluate.application(input) ??
        Promise.resolve({
          action: 'allow_outcome',
          configVersion: 1,
          reasons: [],
          requiredEvidence: [],
          status: 'allow',
          tags: [],
        })
      )
    },
    sourcingCandidate(input) {
      return (
        getWindowPolicyApi()?.evaluate.sourcingCandidate(input) ??
        Promise.resolve({
          action: 'promote_sourcing_candidate',
          configVersion: 1,
          reasons: [],
          requiredEvidence: [],
          status: 'allow',
          tags: [],
        })
      )
    },
    runWindow(input) {
      const now = input.now ?? new Date().toISOString()

      return (
        getWindowPolicyApi()?.evaluate.runWindow(input) ??
        Promise.resolve({
          action: 'recommend_run_window',
          cadenceHours: defaultPolicyConfig.sourcing.weekdayNormalCadenceHours,
          configVersion: 1,
          overlapMinutes: defaultPolicyConfig.sourcing.overlapMinutes,
          reasons: [],
          recommendedCoverageEndedAt: now,
          recommendedCoverageStartedAt: now,
          requiredEvidence: [],
          status: 'allow',
          tags: [],
          timezone: input.timezone ?? defaultPolicyConfig.sourcing.timezone,
        })
      )
    },
  },
}

export const defaultProfileApi: ProfilePreloadApi = {
  agentContext: {
    get() {
      return getWindowProfileApi()?.agentContext.get() ?? Promise.resolve({ answers: [], basics: {} })
    },
  },
  get() {
    return getWindowProfileApi()?.get() ?? Promise.resolve(defaultUserProfile)
  },
  sensitive: {
    get() {
      return getWindowProfileApi()?.sensitive.get() ?? Promise.resolve(defaultSensitiveDetails)
    },
    update(input) {
      return (
        getWindowProfileApi()?.sensitive.update(input) ??
        Promise.resolve({ ...defaultSensitiveDetails, ...input })
      )
    },
  },
  secrets: {
    delete(key) {
      return getWindowProfileApi()?.secrets.delete(key) ?? Promise.resolve()
    },
    list() {
      return getWindowProfileApi()?.secrets.list() ?? Promise.resolve([])
    },
    reveal(key) {
      return getWindowProfileApi()?.secrets.reveal(key) ?? Promise.resolve(null)
    },
    upsert(input) {
      return (
        getWindowProfileApi()?.secrets.upsert(input) ??
        Promise.resolve({
          key: input.key,
          kind: input.kind,
          label: input.label,
          updatedAt: new Date().toISOString(),
        })
      )
    },
  },
  update(input) {
    return getWindowProfileApi()?.update(input) ?? Promise.resolve({ ...defaultUserProfile, ...input })
  },
}

const defaultSensitiveDetails: ProfileSensitiveDetails = {
  birthDay: null,
  birthMonth: null,
  birthYear: null,
  disabilityStatus: null,
  gender: null,
  hispanicLatino: null,
  raceEthnicity: null,
  ssnLast4: null,
  veteranStatus: null,
}
