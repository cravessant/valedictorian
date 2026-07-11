import type { Dispatch, SetStateAction } from 'react'
import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'
import type { PolicyPreloadApi } from '../ipc/policy.preload'
import type { ProfilePreloadApi } from '../ipc/profile.preload'
import type { UpdateState } from '../ipc/updates.preload'
import type { WindowChromeState } from '../ipc/window-chrome.preload'
import type { WorkspacePreloadApi } from '../ipc/workspace.preload'
import type {
  ApplicationAttemptsListResult,
  ApplicationDetail,
  ApplicationEventsListResult,
  ApplicationLinkRecord,
  ApplicationLinksListResult,
  ApplicationListItem,
  ApplicationListResult,
  AppendApplicationNoteInput,
  CreateApplicationInput,
  CreateApplicationLinkInput,
  StatusUpdateInput,
  UpdateApplicationInput,
  UpdateApplicationLinkInput,
  UpdateApplicationWorkflowInput,
} from '../modules/applications/application.types'
import type {
  ConnectorStatusAction,
  ConnectorStatusListResult,
  ConnectorStatusView,
} from '../modules/connectors/connector.status'
import type { AppSettings, AppSettingsPatch } from '../settings/app-settings'
import type { WorkspaceSummary } from '../workspace/workspace.initializer'
import type {
  ActionQueueBucket,
  ActionQueueListResult,
  CreateSourcingFindingInput,
  ScoreInput,
  ScoreRecord,
  SetSourcingFindingDecisionInput,
  SourcingDestinationClass,
  SourcingFinding,
  SourcingFindingsListResult,
  SourcingMergeStatus,
  SourcingUsability,
  UpdateSourcingFindingInput,
} from 'sparxie'
import type { ApplicationDetailSeed, AppView, FilterState, SettingsPanelId } from './types'

export interface AppShellProps {
  actionQueueBucket: ActionQueueBucket | undefined
  actionQueueError: string | null
  actionQueueOffset: number
  actionQueueResult: ActionQueueListResult
  appView: AppView
  applicationCreator: (input: CreateApplicationInput) => Promise<ApplicationDetail>
  applicationDetail: ApplicationDetail | null
  applicationDetailError: string | null
  applicationEventsError: string | null
  applicationEventsResult: ApplicationEventsListResult
  applicationLinkCreator: (input: CreateApplicationLinkInput) => Promise<ApplicationLinkRecord>
  applicationLinkUpdater: (input: UpdateApplicationLinkInput) => Promise<ApplicationLinkRecord>
  applicationLinksError: string | null
  applicationLinksResult: ApplicationLinksListResult
  applicationNoteAppender: (input: AppendApplicationNoteInput) => Promise<ApplicationDetail>
  applicationStatusUpdater: (input: StatusUpdateInput) => Promise<ApplicationDetail>
  applicationUpdater: (input: UpdateApplicationInput) => Promise<ApplicationDetail>
  applicationWorkflowUpdater: (input: UpdateApplicationWorkflowInput) => Promise<ApplicationDetail>
  attemptError: string | null
  attemptResult: ApplicationAttemptsListResult
  checkForUpdates: () => Promise<UpdateState>
  closeTransientSidebar: () => void
  connectorStatusError: string | null
  connectorStatusResult: ConnectorStatusListResult
  connectorsApi: ConnectorsPreloadApi
  contentColumnClass: string
  createSourcingFinding: (input: CreateSourcingFindingInput) => Promise<SourcingFinding>
  decideSourcingFinding: (input: SetSourcingFindingDecisionInput) => Promise<SourcingFinding>
  editingApplication: ApplicationListItem | null
  error: string | null
  filters: FilterState
  filtersExpanded: boolean
  focusedConnectorRunId: string | null
  handleConnectorStatusAction: (
    connector: ConnectorStatusView,
    action: ConnectorStatusAction,
  ) => void
  hasLoadedActionQueue: boolean
  hasLoadedApplications: boolean
  hasLoadedConnectorStatus: boolean
  hasLoadedSourcing: boolean
  installUpdate: () => Promise<void>
  isActionQueueLoading: boolean
  isAddingApplication: boolean
  isApplicationDetailLoading: boolean
  isApplicationEventsLoading: boolean
  isApplicationLinksLoading: boolean
  isAttemptLoading: boolean
  isConnectorStatusLoading: boolean
  isInitialLoading: boolean
  isNarrowViewport: boolean
  isSourcingLoading: boolean
  narrowSidebarOpen: boolean
  offset: number
  openActionQueueApplicationEditor: (application: ApplicationDetailSeed) => void
  openApplicationDetail: (application: ApplicationDetailSeed) => void
  policyApi: PolicyPreloadApi
  profileApi: ProfilePreloadApi
  promoteFinding: (findingId: string) => void
  promotingFindingId: string | null
  reloadApplicationViews: () => void
  reloadConnectorRunOutcomes: () => void
  reloadSourcing: () => void
  resetFilters: () => void
  result: ApplicationListResult
  scoreRecorder: (input: ScoreInput) => Promise<ScoreRecord>
  selectedApplication: ApplicationDetailSeed | null
  selectedSettingsPanel: SettingsPanelId
  setActionQueueOffset: Dispatch<SetStateAction<number>>
  setAppView: Dispatch<SetStateAction<AppView>>
  setEditingApplication: Dispatch<SetStateAction<ApplicationListItem | null>>
  setFiltersExpanded: Dispatch<SetStateAction<boolean>>
  setFocusedConnectorRunId: Dispatch<SetStateAction<string | null>>
  setIsAddingApplication: Dispatch<SetStateAction<boolean>>
  setNarrowSidebarOpen: Dispatch<SetStateAction<boolean>>
  setOffset: Dispatch<SetStateAction<number>>
  setSelectedApplication: Dispatch<SetStateAction<ApplicationDetailSeed | null>>
  setSelectedSettingsPanel: Dispatch<SetStateAction<SettingsPanelId>>
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setSidebarHoverExpanded: Dispatch<SetStateAction<boolean>>
  setSourcingDestinationClass: Dispatch<SetStateAction<SourcingDestinationClass | undefined>>
  setSourcingOffset: Dispatch<SetStateAction<number>>
  setSourcingUsability: Dispatch<SetStateAction<SourcingUsability | undefined>>
  settings: AppSettings
  settingsOpen: boolean
  settingsRestartRequired: boolean
  sidebarHoverExpanded: boolean
  sidebarState: 'expanded' | 'collapsed' | 'hover' | 'drawer-open' | 'drawer-closed'
  sidebarToggleCollapsed: boolean
  sidebarVisible: boolean
  sourcingDestinationClass: SourcingDestinationClass | undefined
  sourcingError: string | null
  sourcingMergeStatus: SourcingMergeStatus | undefined
  sourcingOffset: number
  sourcingResult: SourcingFindingsListResult
  sourcingSourceId: string
  sourcingUsability: SourcingUsability | undefined
  temporaryDesktopSidebar: boolean
  togglePinnedSidebar: () => void
  updateActionQueueBucket: (bucket: ActionQueueBucket | undefined) => void
  updateFilter: (key: keyof FilterState, value: string) => void
  updateSettings: (patch: AppSettingsPatch) => void
  updateSourcingFinding: (input: UpdateSourcingFindingInput) => Promise<SourcingFinding>
  updateSourcingMergeStatus: (mergeStatus: SourcingMergeStatus | undefined) => void
  updateSourcingSource: (sourceId: string) => void
  updateState: UpdateState | null
  viewTitle: string
  windowChromeState: WindowChromeState
  workspace: WorkspaceSummary | null
  workspaceApi: WorkspacePreloadApi
}
