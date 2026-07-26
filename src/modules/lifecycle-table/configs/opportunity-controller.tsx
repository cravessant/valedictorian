import { useRef, useState, type ReactElement } from 'react'
import type {
  CreateOpportunityInput,
  Opportunity,
  OpportunityHistoryResult,
  OpportunityMutationResult,
  PromoteOpportunityToApplicationInput,
  PromoteOpportunityToApplicationResult,
  RemovalInput,
  RestoreInput,
  UpdateOpportunityDispositionInput,
  UpdateOpportunityEvaluationInput,
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
  CUTOFF_CHOICES,
  DISPOSITION_CHOICES,
  FIT_CHOICES,
  REMOVAL_CHOICE_CHOICES,
} from './field-choices'

interface OppCreateDraft {
  jobId: string
  expectedJobFactsRevision: string
  fit: string
  rank: string
  cutoff: string
  disposition: string
}

interface OppEvalDraft {
  fit: string
  rank: string
  cutoff: string
}

interface OppDispositionDraft {
  disposition: string
  rationale: string
}

interface OppRemoveDraft {
  choice: string
  rationale: string
}

interface OppRestoreDraft {
  rationale: string
}

type OppPromoteDraft = Record<string, never>

type OpportunityCreateRetry = Pick<CreateOpportunityInput, 'duplicateResolution'>
type OpportunityPromotionRetry = Pick<PromoteOpportunityToApplicationInput, 'override' | 'duplicateResolution'>

export interface OpportunityController {
  readonly extensions: LifecycleAggregateExtensions<Opportunity>
  readonly modalLayer: ReactElement
  readonly openCreate: () => void
}

export function useOpportunityController(params: {
  client: Pick<ValedictorianWorkspaceClient, 'opportunities'> | null
  scope: LifecycleScope
  refresh: () => Promise<void> | void
  refreshDestination: () => Promise<void> | void
  refreshAll: () => Promise<void> | void
}): OpportunityController {
  const { client, scope, refresh, refreshDestination, refreshAll } = params

  const [createOpen, setCreateOpen] = useState(false)
  const [evalTarget, setEvalTarget] = useState<Opportunity | null>(null)
  const [dispositionTarget, setDispositionTarget] = useState<Opportunity | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Opportunity | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<Opportunity | null>(null)
  const [promoteTarget, setPromoteTarget] = useState<Opportunity | null>(null)
  const [outcome, setOutcome] = useState<LifecycleOutcome | null>(null)
  const command = useLifecycleCommand((message) => {
    showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message }, message })
  })
  const pending = command.pending
  const history = useLifecycleHistory<Opportunity>(
    lifecycleKeys.opportunities(scope),
    (candidate) => candidate.id,
    async (candidate) => {
      const entries = await loadAllPages<OpportunityHistoryResult['items'][number]>((after) =>
        requireClient().opportunities.history({ id: candidate.id, limit: 50, ...afterPage(after) }))
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
  const promotionKey = useRef('')

  const [createDraft, setCreateDraft] = useState<OppCreateDraft>(emptyCreateDraft())
  const [evalDraft, setEvalDraft] = useState<OppEvalDraft>(emptyEvalDraft())
  const [dispositionDraft, setDispositionDraft] = useState<OppDispositionDraft>(emptyDispositionDraft())
  const [removeDraft, setRemoveDraft] = useState<OppRemoveDraft>(emptyRemoveDraft())
  const [restoreDraft, setRestoreDraft] = useState<OppRestoreDraft>(emptyRestoreDraft())
  const [promoteDraft, setPromoteDraft] = useState<OppPromoteDraft>(emptyPromoteDraft())
  const createDraftRef = useRef(createDraft)
  const promoteDraftRef = useRef(promoteDraft)
  createDraftRef.current = createDraft
  promoteDraftRef.current = promoteDraft

  function requireClient(): Pick<ValedictorianWorkspaceClient, 'opportunities'> {
    if (!client) throw new WorkspaceClientUnavailableError()
    return client
  }

  function showOutcome(next: LifecycleOutcome, actions: LifecycleOutcomeActions = {}) {
    outcomeActions.current = actions
    setOutcome(next)
  }

  function openCreate() {
    createKey.current = newIdempotencyKey('opportunity-create')
    setCreateDraft(emptyCreateDraft())
    setOutcome(null)
    setCreateOpen(true)
  }
  function openEval(row: Opportunity) {
    setEvalDraft({ fit: row.fit, rank: row.rank === null ? '' : String(row.rank), cutoff: row.cutoff })
    setOutcome(null)
    setEvalTarget(row)
  }
  function openDisposition(row: Opportunity) {
    setDispositionDraft({ disposition: row.disposition, rationale: '' })
    setOutcome(null)
    setDispositionTarget(row)
  }
  function openRemove(row: Opportunity) { setRemoveDraft(emptyRemoveDraft()); setOutcome(null); setRemoveTarget(row) }
  function openRestore(row: Opportunity) { setRestoreDraft(emptyRestoreDraft()); setOutcome(null); setRestoreTarget(row) }
  function openPromote(row: Opportunity) {
    promotionKey.current = newIdempotencyKey('opportunity-promote')
    setPromoteDraft(emptyPromoteDraft())
    setOutcome(null)
    setPromoteTarget(row)
  }


  function validateEval(d: OppEvalDraft): FieldErrors<OppEvalDraft> | null {
    const fieldErrors: Record<string, string> = {}
    if (!d.fit) fieldErrors.fit = 'Fit is required.'
    if (!d.cutoff) fieldErrors.cutoff = 'Cutoff is required.'
    if (d.rank.trim() !== '' && !Number.isFinite(Number(d.rank))) fieldErrors.rank = 'Rank must be a number or blank.'
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }

  function validateCreate(d: OppCreateDraft): FieldErrors<OppCreateDraft> | null {
    const fieldErrors: Record<string, string> = {}
    if (!d.jobId.trim()) fieldErrors.jobId = 'Job id is required.'
    if (!d.expectedJobFactsRevision.trim()) fieldErrors.expectedJobFactsRevision = 'Expected job facts revision is required.'
    if (!d.fit) fieldErrors.fit = 'Fit is required.'
    if (!d.cutoff) fieldErrors.cutoff = 'Cutoff is required.'
    if (!d.disposition) fieldErrors.disposition = 'Disposition is required.'
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }

  function submitCreate(d: OppCreateDraft, retry: OpportunityCreateRetry = {}) {
    command.run(async () => {
      const input: CreateOpportunityInput = {
        idempotencyKey: createKey.current,
        actor: DESKTOP_USER_ACTOR,
        jobId: d.jobId.trim() as CreateOpportunityInput['jobId'],
        expectedJobFactsRevision: Number(d.expectedJobFactsRevision),
        fit: d.fit as CreateOpportunityInput['fit'],
        rank: d.rank.trim() === '' ? null : Number(d.rank),
        cutoff: d.cutoff as CreateOpportunityInput['cutoff'],
        disposition: d.disposition as CreateOpportunityInput['disposition'],
        ...retry,
      }
      const result: OpportunityMutationResult = await requireClient().opportunities.create(input)
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
              targetResourceId: choice.targetResourceId as NonNullable<CreateOpportunityInput['duplicateResolution']>['targetResourceId'],
            },
          })))
      }
    })
  }

  function submitEval(row: Opportunity, d: OppEvalDraft) {
    command.run(async () => {
      const input: UpdateOpportunityEvaluationInput = {
        opportunityId: row.id,
        expectedRevision: row.revision,
        actor: DESKTOP_USER_ACTOR,
        fit: d.fit as UpdateOpportunityEvaluationInput['fit'],
        rank: d.rank.trim() === '' ? null : Number(d.rank),
        cutoff: d.cutoff as UpdateOpportunityEvaluationInput['cutoff'],
      }
      const result = await requireClient().opportunities.updateEvaluation(input)
      if (result.status === 'succeeded') {
        await refresh()
        showOutcome({ kind: 'succeeded' })
        setEvalTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    })
  }

  function submitDisposition(row: Opportunity, d: OppDispositionDraft) {
    command.run(async () => {
      const input: UpdateOpportunityDispositionInput = {
        opportunityId: row.id,
        expectedRevision: row.revision,
        actor: DESKTOP_USER_ACTOR,
        disposition: d.disposition as UpdateOpportunityDispositionInput['disposition'],
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().opportunities.updateDisposition(input)
      if (result.status === 'succeeded') {
        await refresh()
        showOutcome({ kind: 'succeeded' })
        setDispositionTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    })
  }

  function submitRemove(row: Opportunity, d: OppRemoveDraft) {
    command.run(async () => {
      const input: RemovalInput = {
        id: row.id,
        choice: d.choice as RemovalInput['choice'],
        actor: DESKTOP_USER_ACTOR,
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().opportunities.remove(input)
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

  function submitRestore(row: Opportunity, d: OppRestoreDraft) {
    command.run(async () => {
      const input: RestoreInput = { id: row.id, actor: DESKTOP_USER_ACTOR, rationale: d.rationale.trim() }
      const result = await requireClient().opportunities.restore(input)
      if (result.status === 'restored') {
        await refresh()
        showOutcome({ kind: 'restored', dependentLinks: result.dependentLinks })
        setRestoreTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    })
  }

  function submitPromote(row: Opportunity, d: OppPromoteDraft, retry: OpportunityPromotionRetry = {}) {
    command.run(async () => {
      const input: PromoteOpportunityToApplicationInput = {
        idempotencyKey: promotionKey.current,
        actor: DESKTOP_USER_ACTOR,
        opportunityId: row.id,
        expectedJobId: row.jobId as PromoteOpportunityToApplicationInput['expectedJobId'],
        initialLinks: [],
        ...retry,
      }
      const result: PromoteOpportunityToApplicationResult = await requireClient().opportunities.promoteToApplication(input)
      void d
      if (result.status === 'promoted') {
        await Promise.all([refresh(), refreshDestination()])
        if (result.warnings.length > 0 && !input.override) {
          showOutcome(
            { kind: 'warnings', warnings: result.warnings, override: result.override },
            {
              onOverrideWarnings: (warningCodes, rationale) => {
                submitPromote(row, promoteDraftRef.current, {
                  ...retry,
                  override: { actor: DESKTOP_USER_ACTOR, rationale, warningCodes: [...warningCodes] },
                })
              },
            },
          )
          return
        }
        showOutcome({ kind: 'succeeded' })
        setPromoteTarget(null)
      } else {
        const blocked = outcomeForBlocker(result.blocker)
        showOutcome(blocked, duplicateRecovery(blocked, (choice) =>
          submitPromote(row, promoteDraftRef.current, {
            ...retry,
            duplicateResolution: {
              action: choice.action,
              targetResourceId: choice.targetResourceId as NonNullable<PromoteOpportunityToApplicationInput['duplicateResolution']>['targetResourceId'],
            },
          })))
      }
    })
  }

  const extensions: LifecycleAggregateExtensions<Opportunity> = {
    capabilities: (row) => ({
      add: true,
      edit: !row.removedAt,
      remove: !row.removedAt,
      restore: Boolean(row.removedAt),
      history: true,
      promote: !row.removedAt,
    }),
    formActions: [
      { key: 'add', label: 'Add opportunity', modal: true, onActivate: () => openCreate() },
      { key: 'evaluate', label: 'Update evaluation', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openEval(row) },
      { key: 'disposition', label: 'Update disposition', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openDisposition(row) },
      { key: 'remove', label: 'Remove opportunity', modal: true, destructive: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openRemove(row) },
      { key: 'restore', label: 'Restore opportunity', modal: true, disabled: (row) => !row.removedAt, onActivate: (row) => openRestore(row) },
    ],
    historyAction: { key: 'history', label: 'View history', modal: true, onActivate: history.open },
    promotionActions: [
      { key: 'promote-to-application', label: 'Promote to application', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openPromote(row) },
    ],
  }

  const createFields: ReadonlyArray<FieldSpec<OppCreateDraft>> = [
    { key: 'jobId', label: 'Job id', inputType: 'text', required: true },
    { key: 'expectedJobFactsRevision', label: 'Expected job facts revision', inputType: 'number', required: true },
    { key: 'fit', label: 'Fit', inputType: 'select', choices: FIT_CHOICES, required: true },
    { key: 'rank', label: 'Rank (blank for null)', inputType: 'text' },
    { key: 'cutoff', label: 'Cutoff', inputType: 'select', choices: CUTOFF_CHOICES, required: true },
    { key: 'disposition', label: 'Disposition', inputType: 'select', choices: DISPOSITION_CHOICES, required: true },
  ]
  const evalFields: ReadonlyArray<FieldSpec<OppEvalDraft>> = [
    { key: 'fit', label: 'Fit', inputType: 'select', choices: FIT_CHOICES, required: true },
    { key: 'rank', label: 'Rank (blank for null)', inputType: 'text' },
    { key: 'cutoff', label: 'Cutoff', inputType: 'select', choices: CUTOFF_CHOICES, required: true },
  ]
  const dispositionFields: ReadonlyArray<FieldSpec<OppDispositionDraft>> = [
    { key: 'disposition', label: 'Disposition', inputType: 'select', choices: DISPOSITION_CHOICES, required: true },
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const removeFields: ReadonlyArray<FieldSpec<OppRemoveDraft>> = [
    { key: 'choice', label: 'Removal choice', inputType: 'select', choices: REMOVAL_CHOICE_CHOICES, required: true },
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const restoreFields: ReadonlyArray<FieldSpec<OppRestoreDraft>> = [
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const promoteFields: ReadonlyArray<FieldSpec<OppPromoteDraft>> = []

  const modalLayer = (
    <>
      <FormModal
        open={createOpen}
        title="Add opportunity"
        description="Evaluate a job into an opportunity."
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
        open={evalTarget !== null}
        title="Update evaluation"
        description={evalTarget ? `Evaluating ${evalTarget.id} at revision ${evalTarget.revision}` : ''}
        fields={evalFields}
        value={evalDraft}
        onChange={setEvalDraft}
        onSubmit={(d) => { if (evalTarget) submitEval(evalTarget, d) }}
        onCancel={() => setEvalTarget(null)}
        validate={validateEval}
        pending={pending}
        submitLabel="Save"
      />
      <FormModal
        open={dispositionTarget !== null}
        title="Update disposition"
        description={dispositionTarget ? `Disposition for ${dispositionTarget.id}` : ''}
        fields={dispositionFields}
        value={dispositionDraft}
        onChange={setDispositionDraft}
        onSubmit={(d) => { if (dispositionTarget) submitDisposition(dispositionTarget, d) }}
        onCancel={() => setDispositionTarget(null)}
        validate={requireRationale}
        pending={pending}
        submitLabel="Save"
      />
      <FormModal
        open={removeTarget !== null}
        title="Remove opportunity"
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
        title="Restore opportunity"
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
      <FormModal
        open={promoteTarget !== null}
        title="Promote opportunity to application"
        description={promoteTarget ? `Promoting ${promoteTarget.id}` : ''}
        fields={promoteFields}
        value={promoteDraft}
        onChange={setPromoteDraft}
        onSubmit={(d) => { if (promoteTarget) submitPromote(promoteTarget, d) }}
        onCancel={() => setPromoteTarget(null)}
        pending={pending}
        submitLabel="Promote"
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

function emptyCreateDraft(): OppCreateDraft {
  return { jobId: '', expectedJobFactsRevision: '', fit: 'unknown', rank: '', cutoff: 'not_evaluated', disposition: 'reviewing' }
}
function emptyEvalDraft(): OppEvalDraft {
  return { fit: 'unknown', rank: '', cutoff: 'not_evaluated' }
}
function emptyDispositionDraft(): OppDispositionDraft {
  return { disposition: 'reviewing', rationale: '' }
}
function emptyRemoveDraft(): OppRemoveDraft {
  return { choice: 'preserve_historical_lineage', rationale: '' }
}
function emptyRestoreDraft(): OppRestoreDraft {
  return { rationale: '' }
}
function emptyPromoteDraft(): OppPromoteDraft {
  return {}
}
