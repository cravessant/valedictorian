import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/toaster'
import { AlertCircle, SlidersHorizontal } from 'lucide-react'
import { ApplicationTable } from './modules/applications/ApplicationTable'
import { ApplicationDetailModal } from './modules/applications/ApplicationDetailModal'
import { ApplicationEditorModal } from './modules/applications/ApplicationEditorModal'
import { ProfileSettingsPanel } from './modules/profile/ProfileSettingsPanel'
import { ActionQueuePage } from './modules/action-queue/ActionQueuePage'
import { ConnectorStatusPage } from './modules/connectors/ConnectorStatusPage'
import { SourcingPage } from './modules/sourcing/SourcingPage'
import { AppSidebar, AppTopbar } from './app/AppChrome'
import { formatEnumLabel } from './app/labels'
import { ConnectorRunsPanel, ConnectorSettingsPanel, SettingsPage, SettingsSidebar } from './settings/SettingsPage'
import {
  applicationListSorts,
  applicationStatuses
} from './modules/applications/application.types'


import { FilterDateInput, FilterTextInput } from './app/FilterInputs'
import type { AppShellProps } from './app/AppShell.types'
import {
  APP_VIEWS,
  PAGE_LIMIT,
} from './app/types'

const filterControlClassName = 'h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground'

export function AppShell({
  actionQueueBucket,
  actionQueueError,
  actionQueueOffset,
  actionQueueResult,
  appView,
  applicationCreator,
  applicationDetail,
  applicationDetailError,
  applicationEventsError,
  applicationEventsResult,
  applicationLinkCreator,
  applicationLinkUpdater,
  applicationLinksError,
  applicationLinksResult,
  applicationNoteAppender,
  applicationStatusUpdater,
  applicationUpdater,
  applicationWorkflowUpdater,
  attemptError,
  attemptResult,
  checkForUpdates,
  closeTransientSidebar,
  connectorStatusError,
  connectorStatusResult,
  connectorsApi,
  connectorScheduleApi,
  contentColumnClass,
  createSourcingFinding,
  decideSourcingFinding,
  editingApplication,
  error,
  filters,
  filtersExpanded,
  focusedConnectorRunId,
  handleConnectorStatusAction,
  hasLoadedActionQueue,
  hasLoadedApplications,
  hasLoadedConnectorStatus,
  hasLoadedSourcing,
  installUpdate,
  isActionQueueLoading,
  isAddingApplication,
  isApplicationDetailLoading,
  isApplicationEventsLoading,
  isApplicationLinksLoading,
  isAttemptLoading,
  isConnectorStatusLoading,
  isInitialLoading,
  isNarrowViewport,
  isSourcingLoading,
  narrowSidebarOpen,
  offset,
  openActionQueueApplicationEditor,
  openApplicationDetail,
  policyApi,
  profileApi,
  promoteFinding,
  promotingFindingId,
  reloadApplicationViews,
  reloadConnectorRunOutcomes,
  reloadSourcing,
  resetFilters,
  result,
  scoreRecorder,
  selectedApplication,
  selectedSettingsPanel,
  setActionQueueOffset,
  setAppView,
  setEditingApplication,
  setFiltersExpanded,
  setFocusedConnectorRunId,
  setIsAddingApplication,
  setNarrowSidebarOpen,
  setOffset,
  setSelectedApplication,
  setSelectedSettingsPanel,
  setSettingsOpen,
  setSidebarHoverExpanded,
  setSourcingDestinationClass,
  setSourcingOffset,
  setSourcingUsability,
  settings,
  settingsOpen,
  settingsRestartRequired,
  sidebarHoverExpanded,
  sidebarState,
  sidebarToggleCollapsed,
  sidebarVisible,
  sourcingDestinationClass,
  sourcingError,
  sourcingMergeStatus,
  sourcingOffset,
  sourcingResult,
  sourcingSourceId,
  sourcingUsability,
  temporaryDesktopSidebar,
  togglePinnedSidebar,
  updateActionQueueBucket,
  updateFilter,
  updateSettings,
  updateSourcingFinding,
  updateSourcingMergeStatus,
  updateSourcingSource,
  updateState,
  viewTitle,
  windowChromeState,
  workspace,
  workspaceApi,
}: AppShellProps) {
  return (
    <div
      className="relative min-h-screen text-foreground"
      data-sidebar-state={sidebarState}
      data-testid="app-shell"
      data-view={appView}
    >
      <AppTopbar
        isFullScreen={windowChromeState.isFullScreen}
        sidebarCollapsed={sidebarToggleCollapsed}
        title={viewTitle}
        updateState={updateState}
        onCheckForUpdates={() => {
          void checkForUpdates()
        }}
        onInstallUpdate={() => {
          void installUpdate()
        }}
        onToggleSidebar={togglePinnedSidebar}
      />
      {!isNarrowViewport && settings.sidebarCollapsed && !sidebarHoverExpanded ? (
        <button
          type="button"
          aria-label="Show sidebar temporarily"
          className="app-no-drag absolute left-0 top-12 z-30 h-[calc(100vh-3rem)] w-2 cursor-default bg-transparent"
          onMouseEnter={() => setSidebarHoverExpanded(true)}
        />
      ) : null}
      <div
        className={`relative grid h-[calc(100vh-3rem)] grid-cols-1 grid-rows-1 overflow-hidden ${
          settings.sidebarCollapsed ? 'md:grid-cols-[0px_1fr]' : 'md:grid-cols-[280px_1fr]'
        }`}
        data-testid="app-layout"
      >
        {isNarrowViewport && narrowSidebarOpen ? (
          <Button
            type="button"
            variant="ghost"
            aria-label="Close sidebar drawer"
            className="absolute inset-0 z-30 h-auto rounded-none bg-background/70 p-0 hover:bg-background/70 md:hidden"
            onClick={() => setNarrowSidebarOpen(false)}
          />
        ) : null}

        {sidebarVisible ? (
          appView === APP_VIEWS.SETTINGS ? (
            <SettingsSidebar
              selectedPanel={selectedSettingsPanel}
              temporary={temporaryDesktopSidebar}
              onBack={() => {
                setAppView(APP_VIEWS.APPLICATIONS)
                closeTransientSidebar()
              }}
              onMouseLeave={() => {
                if (!isNarrowViewport && settings.sidebarCollapsed) {
                  setSidebarHoverExpanded(false)
                }
              }}
              onPanelChange={(panel) => {
                setSelectedSettingsPanel(panel)
                closeTransientSidebar()
              }}
            />
          ) : (
            <AppSidebar
              currentView={appView}
              settings={settings}
              settingsOpen={settingsOpen}
              temporary={temporaryDesktopSidebar}
              onMouseLeave={() => {
                if (!isNarrowViewport && settings.sidebarCollapsed) {
                  setSidebarHoverExpanded(false)
                }
              }}
              onOpenSettingsPage={() => {
                setSettingsOpen(false)
                closeTransientSidebar()
                setAppView(APP_VIEWS.SETTINGS)
              }}
              onOpenProfilePage={() => {
                setSettingsOpen(false)
                closeTransientSidebar()
                setAppView(APP_VIEWS.PROFILE)
              }}
              onViewChange={(view) => {
                closeTransientSidebar()
                setFocusedConnectorRunId(null)
                setAppView(view)
              }}
              onSettingsOpenChange={setSettingsOpen}
              onSettingsPatch={updateSettings}
            />
          )
        ) : null}

        {appView === APP_VIEWS.SETTINGS ? (
          <SettingsPage
            connectorsApi={connectorsApi}
            connectorScheduleApi={connectorScheduleApi}
            contentColumnClass={contentColumnClass}
            policyApi={policyApi}
            profileApi={profileApi}
            restartRequired={settingsRestartRequired}
            selectedPanel={selectedSettingsPanel}
            settings={settings}
            workspace={workspace}
            workspaceApi={workspaceApi}
            onConnectorRunSettled={reloadConnectorRunOutcomes}
            onOpenSourcingRuns={(runId) => {
              setSettingsOpen(false)
              closeTransientSidebar()
              setFocusedConnectorRunId(runId ?? null)
              setAppView(APP_VIEWS.CONNECTOR_RUNS)
            }}
            onSettingsPatch={updateSettings}
          />
        ) : appView === APP_VIEWS.PROFILE ? (
          <main
            className={`h-full min-w-0 overflow-auto px-5 py-6 text-foreground md:h-[calc(100vh-3rem)] sm:px-8 lg:px-12 ${contentColumnClass}`}
          >
            <div className="mx-auto max-w-4xl">
              <ProfileSettingsPanel profileApi={profileApi} />
            </div>
          </main>
        ) : appView === APP_VIEWS.ACTION_QUEUE ? (
          <ActionQueuePage
            actionBucket={actionQueueBucket}
            contentColumnClass={contentColumnClass}
            isLoading={isActionQueueLoading && !hasLoadedActionQueue}
            result={actionQueueResult}
            error={actionQueueError}
            onActionBucketChange={updateActionQueueBucket}
            onEditApplication={openActionQueueApplicationEditor}
            onNextPage={() => setActionQueueOffset(actionQueueOffset + PAGE_LIMIT)}
            onOpenApplication={openApplicationDetail}
            onPreviousPage={() => setActionQueueOffset(Math.max(0, actionQueueOffset - PAGE_LIMIT))}
          />
        ) : appView === APP_VIEWS.CONNECTORS ? (
          <ConnectorStatusPage
            contentColumnClass={contentColumnClass}
            error={connectorStatusError}
            isLoading={isConnectorStatusLoading && !hasLoadedConnectorStatus}
            operations={(
              <ConnectorSettingsPanel
                connectorsApi={connectorsApi}
                connectorScheduleApi={connectorScheduleApi}
                displayMode="main"
                onConnectorChanged={reloadConnectorRunOutcomes}
                profileApi={profileApi}
                workspaceId={workspace?.id ?? null}
                onOpenSourcingRuns={(runId) => {
                  setSettingsOpen(false)
                  closeTransientSidebar()
                  setFocusedConnectorRunId(runId ?? null)
                  setAppView(APP_VIEWS.CONNECTOR_RUNS)
                }}
                onRunSettled={reloadConnectorRunOutcomes}
              />
            )}
            result={connectorStatusResult}
            onAction={handleConnectorStatusAction}
          />
        ) : appView === APP_VIEWS.CONNECTOR_RUNS ? (
          <main
            className={`h-full min-w-0 overflow-auto px-5 py-6 text-foreground md:h-[calc(100vh-3rem)] sm:px-8 lg:px-12 ${contentColumnClass}`}
          >
            <div className="mx-auto max-w-4xl">
              <ConnectorRunsPanel
                connectorsApi={connectorsApi}
                focusedRunId={focusedConnectorRunId}
              />
            </div>
          </main>
        ) : appView === APP_VIEWS.SOURCING ? (
          <SourcingPage
            contentColumnClass={contentColumnClass}
            error={sourcingError}
            isLoading={isSourcingLoading && !hasLoadedSourcing}
            mergeStatus={sourcingMergeStatus}
            destinationClass={sourcingDestinationClass}
            promotingFindingId={promotingFindingId}
            result={sourcingResult}
            sourceId={sourcingSourceId}
            usability={sourcingUsability}
            onCreateFinding={async (input) => {
              const finding = await createSourcingFinding(input)
              reloadSourcing()
              return finding
            }}
            onDecideFinding={async (input) => {
              const finding = await decideSourcingFinding(input)
              reloadSourcing()
              return finding
            }}
            onMergeStatusChange={updateSourcingMergeStatus}
            onDestinationClassChange={(destinationClass) => {
              setSourcingDestinationClass(destinationClass)
              setSourcingOffset(0)
            }}
            onNextPage={() => setSourcingOffset(sourcingOffset + PAGE_LIMIT)}
            onOpenApplication={openApplicationDetail}
            onPreviousPage={() => setSourcingOffset(Math.max(0, sourcingOffset - PAGE_LIMIT))}
            onPromoteFinding={promoteFinding}
            onSourceChange={updateSourcingSource}
            onUsabilityChange={(usability) => {
              setSourcingUsability(usability)
              setSourcingOffset(0)
            }}
            onUpdateFinding={async (input) => {
              const finding = await updateSourcingFinding(input)
              reloadSourcing()
              return finding
            }}
          />
        ) : (
          <main className={`flex h-full min-w-0 flex-col overflow-hidden px-4 py-5 text-foreground md:h-[calc(100vh-3rem)] sm:px-6 lg:px-8 ${contentColumnClass}`}>
            <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4">
              <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Job automation
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
                    Applications
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="w-fit border border-border bg-card">
                    {result.total} rows
                  </Badge>
                  <Button type="button" onClick={() => setIsAddingApplication(true)}>
                    Add application
                  </Button>
                </div>
              </header>

              <section
                aria-label="Application filters"
                className="rounded-md border border-border bg-card p-4"
              >
                <div className="flex gap-2">
                  <div className="flex-1">
                    <FilterTextInput
                      label="Search"
                      value={filters.search}
                      onChange={(value) => updateFilter('search', value)}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={filtersExpanded ? 'Hide filters' : 'Show filters'}
                      aria-expanded={filtersExpanded}
                      className="h-9 w-9 rounded-md"
                      onClick={() => setFiltersExpanded((current: boolean) => !current)}
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                {filtersExpanded ? (
                  <>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Status
                        <select
                          aria-label="Status"
                          className={filterControlClassName}
                          value={filters.status}
                          onChange={(event) => updateFilter('status', event.target.value)}
                        >
                          <option value="">Any status</option>
                          {applicationStatuses.map((status) => (
                            <option key={status} value={status}>
                              {formatEnumLabel(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Sort
                        <select
                          aria-label="Sort"
                          className={filterControlClassName}
                          value={filters.sort}
                          onChange={(event) => updateFilter('sort', event.target.value)}
                        >
                          {applicationListSorts.map((sort) => (
                            <option key={sort} value={sort}>
                              {formatEnumLabel(sort)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Score band
                        <select
                          aria-label="Score band"
                          className={filterControlClassName}
                          value={filters.priorityBand}
                          onChange={(event) => updateFilter('priorityBand', event.target.value)}
                        >
                          <option value="">Any band</option>
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="skip">Skip</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Min score
                        <input
                          aria-label="Min score"
                          className={filterControlClassName}
                          min="0"
                          max="10"
                          type="number"
                          value={filters.minScore}
                          onChange={(event) => updateFilter('minScore', event.target.value)}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Work mode
                        <select
                          aria-label="Work mode"
                          className={filterControlClassName}
                          value={filters.workMode}
                          onChange={(event) => updateFilter('workMode', event.target.value)}
                        >
                          <option value="">Any mode</option>
                          <option value="remote">Remote</option>
                          <option value="onsite">Onsite</option>
                          <option value="hybrid">Hybrid</option>
                          <option value="unclear">Unclear</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <FilterDateInput
                        label="Created from"
                        value={filters.createdFrom}
                        onChange={(value) => updateFilter('createdFrom', value)}
                      />
                      <FilterDateInput
                        label="Created to"
                        value={filters.createdTo}
                        onChange={(value) => updateFilter('createdTo', value)}
                      />
                      <FilterDateInput
                        label="Updated from"
                        value={filters.updatedFrom}
                        onChange={(value) => updateFilter('updatedFrom', value)}
                      />
                      <FilterDateInput
                        label="Updated to"
                        value={filters.updatedTo}
                        onChange={(value) => updateFilter('updatedTo', value)}
                      />
                    </div>
                    <div
                      role="group"
                      aria-label="Filter actions"
                      className="mt-4 flex justify-end border-t border-border pt-3"
                    >
                      <Button type="button" variant="outline" onClick={resetFilters}>
                        Reset filters
                      </Button>
                    </div>
                  </>
                ) : null}
              </section>

              {isInitialLoading ? (
                <div
                  role="status"
                  aria-label="Applications loading"
                  className="rounded-md border border-border bg-card p-4"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">Loading applications...</p>
                    <Skeleton className="h-2 w-24" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-4/5" />
                  </div>
                </div>
              ) : null}

              {error ? (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>Load failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {hasLoadedApplications ? (
                <ApplicationTable
                  result={result}
                  sort={filters.sort}
                  onEditApplication={setEditingApplication}
                  onOpenApplication={openApplicationDetail}
                  onSortChange={(nextSort) => updateFilter('sort', nextSort)}
                  onPreviousPage={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}
                  onNextPage={() => setOffset(offset + PAGE_LIMIT)}
                />
              ) : null}
            </section>
          </main>
        )}
      </div>
      {isAddingApplication ? (
        <ApplicationEditorModal
          mode="add"
          onClose={() => setIsAddingApplication(false)}
          onAppendNote={applicationNoteAppender}
          onCreate={applicationCreator}
          onSaved={reloadApplicationViews}
          onUpdate={applicationUpdater}
          onUpdateStatus={applicationStatusUpdater}
          onUpdateWorkflow={applicationWorkflowUpdater}
        />
      ) : null}
      {editingApplication ? (
        <ApplicationEditorModal
          application={editingApplication}
          mode="edit"
          onClose={() => setEditingApplication(null)}
          onAppendNote={applicationNoteAppender}
          onCreate={applicationCreator}
          onSaved={reloadApplicationViews}
          onUpdate={applicationUpdater}
          onUpdateStatus={applicationStatusUpdater}
          onUpdateWorkflow={applicationWorkflowUpdater}
        />
      ) : null}
      {selectedApplication ? (
        <ApplicationDetailModal
          application={applicationDetail ?? selectedApplication}
          attempts={attemptResult.items}
          detailError={applicationDetailError}
          events={applicationEventsResult.items}
          eventsError={applicationEventsError}
          isAttemptsLoading={isAttemptLoading}
          isDetailLoading={isApplicationDetailLoading}
          isEventsLoading={isApplicationEventsLoading}
          isLinksLoading={isApplicationLinksLoading}
          links={applicationLinksResult.items}
          linksError={applicationLinksError}
          attemptsError={attemptError}
          onCreateLink={async (input) => {
            const link = await applicationLinkCreator(input)
            reloadApplicationViews()
            return link
          }}
          onRecordScore={async (input) => {
            const score = await scoreRecorder(input)
            reloadApplicationViews()
            return score
          }}
          onUpdateLink={async (input) => {
            const link = await applicationLinkUpdater(input)
            reloadApplicationViews()
            return link
          }}
          onClose={() => setSelectedApplication(null)}
        />
      ) : null}
      <Toaster />
    </div>
  )
}
