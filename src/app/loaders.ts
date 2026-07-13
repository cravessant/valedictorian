import type { ApplicationsPreloadApi } from '../ipc/applications.preload'
import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'
import type { ConnectorSkipActionResult } from '../ipc/connectors.public'
import type { PolicyPreloadApi } from '../ipc/policy.preload'
import type { ProfilePreloadApi } from '../ipc/profile.preload'
import type { ActionQueuePreloadApi } from '../ipc/action-queue.preload'
import type { ScoresPreloadApi } from '../ipc/scores.preload'
import type { SettingsPreloadApi } from '../ipc/settings.preload'
import type { UpdatesPreloadApi } from '../ipc/updates.preload'
import type { WorkspacePreloadApi } from '../ipc/workspace.preload'
import type { ProfileSensitiveDetails } from '../modules/profile/profile.repository'
import type { ConnectorStatusListResult } from '../modules/connectors/connector.status'
import { connectorStatusViewFromOverview } from '../modules/connectors/connector.status'
import type {
  LocalConnectorReconnectActionResult,
  LocalConnectorSkipActionInput,
  LocalConnectorStatusActionInput,
} from '../runtime/local-valedictorian-client'
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
import type {
  ActionQueueListResult,
  ActionQueueListQuery,
  CreateSourcingFindingInput,
  PromoteSourcingFindingInput,
  ScoreInput,
  SetSourcingFindingDecisionInput,
  SourcingFinding,
  SourcingFindingsListInput,
  SourcingFindingsListResult,
  UpdateSourcingFindingInput,
  ValedictorianClient,
  ValedictorianWorkspaceClient,
} from 'sparxie'
import {
  createHttpValedictorianClient,
  defaultUserProfile,
  defaultPolicyConfig,
  unavailableConnectorSchedulingCapability,
} from 'sparxie'
import { defaultAppSettings, normalizeAppSettings } from '../settings/app-settings'
import type { ConnectorScheduleUiApi } from '../settings/connector-schedule.types'
import { PAGE_LIMIT } from './types'
import type { RawRecordsReadApi } from '../modules/sourcing/raw-normalization.types'

export const emptyApplicationResult: ApplicationListResult = {
  items: [],
  total: 0,
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
}

export const emptyActionQueueResult: ActionQueueListResult = {
  items: [],
  total: 0,
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
  actionBucketCounts: {
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

export const emptyConnectorStatusResult: ConnectorStatusListResult = {
  available: false,
  items: [],
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
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.list(query)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.list(query) ?? Promise.resolve(emptyApplicationResult)
}

export const defaultApplicationDetailLoader = (applicationId: string): Promise<ApplicationDetail | null> => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.get(applicationId) as Promise<ApplicationDetail | null>
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.get(applicationId) ?? Promise.resolve(null)
}

export const defaultApplicationLinksLoader = (input: ApplicationLinksListInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.links.list(input)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.links?.list(input) ??
    Promise.resolve(emptyApplicationLinksResult)
  )
}

export const defaultApplicationEventsLoader = (input: ApplicationEventsListInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.events.list(input)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.events?.list(input) ??
    Promise.resolve(emptyApplicationEventsResult)
  )
}

export const defaultAttemptLoader = (applicationId: string) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.attempts.list({ applicationId })
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.attempts?.list({ applicationId }) ??
    Promise.resolve(emptyAttemptResult)
  )
}

export const defaultApplicationCreator = (input: CreateApplicationInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.create(input)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.create(input) ?? Promise.reject(new Error('Applications API is unavailable.'))
}

export const defaultApplicationUpdater = (input: UpdateApplicationInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.update(input)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.update(input) ?? Promise.reject(new Error('Applications API is unavailable.'))
}

export const defaultApplicationStatusUpdater = (input: StatusUpdateInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.updateStatus(input)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.updateStatus(input) ?? Promise.reject(new Error('Applications API is unavailable.'))
}

export const defaultApplicationArchiver = (input: ArchiveApplicationInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.archive(input)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.archive(input) ?? Promise.reject(new Error('Applications API is unavailable.'))
}

export const defaultApplicationWorkflowUpdater = (input: UpdateApplicationWorkflowInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.workflow.update(input)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.workflow.update(input) ??
    Promise.reject(new Error('Applications API is unavailable.'))
  )
}

export const defaultApplicationNoteAppender = (input: AppendApplicationNoteInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.notes.append(input)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.notes.append(input) ??
    Promise.reject(new Error('Applications API is unavailable.'))
  )
}

export const defaultApplicationLinkCreator = (input: CreateApplicationLinkInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.links.create(input)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.links.create(input) ??
    Promise.reject(new Error('Applications API is unavailable.'))
  )
}

export const defaultApplicationLinkUpdater = (input: UpdateApplicationLinkInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.applications.links.update(input)
  }

  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return (
    applicationWindow.applications?.links.update(input) ??
    Promise.reject(new Error('Applications API is unavailable.'))
  )
}

export const defaultActionQueueLoader = (query: ActionQueueListQuery) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.actionQueue.list(query)
  }

  const actionQueueWindow = window as Window & { actionQueue?: ActionQueuePreloadApi }

  return actionQueueWindow.actionQueue?.list(query) ?? Promise.resolve(emptyActionQueueResult)
}

export const defaultSourcingLoader = (query: SourcingFindingsListInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.sourcing.findings.list(query)
  }

  const sourcingWindow = window as Window & {
    sourcing?: { findings?: { list(query: SourcingFindingsListInput): Promise<SourcingFindingsListResult> } }
  }

  return sourcingWindow.sourcing?.findings?.list(query) ?? Promise.resolve(emptySourcingResult)
}

export const defaultRawRecordsApi: RawRecordsReadApi = {
  list(query) {
    return requireRendererHttpWorkspaceClient().sourcing.rawRecords.list(query)
  },
  get(rawRecordId) {
    return requireRendererHttpWorkspaceClient().sourcing.rawRecords.get(rawRecordId)
  },
  getNormalization(rawRecordId) {
    return requireRendererHttpWorkspaceClient().sourcing.rawRecords.normalization.get(rawRecordId)
  },
  getProjection(rawRevisionId) {
    return requireRendererHttpWorkspaceClient().sourcing.rawRevisions.projection.get(rawRevisionId)
  },
}

export const defaultConnectorStatusLoader = async () => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (!httpClient) {
    throw new Error('Connector Overview HTTP client is unavailable.')
  }

  const result = await httpClient.connectors.overview.list({ enabled: true, limit: 100 })
  return { available: true, items: result.items.map(connectorStatusViewFromOverview) }
}

export const defaultConnectorStatusReconnector = (
  input: LocalConnectorStatusActionInput,
): Promise<LocalConnectorReconnectActionResult> => {
  const connectorsWindow = window as Window & { connectors?: ConnectorsPreloadApi }

  if (rendererBackendUnavailable()) return Promise.reject(backendUnavailableError())
  if (!connectorsWindow.connectors?.status.reconnect) {
    return Promise.reject(new Error('Connector reconnect is unavailable for this runtime.'))
  }

  return connectorsWindow.connectors.status.reconnect(input)
}

export const defaultConnectorStatusSkipper = (
  input: LocalConnectorSkipActionInput,
): Promise<ConnectorSkipActionResult> => {
  const connectorsWindow = window as Window & { connectors?: ConnectorsPreloadApi }

  if (rendererBackendUnavailable()) return Promise.reject(backendUnavailableError())
  if (!connectorsWindow.connectors?.status.skip) {
    return Promise.reject(new Error('Connector skip is unavailable for this runtime.'))
  }

  return connectorsWindow.connectors.status.skip(input)
}

export const defaultConnectorsApi: ConnectorsPreloadApi = {
  list() {
    const connectorsWindow = window as Window & { connectors?: ConnectorsPreloadApi }
    const httpClient = getRendererHttpWorkspaceClient()

    if (rendererBackendUnavailable()) return Promise.reject(backendUnavailableError())
    return httpClient?.connectors.list() ?? connectorsWindow.connectors?.list() ?? Promise.resolve({ items: [] })
  },
  create(input) {
    const connectorsWindow = window as Window & { connectors?: ConnectorsPreloadApi }
    const httpClient = getRendererHttpWorkspaceClient()

    if (rendererBackendUnavailable()) return Promise.reject(backendUnavailableError())
    return httpClient?.connectors.create(input) ?? connectorsWindow.connectors?.create(input) ?? Promise.reject(new Error('Connectors API is unavailable.'))
  },
  update(input) {
    const connectorsWindow = window as Window & { connectors?: ConnectorsPreloadApi }
    const httpClient = getRendererHttpWorkspaceClient()

    if (rendererBackendUnavailable()) return Promise.reject(backendUnavailableError())
    return httpClient?.connectors.update(input) ?? connectorsWindow.connectors?.update(input) ?? Promise.reject(new Error('Connectors API is unavailable.'))
  },
  inspect(connectorInstanceId) {
    const connectorsWindow = window as Window & { connectors?: ConnectorsPreloadApi }
    const httpClient = getRendererHttpWorkspaceClient()

    if (rendererBackendUnavailable()) return Promise.reject(backendUnavailableError())
    return httpClient?.connectors.inspect(connectorInstanceId) ?? connectorsWindow.connectors?.inspect(connectorInstanceId) ?? Promise.reject(new Error('Connectors API is unavailable.'))
  },
  runs: {
    list(input) {
      const connectorsWindow = window as Window & { connectors?: ConnectorsPreloadApi }
      const httpClient = getRendererHttpWorkspaceClient()

      if (rendererBackendUnavailable()) return Promise.reject(backendUnavailableError())
      const httpResult = httpClient?.connectors.runs.list(input)
      return httpResult ?? connectorsWindow.connectors?.runs.list(input) ?? Promise.resolve({
        hasMore: false,
        items: [],
        limit: input.limit ?? 50,
        offset: input.offset ?? 0,
        total: 0,
      })
    },
    trigger(input) {
      const connectorsWindow = window as Window & { connectors?: ConnectorsPreloadApi }
      const httpClient = getRendererHttpWorkspaceClient()

      if (rendererBackendUnavailable()) return Promise.reject(backendUnavailableError())
      return httpClient?.connectors.runs.trigger(input)
        ?? connectorsWindow.connectors?.runs.trigger(input)
        ?? Promise.reject(new Error('Connectors API is unavailable.'))
    },
  },
  status: {
    reconnect: defaultConnectorStatusReconnector,
    skip: defaultConnectorStatusSkipper,
  },
}

export const defaultConnectorScheduleApi: ConnectorScheduleUiApi = {
  async getCapabilities() {
    const rootClient = getRendererHttpRootClient()

    if (!rootClient) {
      return { connectorScheduling: unavailableConnectorSchedulingCapability }
    }

    const capabilities = await rootClient.capabilities.get()
    return { connectorScheduling: capabilities.connectorScheduling }
  },
  async getSchedule(connectorInstanceId) {
    const workspaceClient = requireRendererHttpWorkspaceClient()
    return workspaceClient.connectors.schedules.get(connectorInstanceId)
  },
  async upsertSchedule(input) {
    const workspaceClient = requireRendererHttpWorkspaceClient()
    return workspaceClient.connectors.schedules.upsert(input)
  },
  async pauseSchedule(input) {
    const workspaceClient = requireRendererHttpWorkspaceClient()
    return workspaceClient.connectors.schedules.pause(input)
  },
  async resumeSchedule(input) {
    const workspaceClient = requireRendererHttpWorkspaceClient()
    return workspaceClient.connectors.schedules.resume(input)
  },
  async deleteSchedule(input) {
    const workspaceClient = requireRendererHttpWorkspaceClient()
    return workspaceClient.connectors.schedules.delete(input)
  },
}

export const defaultPromoteSourcingFinding = (input: PromoteSourcingFindingInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.sourcing.findings.promote(input)
  }

  const sourcingWindow = window as Window & {
    sourcing?: { findings?: { promote(input: PromoteSourcingFindingInput): Promise<SourcingFinding> } }
  }

  return sourcingWindow.sourcing?.findings?.promote(input) ?? Promise.reject(new Error('Sourcing API is unavailable.'))
}

export const defaultCreateSourcingFinding = (input: CreateSourcingFindingInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.sourcing.findings.create(input)
  }

  const sourcingWindow = window as Window & {
    sourcing?: { findings?: { create(input: CreateSourcingFindingInput): Promise<SourcingFinding> } }
  }

  return sourcingWindow.sourcing?.findings?.create(input) ?? Promise.reject(new Error('Sourcing API is unavailable.'))
}

export const defaultUpdateSourcingFinding = (input: UpdateSourcingFindingInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.sourcing.findings.update(input)
  }

  const sourcingWindow = window as Window & {
    sourcing?: { findings?: { update(input: UpdateSourcingFindingInput): Promise<SourcingFinding> } }
  }

  return sourcingWindow.sourcing?.findings?.update(input) ?? Promise.reject(new Error('Sourcing API is unavailable.'))
}

export const defaultDecideSourcingFinding = (input: SetSourcingFindingDecisionInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.sourcing.findings.decide(input)
  }

  const sourcingWindow = window as Window & {
    sourcing?: { findings?: { decide(input: SetSourcingFindingDecisionInput): Promise<SourcingFinding> } }
  }

  return sourcingWindow.sourcing?.findings?.decide(input) ?? Promise.reject(new Error('Sourcing API is unavailable.'))
}

export const defaultScoreRecorder = (input: ScoreInput) => {
  const httpClient = getRendererHttpWorkspaceClient()

  if (httpClient) {
    return httpClient.scores.record(input)
  }

  const scoresWindow = window as Window & {
    scores?: { record(input: ScoreInput): ReturnType<ScoresPreloadApi['record']> }
  }

  return scoresWindow.scores?.record(input) ?? Promise.reject(new Error('Scores API is unavailable.'))
}

interface RendererHttpConfig {
  apiBaseUrl: string
  getBackendState?: () =>
    | { status: 'starting' | 'unavailable' | 'stopped' }
    | { status: 'available'; origin: string }
  onBackendStateChanged?: (listener: (state: { status: string }) => void) => () => void
  token?: string
  workspaceId: string
  request?: typeof fetch
}

function getRendererHttpConfig(): RendererHttpConfig | null {
  return (window as Window & { valedictorianHttp?: RendererHttpConfig }).valedictorianHttp ?? null
}

function getRendererHttpRootClient(): ValedictorianClient | null {
  const config = getRendererHttpConfig()

  if (!config) {
    return null
  }

  const backendState = config.getBackendState?.()
  if (backendState && backendState.status !== 'available') {
    return null
  }

  return createHttpValedictorianClient({
    baseUrl: backendState?.status === 'available'
      ? backendState.origin
      : config.apiBaseUrl,
    fetch: config.request ?? globalThis.fetch.bind(globalThis),
    token: config.token,
  })
}

function rendererBackendUnavailable() {
  const state = getRendererHttpConfig()?.getBackendState?.()
  return Boolean(state && state.status !== 'available')
}

function backendUnavailableError() {
  return new Error('Workspace backend unavailable.')
}

function getRendererHttpWorkspaceClient(): ValedictorianWorkspaceClient | null {
  const config = getRendererHttpConfig()
  const rootClient = getRendererHttpRootClient()

  if (!config || !rootClient) {
    return null
  }

  return rootClient.forWorkspace(config.workspaceId)
}

function requireRendererHttpWorkspaceClient(): ValedictorianWorkspaceClient {
  const workspaceClient = getRendererHttpWorkspaceClient()

  if (!workspaceClient) {
    throw new Error('Workspace HTTP client is unavailable.')
  }

  return workspaceClient
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

function getWindowWorkspaceApi() {
  return (window as Window & { workspace?: WorkspacePreloadApi }).workspace
}

function getWindowUpdatesApi() {
  return (window as Window & { valedictorianUpdates?: UpdatesPreloadApi }).valedictorianUpdates
}

export const defaultUpdatesApi: UpdatesPreloadApi = {
  check() {
    return getWindowUpdatesApi()?.check() ?? Promise.resolve({
      currentVersion: 'unknown',
      message: 'Updates are unavailable in this environment.',
      status: 'disabled',
    })
  },
  getState() {
    return getWindowUpdatesApi()?.getState() ?? Promise.resolve({
      currentVersion: 'unknown',
      message: 'Updates are unavailable in this environment.',
      status: 'disabled',
    })
  },
  install() {
    return getWindowUpdatesApi()?.install() ?? Promise.resolve()
  },
  onStateChanged(listener) {
    return getWindowUpdatesApi()?.onStateChanged(listener) ?? (() => undefined)
  },
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

export const defaultWorkspaceApi: WorkspacePreloadApi = {
  chooseCreateParentFolder() {
    return getWindowWorkspaceApi()?.chooseCreateParentFolder() ?? Promise.resolve(null)
  },
  chooseFolder() {
    return getWindowWorkspaceApi()?.chooseFolder() ?? Promise.resolve(null)
  },
  createWorkspace(input) {
    return (
      getWindowWorkspaceApi()?.createWorkspace(input) ??
      Promise.resolve({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'needs-workspace',
      })
    )
  },
  getCurrent() {
    return getWindowWorkspaceApi()?.getCurrent() ?? Promise.resolve(null)
  },
  getLaunchState() {
    return (
      getWindowWorkspaceApi()?.getLaunchState() ??
      Promise.resolve({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'needs-workspace',
      })
    )
  },
  listRecent() {
    return getWindowWorkspaceApi()?.listRecent() ?? Promise.resolve([])
  },
  openFolder() {
    return (
      getWindowWorkspaceApi()?.openFolder() ??
      Promise.resolve({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'needs-workspace',
      })
    )
  },
  openRecent(workspaceId) {
    return (
      getWindowWorkspaceApi()?.openRecent(workspaceId) ??
      Promise.resolve({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'needs-workspace',
      })
    )
  },
  removeRecent(workspaceId) {
    return (
      getWindowWorkspaceApi()?.removeRecent(workspaceId) ??
      Promise.resolve({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'needs-workspace',
      })
    )
  },
  reveal(workspacePath) {
    return getWindowWorkspaceApi()?.reveal(workspacePath) ?? Promise.resolve()
  },
  revealCurrent() {
    return getWindowWorkspaceApi()?.revealCurrent() ?? Promise.resolve()
  },
}

export const defaultPolicyApi: PolicyPreloadApi = {
  config: {
    get() {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.policy.config.get()
      }

      return getWindowPolicyApi()?.config.get() ?? Promise.resolve(defaultPolicyConfig)
    },
    reset() {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.policy.config.reset()
      }

      return getWindowPolicyApi()?.config.reset() ?? Promise.resolve(defaultPolicyConfig)
    },
    update(patch) {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.policy.config.update(patch)
      }

      return getWindowPolicyApi()?.config.update(patch) ?? Promise.resolve(defaultPolicyConfig)
    },
  },
  evidence: {
    list(query) {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.policy.evidence.list(query)
      }

      return getWindowPolicyApi()?.evidence.list(query) ?? Promise.resolve([])
    },
    record(input) {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.policy.evidence.record(input)
      }

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
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.policy.evaluate.application(input)
      }

      return (
        getWindowPolicyApi()?.evaluate.application(input) ??
        Promise.resolve({
          action: 'allow_outcome',
          configVersion: 2,
          reasons: [],
          requiredEvidence: [],
          status: 'allow',
          tags: [],
        })
      )
    },
    sourcingCandidate(input) {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.policy.evaluate.sourcingCandidate(input)
      }

      return (
        getWindowPolicyApi()?.evaluate.sourcingCandidate(input) ??
        Promise.resolve({
          action: 'promote_sourcing_candidate',
          configVersion: 2,
          reasons: [],
          requiredEvidence: [],
          status: 'allow',
          tags: [],
        })
      )
    },
    runWindow(input) {
      const httpClient = getRendererHttpWorkspaceClient()
      const now = input.now ?? new Date().toISOString()

      if (httpClient) {
        return httpClient.policy.evaluate.runWindow(input)
      }

      return (
        getWindowPolicyApi()?.evaluate.runWindow(input) ??
        Promise.resolve({
          action: 'recommend_run_window',
          cadenceHours: defaultPolicyConfig.sourcing.weekdayNormalCadenceHours,
          configVersion: 2,
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
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.profile.agentContext.get()
      }

      return getWindowProfileApi()?.agentContext.get() ?? Promise.resolve({ answers: [], basics: {} })
    },
  },
  get() {
    const httpClient = getRendererHttpWorkspaceClient()

    if (httpClient) {
      return httpClient.profile.get()
    }

    return getWindowProfileApi()?.get() ?? Promise.resolve(defaultUserProfile)
  },
  sensitive: {
    get() {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.profile.sensitive.get()
      }

      return getWindowProfileApi()?.sensitive.get() ?? Promise.resolve(defaultSensitiveDetails)
    },
    update(input) {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.profile.sensitive.update(input)
      }

      return (
        getWindowProfileApi()?.sensitive.update(input) ??
        Promise.resolve({ ...defaultSensitiveDetails, ...input })
      )
    },
  },
  secrets: {
    delete(key) {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.secrets.delete(key)
      }

      return getWindowProfileApi()?.secrets.delete(key) ?? Promise.resolve()
    },
    list() {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.secrets.list().then((result) => result.items)
      }

      return getWindowProfileApi()?.secrets.list() ?? Promise.resolve([])
    },
    upsert(input) {
      const httpClient = getRendererHttpWorkspaceClient()

      if (httpClient) {
        return httpClient.secrets.upsert(input)
      }

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
    const httpClient = getRendererHttpWorkspaceClient()

    if (httpClient) {
      return httpClient.profile.update(input)
    }

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
