import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { ConnectorsPreloadApi } from './ipc/connectors.preload'
import type { UpdatesPreloadApi, UpdateState } from './ipc/updates.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import type { ProfilePreloadApi } from './ipc/profile.preload'
import type { PolicyPreloadApi } from './ipc/policy.preload'
import type { ConnectorStatusListResult, ConnectorStatusView } from './modules/connectors/connector.status'
import { defaultEarliestBackfillDate } from './modules/connectors/connector.earliest-backfill'
import type {
  LocalConnectorReconnectActionResult,
  LocalConnectorStatusActionInput,
} from './runtime/local-valedictorian-client'
import type { WorkspaceSummary } from './workspace/workspace.initializer'
import type {
  ApplicationAttempt,
  ApplicationAttemptsListResult,
  ApplicationDetail,
  ApplicationEvent,
  ApplicationEventsListResult,
  ApplicationLinkRecord,
  ApplicationLinksListResult,
  ApplicationListItem,
  ApplicationListResult,
} from './modules/applications/application.types'
import type { ActionQueueListItem, ActionQueueListResult } from './modules/action-queue/action-queue.repository'
import type { ProfileSensitiveDetails } from './modules/profile/profile.repository'
import {
  defaultPolicyConfig,
  defaultUserProfile,
  normalizePolicyConfig,
  type PolicyConfig,
  type PolicyConfigPatch,
  type PolicyDecision,
  type PolicyEvidenceRecord,
  type PolicyRunWindowDecision,
  type SourcingFinding,
  type SourcingFindingsListResult,
} from 'sparxie'
import {
  defaultAppSettings,
  type AppSettings,
  type AppSettingsPatch,
} from './settings/app-settings'

export function createApplication(
  overrides: Partial<ApplicationListItem> = {},
): ApplicationListItem {
  return {
    id: 'application-1',
    companyName: 'Astranis Space Technologies',
    roleTitle: 'Software Engineer- Backend Intern (Fall 2026)',
    roleKind: 'internship',
    sourceName: 'LinkedIn',
    status: 'needs_user_info',
    term: 'Fall 2026 internship',
    terms: [{ season: 'fall', year: 2026 }],
    timingMode: 'terms',
    startDate: null,
    endDate: null,
    location: 'San Francisco, CA / Onsite',
    workMode: 'onsite',
    hasApplied: false,
    currentPriorityScore: 8,
    currentPriorityBand: 'high',
    primaryLink: {
      label: 'official',
      url: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
    },
    notes: 'Needs availability answers.',
    createdAt: '2026-06-04T16:00:00.000Z',
    updatedAt: '2026-06-04T16:00:00.000Z',
    ...overrides,
  }
}

export function createApplicationDetail(
  overrides: Partial<ApplicationDetail> = {},
): ApplicationDetail {
  return {
    ...createApplication(),
    ...overrides,
  }
}

export function createListResult(items: ApplicationListItem[]): ApplicationListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

export function createLinksResult(
  items: ApplicationLinkRecord[] = [
    {
      id: 'link-official',
      applicationId: 'application-1',
      kind: 'official',
      label: 'official',
      url: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
      externalId: null,
      isPrimary: true,
      discoveredAt: '2026-06-04T16:00:00.000Z',
      createdAt: '2026-06-04T16:00:00.000Z',
      updatedAt: '2026-06-04T16:00:00.000Z',
      deletedAt: null,
    },
    {
      id: 'link-source',
      applicationId: 'application-1',
      kind: 'source',
      label: 'source',
      url: 'https://linkedin.com/jobs/astranis',
      externalId: null,
      isPrimary: false,
      discoveredAt: '2026-06-04T16:00:00.000Z',
      createdAt: '2026-06-04T16:00:00.000Z',
      updatedAt: '2026-06-04T16:00:00.000Z',
      deletedAt: null,
    },
  ],
): ApplicationLinksListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

export function createEventsResult(
  items: ApplicationEvent[] = [
    {
      id: 'event-1',
      applicationId: 'application-1',
      type: 'application_created',
      message: 'Application created from sourcing.',
      payloadJson: '{}',
      actor: 'agent:codex',
      createdAt: '2026-06-04T16:00:00.000Z',
    },
  ],
): ApplicationEventsListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

export function createAttemptResult(
  items: ApplicationAttempt[] = [
    {
      id: 'attempt-1',
      applicationId: 'application-1',
      status: 'completed',
      outcome: 'needs_user_info',
      actorType: 'agent',
      actorName: 'codex',
      entryUrl: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
      resumeVariant: 'bachelor_dec_2027',
      resumeArtifactPath: 'tailored_resumes/versant/resume.pdf',
      summary: 'Needs exact availability dates.',
      stopReason: null,
      confirmationUrl: null,
      confirmationText: null,
      startedAt: '2026-06-04T16:00:00.000Z',
      completedAt: '2026-06-04T16:05:00.000Z',
      createdAt: '2026-06-04T16:00:00.000Z',
      updatedAt: '2026-06-04T16:05:00.000Z',
      steps: [
        {
          id: 'step-1',
          attemptId: 'attempt-1',
          applicationId: 'application-1',
          sequence: 1,
          type: 'attempt_started',
          message: 'Started SmartRecruiters application.',
          payloadJson: '{}',
          actor: 'agent:codex',
          createdAt: '2026-06-04T16:00:00.000Z',
        },
        {
          id: 'step-2',
          attemptId: 'attempt-1',
          applicationId: 'application-1',
          sequence: 2,
          type: 'resume_uploaded',
          message: 'Uploaded tailored resume.',
          payloadJson: '{}',
          actor: 'agent:codex',
          createdAt: '2026-06-04T16:02:00.000Z',
        },
      ],
    },
  ],
): ApplicationAttemptsListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

export function createActionQueueItem(overrides: Partial<ActionQueueListItem> = {}): ActionQueueListItem {
  return {
    id: 'application-versant-platform',
    companyName: 'Versant Media',
    roleTitle: 'Academic Year Internships: Platform Engineering',
    sourceName: 'LinkedIn',
    status: 'queued',
    location: 'Universal City, CA / Remote',
    workMode: 'remote',
    hasApplied: false,
    currentPriorityScore: 6,
    currentPriorityBand: 'medium',
    primaryLink: {
      label: 'official',
      url: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
    },
    createdAt: '2026-06-04T16:00:00.000Z',
    updatedAt: '2026-06-04T16:00:00.000Z',
    actionBucket: 'apply_now',
    nextAction: 'apply_now',
    reason: 'Queued score 6 meets policy cutoff 6.',
    policyReasons: [{ code: 'meets_policy_cutoff', message: 'Queued score 6 meets policy cutoff 6.' }],
    ...overrides,
  }
}

export function createActionQueueResult(items: ActionQueueListItem[]): ActionQueueListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
    actionBucketCounts: {
      apply_now: items.filter((item) => item.actionBucket === 'apply_now').length,
      manual_review_pickup: items.filter((item) => item.actionBucket === 'manual_review_pickup').length,
      needs_user_info: items.filter((item) => item.actionBucket === 'needs_user_info').length,
      stale_lock_recovery: items.filter((item) => item.actionBucket === 'stale_lock_recovery').length,
      user_review_required: items.filter((item) => item.actionBucket === 'user_review_required').length,
      blocked: items.filter((item) => item.actionBucket === 'blocked').length,
      skip_below_cutoff: items.filter((item) => item.actionBucket === 'skip_below_cutoff').length,
    },
  }
}

export function createConnectorStatusView(
  overrides: Partial<ConnectorStatusView> = {},
): ConnectorStatusView {
  return {
    actionLabel: 'Reconnect',
    actions: [
      {
        id: 'reconnect',
        label: 'Reconnect',
      },
      {
        id: 'skip',
        label: 'Skip this run',
      },
    ],
    connectorId: 'fixture.jobs',
    displayName: 'Fixture Jobs',
    enabled: true,
    id: 'connector-instance-fixture',
    lastRunAt: '2026-07-08T17:00:01.000Z',
    latestRunId: 'connector-run-1',
    nextAttemptAt: null,
    observationCount: 0,
    severity: 'blocked',
    status: 'auth_required',
    statusLabel: 'Auth required',
    summary: 'Reconnect the connector session to continue refreshes.',
    warningCount: 1,
    warnings: [
      {
        code: 'auth.expired_session',
        label: 'Expired session',
        message: 'Expired browser [redacted].',
        severity: 'blocked',
      },
    ],
    ...overrides,
  }
}

export function createConnectorStatusResult(
  items: ConnectorStatusView[] = [createConnectorStatusView()],
): ConnectorStatusListResult {
  return {
    available: true,
    items,
  }
}

export function createConnectorsApi(): ConnectorsPreloadApi {
  type ConnectorInstance = Awaited<ReturnType<ConnectorsPreloadApi['list']>>['items'][number]
  type CreateConnectorInput = Parameters<ConnectorsPreloadApi['create']>[0]
  type UpdateConnectorInput = Parameters<ConnectorsPreloadApi['update']>[0]
  let instances: ConnectorInstance[] = []

  return {
    list: vi.fn(async () => ({ items: instances })),
    create: vi.fn(async (input: CreateConnectorInput) => {
      const now = '2026-07-09T15:00:00.000Z'
      const instance: ConnectorInstance = {
        id: input.id,
        connectorId: input.connectorId,
        connectorVersion: input.connectorVersion,
        displayName: input.displayName,
        enabled: input.enabled,
        lifecycle: input.enabled ? 'enabled' : 'disabled',
        auth: (input.auth ?? []).map((auth) => ({
          id: auth.id,
          mode: auth.mode,
          label: auth.label ?? null,
          configured: auth.mode === 'none' || Boolean(auth.secretKey),
        })),
        config: input.config ?? {},
        filters: input.filters ?? {},
        earliestBackfillDate: input.earliestBackfillDate
          ?? defaultEarliestBackfillDate(now),
        createdAt: now,
        updatedAt: now,
      }
      instances = [...instances.filter((item) => item.id !== instance.id), instance]
      return instance
    }),
    update: vi.fn(async (input: UpdateConnectorInput) => {
      const existing = instances.find((instance) => instance.id === input.connectorInstanceId)

      if (!existing) {
        throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
      }

      const updated: ConnectorInstance = {
        ...existing,
        auth: input.auth
          ? input.auth.map((auth) => ({
            id: auth.id,
            mode: auth.mode,
            label: auth.label ?? null,
            configured: auth.mode === 'none' || Boolean(auth.secretKey),
          }))
          : existing.auth,
        config: input.config ?? existing.config,
        connectorVersion: input.connectorVersion ?? existing.connectorVersion,
        displayName: input.displayName ?? existing.displayName,
        enabled: input.enabled ?? existing.enabled,
        lifecycle: (input.enabled ?? existing.enabled) ? 'enabled' : 'disabled',
        filters: input.filters ?? existing.filters,
        earliestBackfillDate: input.earliestBackfillDate ?? existing.earliestBackfillDate,
        updatedAt: '2026-07-09T15:01:00.000Z',
      }
      instances = instances.map((instance) => instance.id === updated.id ? updated : instance)
      return updated
    }),
    remove: vi.fn(async ({ connectorInstanceId }) => {
      instances = instances.filter((instance) => instance.id !== connectorInstanceId)
      return {
        connectorInstanceId,
        lifecycle: 'retired',
        retiredAt: '2026-07-09T15:03:00.000Z',
        requirements: {
          connectorImplementation: 'not_required',
          authenticationValidation: 'not_required',
        },
        disposition: {
          configuration: 'removed', schedule: 'removed', checkpoints: 'preserved',
          executionScopes: 'preserved', futureExecution: 'blocked', authReferences: 'removed',
          secretValues: 'preserved_for_workspace_secret_administration',
        },
        preservedLineage: {
          connectorRuns: true, rawSourceRecords: true, normalizationAttempts: true,
          canonicalCandidates: true, sourcingFindings: true,
        },
      } as const
    }),
    inspect: vi.fn(),
    runs: {
      list: vi.fn(async (input) => ({
        hasMore: false,
        items: [],
        limit: input.limit ?? 50,
        offset: input.offset ?? 0,
        total: 0,
      })),
      trigger: vi.fn(async (input) => ({
        id: 'connector-run-1',
        connectorInstanceId: input.connectorInstanceId,
        executionScopeId: 'scope_fixture_connector_run',
        mode: 'manual' as const,
        scheduleOccurrence: null,
        status: 'completed' as const,
        coverage: {
          start: input.coverageStartedAt ?? null,
          end: input.coverageEndedAt ?? null,
        },
        filterSignature: 'filters:{}',
        observationCount: 1,
        warningCount: 0,
        newestFrontier: { state: 'caught_up' as const },
        historicalBackfill: { state: 'caught_up' as const, boundary: { earliestDate: '2026-07-01' } },
        pendingResolutionCount: 0,
        outcome: { kind: 'caught_up' as const },
        stats: {
          observations: 1,
        },
        warnings: [],
        retryHints: null,
        startedAt: '2026-07-09T15:02:00.000Z',
        completedAt: '2026-07-09T15:02:01.000Z',
      })),
    },
    status: {
      reconnect: vi.fn(async (
        input: LocalConnectorStatusActionInput,
      ): Promise<LocalConnectorReconnectActionResult> => ({
        action: 'reconnect',
        connectorInstanceId: input.connectorInstanceId,
        grants: [{ id: 'jobright', mode: 'username_password', status: 'ready' }],
        message: 'Connector credentials are verified and ready.',
        reason: 'jobright_auth_ready',
        status: 'ready',
      })),
      skip: vi.fn(),
    },
  }
}

type LegacySourcingFinding = SourcingFinding & {
  rawRevisionId?: never
  canonicalCandidateId?: never
  destination?: never
  employmentType?: never
  seniority?: never
  location?: never
  compensation?: never
  postedAt?: never
}

export function createSourcingFinding(
  overrides: Partial<LegacySourcingFinding> = {},
): LegacySourcingFinding {
  return {
    id: 'finding-1',
    workflowRunId: 'run-1',
    sourceId: 'source-linkedin',
    sourceName: 'LinkedIn',
    companyName: 'Delta Labs',
    roleTitle: 'Software Engineering Intern',
    roleKind: 'internship',
    term: 'Fall 2026',
    terms: [{ season: 'fall', year: 2026 }],
    timingMode: 'terms',
    startDate: null,
    endDate: null,
    city: null,
    region: null,
    country: 'US',
    workMode: 'remote',
    locationRaw: 'Remote',
    officialUrl: 'https://jobs.example.com/delta',
    sourceUrl: 'https://linkedin.com/jobs/delta',
    postedAge: '2d',
    priorityScore: 7,
    priorityBand: 'high',
    fitNotes: 'Good backend internship fit.',
    duplicateNotes: null,
    blocker: null,
    policyBlocker: null,
    dispositionReason: null,
    mergeStatus: 'new',
    mergedApplicationId: null,
    mergedApplicationCompanyName: null,
    mergedApplicationRoleTitle: null,
    mergeNotes: null,
    discoveredAt: '2026-06-04T16:00:00.000Z',
    createdAt: '2026-06-04T16:00:00.000Z',
    updatedAt: '2026-06-04T16:00:00.000Z',
    ...overrides,
  }
}

export function createSourcingResult(items: SourcingFinding[]): SourcingFindingsListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

export async function openSettingsPage() {
  await screen.findByRole('table', { name: 'Applications' })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
}

export function selectComboboxOption(label: string, optionName: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  fireEvent.click(screen.getByRole('option', { name: optionName }))
}

export function stubCmdkEnvironment() {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  HTMLElement.prototype.scrollIntoView = vi.fn()
}

export function createSettingsApi(overrides: Partial<AppSettings> = {}): SettingsPreloadApi {
  let currentSettings: AppSettings = {
    ...defaultAppSettings,
    ...overrides,
  }

  return {
    get: vi.fn(async () => currentSettings),
    reset: vi.fn(async () => {
      currentSettings = { ...defaultAppSettings }
      return currentSettings
    }),
    update: vi.fn(async (patch: AppSettingsPatch) => {
      currentSettings = {
        ...currentSettings,
        ...patch,
      }

      return currentSettings
    }),
  }
}

export type TestUpdatesApi = UpdatesPreloadApi & {
  emitState: (state: UpdateState) => void
}

export function createUpdatesApi(initialState: UpdateState): TestUpdatesApi {
  let state = initialState
  const listeners = new Set<(state: UpdateState) => void>()

  return {
    check: vi.fn(async () => state),
    emitState(nextState) {
      state = nextState

      for (const listener of listeners) {
        listener(state)
      }
    },
    getState: vi.fn(async () => state),
    install: vi.fn(async () => undefined),
    onStateChanged: vi.fn((listener: (state: UpdateState) => void) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    }),
  }
}

export function createWorkspaceSummary(
  overrides: Partial<WorkspaceSummary> = {},
): WorkspaceSummary {
  return {
    id: 'workspace-1',
    name: 'Job Search',
    rootPath: '/Users/keni/Job Search',
    dataPath: '/Users/keni/Job Search/.valedictorian',
    manifestPath: '/Users/keni/Job Search/.valedictorian/manifest.json',
    appSettingsPath: '/Users/keni/Job Search/.valedictorian/app.json',
    sqlitePath: '/Users/keni/Job Search/.valedictorian/valedictorian.sqlite',
    automationsPath: '/Users/keni/Job Search/.valedictorian/automations',
    promptsPath: '/Users/keni/Job Search/.valedictorian/prompts',
    templatesPath: '/Users/keni/Job Search/.valedictorian/templates',
    notesPath: '/Users/keni/Job Search/.valedictorian/notes',
    ...overrides,
  }
}

export function createWorkspaceApi(
  currentWorkspace: WorkspaceSummary | null = createWorkspaceSummary(),
): WorkspacePreloadApi {
  const activeLaunchState = currentWorkspace
    ? {
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'active' as const,
        workspace: currentWorkspace,
      }
    : {
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'needs-workspace' as const,
      }

  return {
    chooseCreateParentFolder: vi.fn(async () => null),
    chooseFolder: vi.fn(async () => currentWorkspace),
    createWorkspace: vi.fn(async () => activeLaunchState),
    getCurrent: vi.fn(async () => currentWorkspace),
    getLaunchState: vi.fn(async () => activeLaunchState),
    listRecent: vi.fn(async () => (currentWorkspace ? [
      {
        id: currentWorkspace.id,
        name: currentWorkspace.name,
        path: currentWorkspace.rootPath,
        lastOpenedAt: '2026-06-08T12:00:00.000Z',
        open: true,
      },
    ] : [])),
    openFolder: vi.fn(async () => activeLaunchState),
    openRecent: vi.fn(async () => activeLaunchState),
    removeRecent: vi.fn(async () => ({
      devOptions: {
        canSeedSampleData: false,
      },
      recentWorkspaces: [],
      status: 'needs-workspace' as const,
    })),
    reveal: vi.fn(async () => undefined),
    revealCurrent: vi.fn(async () => undefined),
  }
}

export function createPolicyApi(initialConfig: PolicyConfig = defaultPolicyConfig): PolicyPreloadApi {
  let currentConfig = clonePolicyConfig(initialConfig)
  let evidenceRecords: PolicyEvidenceRecord[] = []
  const allowDecision: PolicyDecision = {
    action: 'allow',
    configVersion: 2,
    reasons: [],
    requiredEvidence: [],
    status: 'allow',
    tags: [],
  }
  const runWindowDecision: PolicyRunWindowDecision = {
    ...allowDecision,
    cadenceHours: currentConfig.sourcing.weekdayNormalCadenceHours,
    overlapMinutes: currentConfig.sourcing.overlapMinutes,
    recommendedCoverageStartedAt: '2026-06-08T12:00:00.000Z',
    recommendedCoverageEndedAt: '2026-06-08T13:00:00.000Z',
    timezone: currentConfig.sourcing.timezone,
  }

  return {
    config: {
      get: vi.fn(async () => clonePolicyConfig(currentConfig)),
      reset: vi.fn(async () => {
        currentConfig = clonePolicyConfig(defaultPolicyConfig)
        return clonePolicyConfig(currentConfig)
      }),
      update: vi.fn(async (patch: PolicyConfigPatch) => {
        currentConfig = mergePolicyConfig(currentConfig, patch)
        return clonePolicyConfig(currentConfig)
      }),
    },
    evidence: {
      list: vi.fn(async (query) => {
        const limit = query?.limit ?? evidenceRecords.length
        const offset = query?.offset ?? 0
        return evidenceRecords
          .filter((record) => (query?.subjectType ? record.subjectType === query.subjectType : true))
          .filter((record) => (query?.subjectId ? record.subjectId === query.subjectId : true))
          .filter((record) => (query?.tag ? record.tag === query.tag : true))
          .slice(offset, offset + limit)
      }),
      record: vi.fn(async (input) => {
        const record: PolicyEvidenceRecord = {
          id: `evidence-${evidenceRecords.length + 1}`,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          tag: input.tag,
          source: input.source ?? 'test',
          note: input.note ?? null,
          payloadJson: JSON.stringify(input.payload ?? {}),
          createdAt: '2026-06-08T12:00:00.000Z',
        }
        evidenceRecords = [record, ...evidenceRecords]
        return record
      }),
    },
    evaluate: {
      application: vi.fn(async () => allowDecision),
      runWindow: vi.fn(async () => runWindowDecision),
      sourcingCandidate: vi.fn(async () => allowDecision),
    },
  }
}

export function createProfileApi(): ProfilePreloadApi {
  let currentProfile = { ...defaultUserProfile }
  let currentSensitiveDetails: ProfileSensitiveDetails = {
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
  let secrets: Array<{
    key: string
    kind: 'password' | 'token' | 'identity' | 'other'
    label: string
    updatedAt: string
    value: string
  }> = []

  return {
    agentContext: {
      get: vi.fn(async () => ({ answers: [], basics: {}, education: [] })),
    },
    get: vi.fn(async () => currentProfile),
    sensitive: {
      get: vi.fn(async () => currentSensitiveDetails),
      update: vi.fn(async (input) => {
        currentSensitiveDetails = {
          ...currentSensitiveDetails,
          ...input,
        }

        return currentSensitiveDetails
      }),
    },
    secrets: {
      delete: vi.fn(async (key: string) => {
        secrets = secrets.filter((secret) => secret.key !== key)
      }),
      list: vi.fn(async () =>
        secrets.map((secret) => ({
          key: secret.key,
          kind: secret.kind,
          label: secret.label,
          updatedAt: secret.updatedAt,
        })),
      ),
      upsert: vi.fn(async (input) => {
        const nextSecret = {
          ...input,
          updatedAt: '2026-06-06T12:00:00.000Z',
        }
        secrets = [...secrets.filter((secret) => secret.key !== input.key), nextSecret]
        return {
          key: nextSecret.key,
          kind: nextSecret.kind,
          label: nextSecret.label,
          updatedAt: nextSecret.updatedAt,
        }
      }),
    },
    update: vi.fn(async (patch) => {
      currentProfile = {
        ...currentProfile,
        ...patch,
        answers: patch.answers ?? currentProfile.answers,
        education: patch.education ?? currentProfile.education,
      }
      return currentProfile
    }),
  }
}

function clonePolicyConfig(config: PolicyConfig): PolicyConfig {
  return JSON.parse(JSON.stringify(config)) as PolicyConfig
}

function mergePolicyConfig(currentConfig: PolicyConfig, patch: PolicyConfigPatch): PolicyConfig {
  return normalizePolicyConfig({
    ...currentConfig,
    ...patch,
    manualReview: {
      ...currentConfig.manualReview,
      ...patch.manualReview,
      daytimeWindow: {
        ...currentConfig.manualReview.daytimeWindow,
        ...patch.manualReview?.daytimeWindow,
      },
    },
    officialPath: {
      ...currentConfig.officialPath,
      ...patch.officialPath,
    },
    actionQueue: {
      ...currentConfig.actionQueue,
      ...patch.actionQueue,
    },
    retries: {
      ...currentConfig.retries,
      ...patch.retries,
    },
    scoring: {
      ...currentConfig.scoring,
      ...patch.scoring,
    },
    sourcing: {
      ...currentConfig.sourcing,
      ...patch.sourcing,
    },
    verification: {
      ...currentConfig.verification,
      ...patch.verification,
    },
  })
}
