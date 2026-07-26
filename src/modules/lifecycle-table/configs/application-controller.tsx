import { useRef, useState, type ReactElement } from 'react'
import type {
  Application,
  ApplicationMutationResult,
  CreateApplicationInput,
  LifecycleApplicationHistoryResult,
  RemovalInput,
  RestoreInput,
  UpdateApplicationCompanyInput,
  UpdateApplicationSourceInput,
  UpdatePursuitApplicationStatusInput,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'

import { WorkspaceClientUnavailableError } from '../../../app/app-load-failure'
import { DESKTOP_USER_ACTOR, newIdempotencyKey } from '../lifecycle-actor'
import { FormModal, requireRationale, type FieldSpec, type FieldErrors } from '../form-modal'
import type { LifecycleOutcome, LifecycleOutcomeActions } from '../lifecycle-outcome-types'
import { HistoryModal, OutcomeToast } from '../history-modal'
import { duplicateRecovery, outcomeForBlocker, removalBlockedOutcome } from '../lifecycle-result'
import { lifecycleKeys, type LifecycleScope } from '../lifecycle-queries'
import { afterPage, loadAllPages } from '../load-pages'
import type { LifecycleAggregateExtensions } from '../lifecycle-table'
import { useLifecycleCommand } from '../use-lifecycle-command'
import { useLifecycleHistory } from '../use-lifecycle-history'
import {
  PURSUIT_STATUS_CHOICES,
  REMOVAL_CHOICE_CHOICES,
} from './field-choices'

interface AppCreateDraft {
  opportunityId: string
  jobId: string
  expectedJobFactsRevision: string
}

interface AppStatusDraft {
  status: string
  rationale: string
}

interface AppCompanyDraft {
  companyName: string
  rationale: string
}

interface AppSourceDraft {
  sourceName: string
  rationale: string
}

interface AppRemoveDraft {
  choice: string
  rationale: string
}

interface AppRestoreDraft {
  rationale: string
}

type ApplicationCreateRetry = Pick<CreateApplicationInput, 'duplicateResolution'>

export interface ApplicationController {
  readonly extensions: LifecycleAggregateExtensions<Application>
  readonly modalLayer: ReactElement
  readonly openCreate: () => void
}

export function useApplicationController(params: {
  client: Pick<ValedictorianWorkspaceClient, 'applications'> | null
  scope: LifecycleScope
  refresh: () => Promise<void> | void
  refreshAll: () => Promise<void> | void
}): ApplicationController {
  const { client, scope, refresh, refreshAll } = params

  const [createOpen, setCreateOpen] = useState(false)
  const [statusTarget, setStatusTarget] = useState<Application | null>(null)
  const [companyTarget, setCompanyTarget] = useState<Application | null>(null)
  const [sourceTarget, setSourceTarget] = useState<Application | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Application | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<Application | null>(null)
  const [outcome, setOutcome] = useState<LifecycleOutcome | null>(null)
  const command = useLifecycleCommand((message) => {
    showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message }, message })
  })
  const pending = command.pending
  const history = useLifecycleHistory<Application>(
    lifecycleKeys.applications(scope),
    (candidate) => candidate.id,
    async (candidate) => {
      const entries = await loadAllPages<LifecycleApplicationHistoryResult['items'][number]>((after) =>
        requireClient().applications.history({ id: candidate.id, limit: 50, ...afterPage(after) }))
      return entries.map((entry) => ({
        revision: entry.revision,
        kind: entry.kind,
        actor: entry.audit.actor,
        timestamp: entry.audit.timestamp,
        summary: `${entry.kind} at revision ${entry.revision}`,
      }))
    },
  )
  const outcomeActions = useRef<LifecycleOutcomeActions>({})
  const createKey = useRef('')

  const [createDraft, setCreateDraft] = useState<AppCreateDraft>(emptyCreateDraft())
  const [statusDraft, setStatusDraft] = useState<AppStatusDraft>(emptyStatusDraft())
  const [companyDraft, setCompanyDraft] = useState<AppCompanyDraft>(emptyCompanyDraft())
  const [sourceDraft, setSourceDraft] = useState<AppSourceDraft>(emptySourceDraft())
  const [removeDraft, setRemoveDraft] = useState<AppRemoveDraft>(emptyRemoveDraft())
  const [restoreDraft, setRestoreDraft] = useState<AppRestoreDraft>(emptyRestoreDraft())
  const createDraftRef = useRef(createDraft)
  createDraftRef.current = createDraft

  function requireClient(): Pick<ValedictorianWorkspaceClient, 'applications'> {
    if (!client) throw new WorkspaceClientUnavailableError()
    return client
  }

  function showOutcome(next: LifecycleOutcome, actions: LifecycleOutcomeActions = {}) {
    outcomeActions.current = actions
    setOutcome(next)
  }

  function openCreate() {
    createKey.current = newIdempotencyKey('application-create')
    setCreateDraft(emptyCreateDraft())
    setOutcome(null)
    setCreateOpen(true)
  }
  function openStatus(row: Application) {
    setStatusDraft({ status: row.status, rationale: '' })
    setOutcome(null)
    setStatusTarget(row)
  }
  function openCompany(row: Application) { setCompanyDraft({ companyName: row.companyName, rationale: '' }); setOutcome(null); setCompanyTarget(row) }
  function openSource(row: Application) { setSourceDraft({ sourceName: row.sourceName, rationale: '' }); setOutcome(null); setSourceTarget(row) }
  function openRemove(row: Application) { setRemoveDraft(emptyRemoveDraft()); setOutcome(null); setRemoveTarget(row) }
  function openRestore(row: Application) { setRestoreDraft(emptyRestoreDraft()); setOutcome(null); setRestoreTarget(row) }


  function validateCreate(d: AppCreateDraft): FieldErrors<AppCreateDraft> | null {
    const fieldErrors: Record<string, string> = {}
    if (!d.opportunityId.trim()) fieldErrors.opportunityId = 'Opportunity id is required.'
    if (!d.jobId.trim()) fieldErrors.jobId = 'Job id is required.'
    if (!d.expectedJobFactsRevision.trim()) fieldErrors.expectedJobFactsRevision = 'Expected job facts revision is required.'
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }

  function submitCreate(d: AppCreateDraft, retry: ApplicationCreateRetry = {}) {
    command.run(async () => {
      const input: CreateApplicationInput = {
        idempotencyKey: createKey.current,
        actor: DESKTOP_USER_ACTOR,
        opportunityId: d.opportunityId.trim() as CreateApplicationInput['opportunityId'],
        jobId: d.jobId.trim() as CreateApplicationInput['jobId'],
        expectedJobFactsRevision: Number(d.expectedJobFactsRevision),
        initialLinks: [],
        ...retry,
      }
      const result: ApplicationMutationResult = await requireClient().applications.create(input)
      if (result.status === 'succeeded') {
        await refresh()
        showOutcome({ kind: 'succeeded' })
        setCreateOpen(false)
      } else {
        const blocked = outcomeForBlocker(result.blocker)
        showOutcome(blocked, duplicateRecovery(blocked, (choice) =>
          submitCreate(createDraftRef.current, {
            duplicateResolution: {
              action: choice.action,
              targetResourceId: choice.targetResourceId as NonNullable<CreateApplicationInput['duplicateResolution']>['targetResourceId'],
            },
          })))
      }
    })
  }

  function submitStatus(row: Application, d: AppStatusDraft) {
    command.run(async () => {
      const input: UpdatePursuitApplicationStatusInput = {
        applicationId: row.id,
        expectedRevision: row.revision,
        actor: DESKTOP_USER_ACTOR,
        status: d.status as UpdatePursuitApplicationStatusInput['status'],
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().applications.updateStatus(input)
      if (result.status === 'succeeded') {
        await refresh()
        showOutcome({ kind: 'succeeded' })
        setStatusTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    })
  }

  function submitCompany(row: Application, d: AppCompanyDraft) {
    command.run(async () => {
      const input: UpdateApplicationCompanyInput = {
        applicationId: row.id,
        expectedRevision: row.revision,
        actor: DESKTOP_USER_ACTOR,
        companyName: d.companyName.trim(),
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().applications.updateCompany(input)
      if (result.status === 'succeeded') {
        await refresh()
        showOutcome({ kind: 'succeeded' })
        setCompanyTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    })
  }

  function submitSource(row: Application, d: AppSourceDraft) {
    command.run(async () => {
      const input: UpdateApplicationSourceInput = {
        applicationId: row.id,
        expectedRevision: row.revision,
        actor: DESKTOP_USER_ACTOR,
        sourceName: d.sourceName.trim(),
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().applications.updateSource(input)
      if (result.status === 'succeeded') {
        await refresh()
        showOutcome({ kind: 'succeeded' })
        setSourceTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    })
  }

  function submitRemove(row: Application, d: AppRemoveDraft) {
    command.run(async () => {
      const input: RemovalInput = {
        id: row.id,
        choice: d.choice as RemovalInput['choice'],
        actor: DESKTOP_USER_ACTOR,
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().applications.remove(input)
      if (result.status === 'removed') {
        await refreshAll()
        showOutcome({ kind: 'removed', affectedDependentIds: result.affectedDependentIds })
        setRemoveTarget(null)
      } else {
        showOutcome(removalBlockedOutcome(d.choice as RemovalInput['choice'], result), {
          onResolveRemoval: (choice, rationale) => {
            const next = { choice, rationale }
            setRemoveDraft(next)
            submitRemove(row, next)
          },
        })
      }
    })
  }

  function submitRestore(row: Application, d: AppRestoreDraft) {
    command.run(async () => {
      const input: RestoreInput = { id: row.id, actor: DESKTOP_USER_ACTOR, rationale: d.rationale.trim() }
      const result = await requireClient().applications.restore(input)
      if (result.status === 'restored') {
        await refresh()
        showOutcome({ kind: 'restored', dependentLinks: result.dependentLinks })
        setRestoreTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    })
  }

  const extensions: LifecycleAggregateExtensions<Application> = {
    capabilities: (row) => ({
      add: true,
      edit: !row.removedAt,
      remove: !row.removedAt,
      restore: Boolean(row.removedAt),
      history: true,
      promote: false,
    }),
    formActions: [
      { key: 'add', label: 'Add application', modal: true, onActivate: () => openCreate() },
      { key: 'status', label: 'Update status', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openStatus(row) },
      { key: 'company', label: 'Update company', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openCompany(row) },
      { key: 'source', label: 'Update source', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openSource(row) },
      { key: 'remove', label: 'Remove application', modal: true, destructive: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openRemove(row) },
      { key: 'restore', label: 'Restore application', modal: true, disabled: (row) => !row.removedAt, onActivate: (row) => openRestore(row) },
    ],
    historyAction: { key: 'history', label: 'View history', modal: true, onActivate: history.open },
    promotionActions: [],
  }

  const createFields: ReadonlyArray<FieldSpec<AppCreateDraft>> = [
    { key: 'opportunityId', label: 'Opportunity id', inputType: 'text', required: true },
    { key: 'jobId', label: 'Job id', inputType: 'text', required: true },
    { key: 'expectedJobFactsRevision', label: 'Expected job facts revision', inputType: 'number', required: true },
  ]
  const statusFields: ReadonlyArray<FieldSpec<AppStatusDraft>> = [
    { key: 'status', label: 'Status', inputType: 'select', choices: PURSUIT_STATUS_CHOICES, required: true },
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const companyFields: ReadonlyArray<FieldSpec<AppCompanyDraft>> = [
    { key: 'companyName', label: 'Company name', inputType: 'text', required: true },
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const sourceFields: ReadonlyArray<FieldSpec<AppSourceDraft>> = [
    { key: 'sourceName', label: 'Source name', inputType: 'text', required: true },
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const removeFields: ReadonlyArray<FieldSpec<AppRemoveDraft>> = [
    { key: 'choice', label: 'Removal choice', inputType: 'select', choices: REMOVAL_CHOICE_CHOICES, required: true },
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const restoreFields: ReadonlyArray<FieldSpec<AppRestoreDraft>> = [
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]

  const modalLayer = (
    <>
      <FormModal
        open={createOpen}
        title="Add application"
        description="Promote an opportunity into a pursuit application."
        fields={createFields}
        value={createDraft}
        onChange={setCreateDraft}
        onSubmit={submitCreate}
        onCancel={() => setCreateOpen(false)}
        validate={validateCreate}
        pending={pending}
        submitLabel="Create"
      />
      <FormModal
        open={statusTarget !== null}
        title="Update status"
        description={statusTarget ? `Status for ${statusTarget.id}` : ''}
        fields={statusFields}
        value={statusDraft}
        onChange={setStatusDraft}
        onSubmit={(d) => { if (statusTarget) submitStatus(statusTarget, d) }}
        onCancel={() => setStatusTarget(null)}
        validate={requireRationale}
        pending={pending}
        submitLabel="Save"
      />
      <FormModal
        open={companyTarget !== null}
        title="Update company"
        description={companyTarget ? `Company for ${companyTarget.id}` : ''}
        fields={companyFields}
        value={companyDraft}
        onChange={setCompanyDraft}
        onSubmit={(d) => { if (companyTarget) submitCompany(companyTarget, d) }}
        onCancel={() => setCompanyTarget(null)}
        validate={requireRationale}
        pending={pending}
        submitLabel="Save"
      />
      <FormModal
        open={sourceTarget !== null}
        title="Update source"
        description={sourceTarget ? `Source for ${sourceTarget.id}` : ''}
        fields={sourceFields}
        value={sourceDraft}
        onChange={setSourceDraft}
        onSubmit={(d) => { if (sourceTarget) submitSource(sourceTarget, d) }}
        onCancel={() => setSourceTarget(null)}
        validate={requireRationale}
        pending={pending}
        submitLabel="Save"
      />
      <FormModal
        open={removeTarget !== null}
        title="Remove application"
        description={removeTarget ? `Removing ${removeTarget.id}` : ''}
        fields={removeFields}
        value={removeDraft}
        onChange={setRemoveDraft}
        onSubmit={(d) => { if (removeTarget) submitRemove(removeTarget, d) }}
        onCancel={() => setRemoveTarget(null)}
        validate={requireRationale}
        pending={pending}
        submitLabel="Remove"
      />
      <FormModal
        open={restoreTarget !== null}
        title="Restore application"
        description={restoreTarget ? `Restoring ${restoreTarget.id}` : ''}
        fields={restoreFields}
        value={restoreDraft}
        onChange={setRestoreDraft}
        onSubmit={(d) => { if (restoreTarget) submitRestore(restoreTarget, d) }}
        onCancel={() => setRestoreTarget(null)}
        validate={requireRationale}
        pending={pending}
        submitLabel="Restore"
      />
      <HistoryModal
        open={history.target !== null}
        title={history.target ? `History · ${history.target.id}` : 'History'}
        outcome={history.outcome}
        pending={history.pending}
        onClose={history.close}
      />
      {outcome ? <OutcomeToast outcome={outcome} pending={pending} onDismiss={() => setOutcome(null)} {...outcomeActions.current} /> : null}
    </>
  )

  return { extensions, modalLayer, openCreate }
}

function emptyCreateDraft(): AppCreateDraft {
  return { opportunityId: '', jobId: '', expectedJobFactsRevision: '' }
}
function emptyStatusDraft(): AppStatusDraft {
  return { status: 'active', rationale: '' }
}
function emptyCompanyDraft(): AppCompanyDraft {
  return { companyName: '', rationale: '' }
}
function emptySourceDraft(): AppSourceDraft {
  return { sourceName: '', rationale: '' }
}
function emptyRemoveDraft(): AppRemoveDraft {
  return { choice: 'preserve_historical_lineage', rationale: '' }
}
function emptyRestoreDraft(): AppRestoreDraft {
  return { rationale: '' }
}
