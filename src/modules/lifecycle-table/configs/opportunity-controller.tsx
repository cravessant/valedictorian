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

import { DESKTOP_USER_ACTOR, newIdempotencyKey } from '../lifecycle-actor'
import { FormModal, type FieldSpec, type FieldErrors } from '../form-modal'
import type { LifecycleOutcome, LifecycleOutcomeActions } from '../lifecycle-outcome-types'
import { HistoryModal, OutcomeToast } from '../history-modal'
import { outcomeForBlocker } from '../lifecycle-result'
import { loadHistory } from '../load-history'
import type { LifecycleAggregateExtensions } from '../lifecycle-table'
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
  refresh: () => Promise<void> | void
  refreshDestination: () => Promise<void> | void
  refreshAll: () => Promise<void> | void
}): OpportunityController {
  const { client, refresh, refreshDestination, refreshAll } = params

  const [createOpen, setCreateOpen] = useState(false)
  const [evalTarget, setEvalTarget] = useState<Opportunity | null>(null)
  const [dispositionTarget, setDispositionTarget] = useState<Opportunity | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Opportunity | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<Opportunity | null>(null)
  const [historyTarget, setHistoryTarget] = useState<Opportunity | null>(null)
  const [promoteTarget, setPromoteTarget] = useState<Opportunity | null>(null)
  const [outcome, setOutcome] = useState<LifecycleOutcome | null>(null)
  const [historyOutcome, setHistoryOutcome] = useState<LifecycleOutcome | null>(null)
  const [pending, setPending] = useState(false)
  const [historyPending, setHistoryPending] = useState(false)
  const outcomeActions = useRef<LifecycleOutcomeActions>({})
  const createKey = useRef('')
  const promotionKey = useRef('')
  const historyRequest = useRef(0)
  const clientRef = useRef(client)
  const refreshRef = useRef(refresh)
  const refreshDestinationRef = useRef(refreshDestination)
  const refreshAllRef = useRef(refreshAll)

  const [createDraft, setCreateDraft] = useState<OppCreateDraft>(emptyCreateDraft())
  const [evalDraft, setEvalDraft] = useState<OppEvalDraft>(emptyEvalDraft())
  const [dispositionDraft, setDispositionDraft] = useState<OppDispositionDraft>(emptyDispositionDraft())
  const [removeDraft, setRemoveDraft] = useState<OppRemoveDraft>(emptyRemoveDraft())
  const [restoreDraft, setRestoreDraft] = useState<OppRestoreDraft>(emptyRestoreDraft())
  const [promoteDraft, setPromoteDraft] = useState<OppPromoteDraft>(emptyPromoteDraft())
  const createDraftRef = useRef(createDraft)
  const promoteDraftRef = useRef(promoteDraft)
  clientRef.current = client
  refreshRef.current = refresh
  refreshDestinationRef.current = refreshDestination
  refreshAllRef.current = refreshAll
  createDraftRef.current = createDraft
  promoteDraftRef.current = promoteDraft

  function requireClient(): Pick<ValedictorianWorkspaceClient, 'opportunities'> {
    if (!clientRef.current) throw new Error('Workspace HTTP client is unavailable.')
    return clientRef.current
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
  async function openHistory(row: Opportunity) {
    const request = ++historyRequest.current
    setHistoryOutcome(null)
    setHistoryTarget(row)
    if (!client) { setHistoryOutcome({ kind: 'error', blocker: { code: 'workspace_ownership', message: 'Workspace HTTP client is unavailable.' }, message: 'Workspace HTTP client is unavailable.' }); return }
    setHistoryPending(true)
    try {
      const entries = await loadHistory<OpportunityHistoryResult['items'][number]>((cursor) =>
        client.opportunities.history({ id: row.id, limit: 50, ...(cursor ? { cursor } : {}) }))
      if (request !== historyRequest.current) return
      setHistoryOutcome({
        kind: 'history',
        entries: entries.map((entry) => ({
          revision: entry.revision,
          kind: entry.kind,
          actor: entry.audit.actor,
          timestamp: entry.audit.timestamp,
          summary: `${entry.kind} at revision ${entry.revision}`,
        })),
      })
    } catch (err) {
      if (request !== historyRequest.current) return
      setHistoryOutcome({ kind: 'error', blocker: { code: 'impossible_state', message: messageOf(err) }, message: messageOf(err) })
    } finally {
      if (request === historyRequest.current) setHistoryPending(false)
    }
  }
  function closeHistory() {
    historyRequest.current += 1
    setHistoryPending(false)
    setHistoryTarget(null)
  }

  function validateRationale<T extends { rationale: string }>(d: T): FieldErrors<T> | null {
    return d.rationale.trim() === '' ? { fieldErrors: { rationale: 'Rationale is required.' } as Partial<Record<keyof T & string, string>> } : null
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

  async function submitCreate(d: OppCreateDraft, retry: OpportunityCreateRetry = {}) {
    setPending(true)
    try {
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
        await refreshRef.current()
        showOutcome({ kind: 'succeeded' })
        setCreateOpen(false)
      } else {
        const blocked = outcomeForBlocker(result.blocker)
        showOutcome(blocked, blocked.kind === 'duplicate' ? {
          onResolveDuplicate: (choice) => {
            void submitCreate(createDraftRef.current, {
              duplicateResolution: {
                action: choice.action,
                targetResourceId: choice.targetResourceId as NonNullable<CreateOpportunityInput['duplicateResolution']>['targetResourceId'],
              },
            })
          },
        } : {})
      }
    } catch (err) {
      showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message: messageOf(err) }, message: messageOf(err) })
    } finally {
      setPending(false)
    }
  }

  async function submitEval(row: Opportunity, d: OppEvalDraft) {
    setPending(true)
    try {
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
        await refreshRef.current()
        showOutcome({ kind: 'succeeded' })
        setEvalTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    } catch (err) {
      showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message: messageOf(err) }, message: messageOf(err) })
    } finally {
      setPending(false)
    }
  }

  async function submitDisposition(row: Opportunity, d: OppDispositionDraft) {
    setPending(true)
    try {
      const input: UpdateOpportunityDispositionInput = {
        opportunityId: row.id,
        expectedRevision: row.revision,
        actor: DESKTOP_USER_ACTOR,
        disposition: d.disposition as UpdateOpportunityDispositionInput['disposition'],
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().opportunities.updateDisposition(input)
      if (result.status === 'succeeded') {
        await refreshRef.current()
        showOutcome({ kind: 'succeeded' })
        setDispositionTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    } catch (err) {
      showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message: messageOf(err) }, message: messageOf(err) })
    } finally {
      setPending(false)
    }
  }

  async function submitRemove(row: Opportunity, d: OppRemoveDraft) {
    setPending(true)
    try {
      const input: RemovalInput = {
        id: row.id,
        choice: d.choice as RemovalInput['choice'],
        actor: DESKTOP_USER_ACTOR,
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().opportunities.remove(input)
      if (result.status === 'removed') {
        await refreshAllRef.current()
        showOutcome({ kind: 'removed', affectedDependentIds: result.affectedDependentIds })
        setRemoveTarget(null)
      } else {
        showOutcome({
          kind: 'removal-blocked',
          blocker: result.blocker,
          message: result.blocker.message,
          choice: {
            choice: d.choice as RemovalInput['choice'],
            dependentIds: result.dependentIds,
            supportedChoices: result.supportedChoices,
          },
        }, {
          onResolveRemoval: (choice, rationale) => {
            const next = { choice, rationale }
            setRemoveDraft(next)
            void submitRemove(row, next)
          },
        })
      }
    } catch (err) {
      showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message: messageOf(err) }, message: messageOf(err) })
    } finally {
      setPending(false)
    }
  }

  async function submitRestore(row: Opportunity, d: OppRestoreDraft) {
    setPending(true)
    try {
      const input: RestoreInput = { id: row.id, actor: DESKTOP_USER_ACTOR, rationale: d.rationale.trim() }
      const result = await requireClient().opportunities.restore(input)
      if (result.status === 'restored') {
        await refreshRef.current()
        showOutcome({ kind: 'restored', dependentLinks: result.dependentLinks })
        setRestoreTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    } catch (err) {
      showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message: messageOf(err) }, message: messageOf(err) })
    } finally {
      setPending(false)
    }
  }

  async function submitPromote(row: Opportunity, d: OppPromoteDraft, retry: OpportunityPromotionRetry = {}) {
    setPending(true)
    try {
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
        await Promise.all([refreshRef.current(), refreshDestinationRef.current()])
        if (result.warnings.length > 0 && !input.override) {
          showOutcome(
            { kind: 'warnings', warnings: result.warnings, override: result.override },
            {
              onOverrideWarnings: (warningCodes, rationale) => {
                void submitPromote(row, promoteDraftRef.current, {
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
        showOutcome(blocked, blocked.kind === 'duplicate' ? {
          onResolveDuplicate: (choice) => {
            void submitPromote(row, promoteDraftRef.current, {
              ...retry,
              duplicateResolution: {
                action: choice.action,
                targetResourceId: choice.targetResourceId as NonNullable<PromoteOpportunityToApplicationInput['duplicateResolution']>['targetResourceId'],
              },
            })
          },
        } : {})
      }
    } catch (err) {
      showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message: messageOf(err) }, message: messageOf(err) })
    } finally {
      setPending(false)
    }
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
    historyAction: { key: 'history', label: 'View history', modal: true, onActivate: (row) => { void openHistory(row) } },
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
        onSubmit={(d) => { if (evalTarget) void submitEval(evalTarget, d) }}
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
        onSubmit={(d) => { if (dispositionTarget) void submitDisposition(dispositionTarget, d) }}
        onCancel={() => setDispositionTarget(null)}
        validate={validateRationale}
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
        onSubmit={(d) => { if (removeTarget) void submitRemove(removeTarget, d) }}
        onCancel={() => setRemoveTarget(null)}
        validate={validateRationale}
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
        onSubmit={(d) => { if (restoreTarget) void submitRestore(restoreTarget, d) }}
        onCancel={() => setRestoreTarget(null)}
        validate={validateRationale}
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
        onSubmit={(d) => { if (promoteTarget) void submitPromote(promoteTarget, d) }}
        onCancel={() => setPromoteTarget(null)}
        pending={pending}
        submitLabel="Promote"
      />
      <HistoryModal
        open={historyTarget !== null}
        title={historyTarget ? `History · ${historyTarget.id}` : 'History'}
        outcome={historyOutcome}
        pending={historyPending}
        onClose={closeHistory}
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Operation failed.'
}
