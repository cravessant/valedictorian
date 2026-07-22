import { useRef, useState, type ReactElement } from 'react'
import type {
  Capture,
  CaptureHistoryResult,
  CaptureMutationResult,
  CorrectCaptureInput,
  CreateCaptureInput,
  PromoteCaptureToJobInput,
  PromoteCaptureToJobResult,
  RemovalInput,
  RestoreInput,
  ValedictorianWorkspaceClient,
} from 'sparxie'

import { DESKTOP_USER_ACTOR, newIdempotencyKey } from '../lifecycle-actor'
import { FormModal, type FieldSpec, type FieldErrors } from '../form-modal'
import type { LifecycleOutcome, LifecycleOutcomeActions } from '../lifecycle-outcome-types'
import { HistoryModal, OutcomeToast } from '../history-modal'
import { outcomeForBlocker } from '../lifecycle-result'
import { loadHistory } from '../load-history'
import type { LifecycleAggregateExtensions } from '../lifecycle-table'
import {
  ADAPTER_KIND_CHOICES,
  EVIDENCE_MODE_CHOICES,
  REMOVAL_CHOICE_CHOICES,
  ROLE_KIND_CHOICES,
  EMPLOYMENT_TYPE_CHOICES,
  SENIORITY_CHOICES,
  TIMING_MODE_CHOICES,
  WORK_MODE_CHOICES,
} from './field-choices'

interface CaptureDraft {
  evidenceMode: string
  adapterId: string
  adapterKind: string
  adapterVersion: string
  observedAt: string
  providerRecordId: string
  providerSchema: string
}

interface CaptureCorrectDraft {
  providerRecordId: string
  providerSchema: string
  rationale: string
}

interface CapturePromoteDraft {
  companyName: string
  roleTitle: string
  sourceName: string
  roleKind: string
  timingMode: string
  workMode: string
  employmentType: string
  seniority: string
}

interface CaptureRemoveDraft {
  choice: string
  rationale: string
}

interface CaptureRestoreDraft {
  rationale: string
}

type CapturePromotionRetry = Pick<PromoteCaptureToJobInput, 'override' | 'duplicateResolution'>

export interface CaptureController {
  readonly extensions: LifecycleAggregateExtensions<Capture>
  readonly modalLayer: ReactElement
  readonly openCreate: () => void
}

export function useCaptureController(params: {
  client: Pick<ValedictorianWorkspaceClient, 'captures'> | null
  refresh: () => Promise<void> | void
  refreshDestination: () => Promise<void> | void
  refreshAll: () => Promise<void> | void
}): CaptureController {
  const { client, refresh, refreshDestination, refreshAll } = params

  const [createOpen, setCreateOpen] = useState(false)
  const [correctTarget, setCorrectTarget] = useState<Capture | null>(null)
  const [promoteTarget, setPromoteTarget] = useState<Capture | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Capture | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<Capture | null>(null)
  const [historyTarget, setHistoryTarget] = useState<Capture | null>(null)
  const [outcome, setOutcome] = useState<LifecycleOutcome | null>(null)
  const [historyOutcome, setHistoryOutcome] = useState<LifecycleOutcome | null>(null)
  const [pending, setPending] = useState(false)
  const [historyPending, setHistoryPending] = useState(false)
  const outcomeActions = useRef<LifecycleOutcomeActions>({})
  const promotionKey = useRef('')
  const historyRequest = useRef(0)
  const clientRef = useRef(client)
  const refreshRef = useRef(refresh)
  const refreshDestinationRef = useRef(refreshDestination)
  const refreshAllRef = useRef(refreshAll)

  const [createDraft, setCreateDraft] = useState<CaptureDraft>(emptyCreateDraft())
  const [correctDraft, setCorrectDraft] = useState<CaptureCorrectDraft>(emptyCorrectDraft())
  const [promoteDraft, setPromoteDraft] = useState<CapturePromoteDraft>(emptyPromoteDraft())
  const [removeDraft, setRemoveDraft] = useState<CaptureRemoveDraft>(emptyRemoveDraft())
  const [restoreDraft, setRestoreDraft] = useState<CaptureRestoreDraft>(emptyRestoreDraft())
  const promoteDraftRef = useRef(promoteDraft)
  clientRef.current = client
  refreshRef.current = refresh
  refreshDestinationRef.current = refreshDestination
  refreshAllRef.current = refreshAll
  promoteDraftRef.current = promoteDraft

  function requireClient(): Pick<ValedictorianWorkspaceClient, 'captures'> {
    if (!clientRef.current) throw new Error('Workspace HTTP client is unavailable.')
    return clientRef.current
  }

  function showOutcome(next: LifecycleOutcome, actions: LifecycleOutcomeActions = {}) {
    outcomeActions.current = actions
    setOutcome(next)
  }

  function openCreate() { setCreateDraft(emptyCreateDraft()); setOutcome(null); setCreateOpen(true) }
  function openCorrect(row: Capture) {
    setCorrectDraft({
      providerRecordId: row.providerRecordId ?? '',
      providerSchema: row.providerSchema ?? '',
      rationale: '',
    })
    setOutcome(null)
    setCorrectTarget(row)
  }
  function openPromote(row: Capture) {
    promotionKey.current = newIdempotencyKey('capture-promote')
    setPromoteDraft(emptyPromoteDraft())
    setOutcome(null)
    setPromoteTarget(row)
  }
  function openRemove(row: Capture) { setRemoveDraft(emptyRemoveDraft()); setOutcome(null); setRemoveTarget(row) }
  function openRestore(row: Capture) { setRestoreDraft(emptyRestoreDraft()); setOutcome(null); setRestoreTarget(row) }
  async function openHistory(row: Capture) {
    const request = ++historyRequest.current
    setHistoryOutcome(null)
    setHistoryTarget(row)
    if (!client) { setHistoryOutcome({ kind: 'error', blocker: { code: 'workspace_ownership', message: 'Workspace HTTP client is unavailable.' }, message: 'Workspace HTTP client is unavailable.' }); return }
    setHistoryPending(true)
    try {
      const entries = await loadHistory<CaptureHistoryResult['items'][number]>((cursor) =>
        client.captures.history({ id: row.id, limit: 50, ...(cursor ? { cursor } : {}) }))
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

  function validateCreate(d: CaptureDraft): FieldErrors<CaptureDraft> | null {
    const fieldErrors: Record<string, string> = {}
    if (!d.evidenceMode) fieldErrors.evidenceMode = 'Evidence mode is required.'
    if (!d.adapterId.trim()) fieldErrors.adapterId = 'Adapter id is required.'
    if (!d.adapterKind) fieldErrors.adapterKind = 'Adapter kind is required.'
    if (!d.adapterVersion.trim()) fieldErrors.adapterVersion = 'Adapter version is required.'
    if (!d.observedAt.trim()) fieldErrors.observedAt = 'Observed at is required.'
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }

  function validateRationaleOnly<T extends { rationale: string }>(d: T): FieldErrors<T> | null {
    return d.rationale.trim() === '' ? { fieldErrors: { rationale: 'Rationale is required.' } as Partial<Record<keyof T & string, string>> } : null
  }

  function validatePromote(d: CapturePromoteDraft): FieldErrors<CapturePromoteDraft> | null {
    const fieldErrors: Record<string, string> = {}
    if (!d.companyName.trim()) fieldErrors.companyName = 'Company name is required.'
    if (!d.roleTitle.trim()) fieldErrors.roleTitle = 'Role title is required.'
    if (!d.sourceName.trim()) fieldErrors.sourceName = 'Source name is required.'
    if (!d.roleKind) fieldErrors.roleKind = 'Role kind is required.'
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }

  async function submitCreate(d: CaptureDraft) {
    setPending(true)
    try {
      const input: CreateCaptureInput = {
        evidenceMode: d.evidenceMode as CreateCaptureInput['evidenceMode'],
        adapter: {
          id: d.adapterId.trim(),
          kind: d.adapterKind as CreateCaptureInput['adapter']['kind'],
          version: d.adapterVersion.trim(),
        },
        observedAt: d.observedAt.trim(),
        providerRecordId: d.providerRecordId.trim() || null,
        providerSchema: d.providerSchema.trim() || null,
        payload: null,
        evidence: [],
      }
      const result: CaptureMutationResult = await requireClient().captures.create(input)
      if (result.status === 'succeeded') {
        await refreshRef.current()
        showOutcome({ kind: 'succeeded' })
        setCreateOpen(false)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    } catch (err) {
      showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message: messageOf(err) }, message: messageOf(err) })
    } finally {
      setPending(false)
    }
  }

  async function submitCorrect(row: Capture, d: CaptureCorrectDraft) {
    setPending(true)
    try {
      const input: CorrectCaptureInput = {
        captureId: row.id,
        expectedRevision: row.revision,
        actor: DESKTOP_USER_ACTOR,
        rationale: d.rationale.trim(),
        correction: {
          providerRecordId: d.providerRecordId.trim() || null,
          providerSchema: d.providerSchema.trim() || null,
        },
      }
      const result = await requireClient().captures.correct(input)
      if (result.status === 'succeeded') {
        await refreshRef.current()
        showOutcome({ kind: 'succeeded' })
        setCorrectTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    } catch (err) {
      showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message: messageOf(err) }, message: messageOf(err) })
    } finally {
      setPending(false)
    }
  }

  async function submitPromote(row: Capture, d: CapturePromoteDraft, retry: CapturePromotionRetry = {}) {
    setPending(true)
    try {
      const input: PromoteCaptureToJobInput = {
        idempotencyKey: promotionKey.current,
        actor: DESKTOP_USER_ACTOR,
        captureId: row.id,
        captureRevision: row.revision,
        selectedFacts: {
          companyName: d.companyName.trim(),
          roleTitle: d.roleTitle.trim(),
          sourceName: d.sourceName.trim(),
          roleKind: d.roleKind as PromoteCaptureToJobInput['selectedFacts']['roleKind'],
          term: null,
          terms: [],
          timingMode: d.timingMode as PromoteCaptureToJobInput['selectedFacts']['timingMode'],
          startDate: null,
          endDate: null,
          location: null,
          workMode: d.workMode as PromoteCaptureToJobInput['selectedFacts']['workMode'],
          employmentType: d.employmentType as PromoteCaptureToJobInput['selectedFacts']['employmentType'],
          seniority: d.seniority as PromoteCaptureToJobInput['selectedFacts']['seniority'],
          compensation: null,
          postedAt: null,
          destination: null,
        },
        evidenceReferences: [],
        externalIdentities: [],
        ...retry,
      }
      const result: PromoteCaptureToJobResult = await requireClient().captures.promoteToJob(input)
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
                targetResourceId: choice.targetResourceId as NonNullable<PromoteCaptureToJobInput['duplicateResolution']>['targetResourceId'],
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

  async function submitRemove(row: Capture, d: CaptureRemoveDraft) {
    setPending(true)
    try {
      const input: RemovalInput = {
        id: row.id,
        choice: d.choice as RemovalInput['choice'],
        actor: DESKTOP_USER_ACTOR,
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().captures.remove(input)
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

  async function submitRestore(row: Capture, d: CaptureRestoreDraft) {
    setPending(true)
    try {
      const input: RestoreInput = {
        id: row.id,
        actor: DESKTOP_USER_ACTOR,
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().captures.restore(input)
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

  const extensions: LifecycleAggregateExtensions<Capture> = {
    capabilities: (row) => ({
      add: true,
      edit: !row.removedAt,
      remove: !row.removedAt,
      restore: Boolean(row.removedAt),
      history: true,
      promote: !row.removedAt,
    }),
    formActions: [
      { key: 'add', label: 'Add capture', modal: true, onActivate: () => openCreate() },
      { key: 'correct', label: 'Correct capture', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openCorrect(row) },
      { key: 'remove', label: 'Remove capture', modal: true, destructive: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openRemove(row) },
      { key: 'restore', label: 'Restore capture', modal: true, disabled: (row) => !row.removedAt, onActivate: (row) => openRestore(row) },
    ],
    historyAction: { key: 'history', label: 'View history', modal: true, onActivate: (row) => { void openHistory(row) } },
    promotionActions: [
      { key: 'promote-to-job', label: 'Promote to job', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openPromote(row) },
    ],
  }

  const createFields: ReadonlyArray<FieldSpec<CaptureDraft>> = [
    { key: 'evidenceMode', label: 'Evidence mode', inputType: 'select', choices: EVIDENCE_MODE_CHOICES, required: true },
    { key: 'adapterId', label: 'Adapter id', inputType: 'text', placeholder: 'jobright', required: true },
    { key: 'adapterKind', label: 'Adapter kind', inputType: 'select', choices: ADAPTER_KIND_CHOICES, required: true },
    { key: 'adapterVersion', label: 'Adapter version', inputType: 'text', placeholder: '0.1.0', required: true },
    { key: 'observedAt', label: 'Observed at', inputType: 'text', placeholder: '2025-01-01T00:00:00Z', required: true },
    { key: 'providerRecordId', label: 'Provider record id', inputType: 'text' },
    { key: 'providerSchema', label: 'Provider schema', inputType: 'text' },
  ]
  const correctFields: ReadonlyArray<FieldSpec<CaptureCorrectDraft>> = [
    { key: 'providerRecordId', label: 'Provider record id', inputType: 'text' },
    { key: 'providerSchema', label: 'Provider schema', inputType: 'text' },
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const promoteFields: ReadonlyArray<FieldSpec<CapturePromoteDraft>> = [
    { key: 'companyName', label: 'Company name', inputType: 'text', required: true },
    { key: 'roleTitle', label: 'Role title', inputType: 'text', required: true },
    { key: 'sourceName', label: 'Source name', inputType: 'text', required: true },
    { key: 'roleKind', label: 'Role kind', inputType: 'select', choices: ROLE_KIND_CHOICES, required: true },
    { key: 'timingMode', label: 'Timing mode', inputType: 'select', choices: TIMING_MODE_CHOICES, required: true },
    { key: 'workMode', label: 'Work mode', inputType: 'select', choices: WORK_MODE_CHOICES, required: true },
    { key: 'employmentType', label: 'Employment type', inputType: 'select', choices: EMPLOYMENT_TYPE_CHOICES, required: true },
    { key: 'seniority', label: 'Seniority', inputType: 'select', choices: SENIORITY_CHOICES, required: true },
  ]
  const removeFields: ReadonlyArray<FieldSpec<CaptureRemoveDraft>> = [
    { key: 'choice', label: 'Removal choice', inputType: 'select', choices: REMOVAL_CHOICE_CHOICES, required: true },
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const restoreFields: ReadonlyArray<FieldSpec<CaptureRestoreDraft>> = [
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]

  const modalLayer = (
    <>
      <FormModal
        open={createOpen}
        title="Add capture"
        description="Author a new capture record."
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
        open={correctTarget !== null}
        title="Correct capture"
        description={correctTarget ? `Correcting ${correctTarget.id} at revision ${correctTarget.revision}` : ''}
        fields={correctFields}
        value={correctDraft}
        onChange={setCorrectDraft}
        onSubmit={(d) => { if (correctTarget) void submitCorrect(correctTarget, d) }}
        onCancel={() => setCorrectTarget(null)}
        validate={validateRationaleOnly}
        pending={pending}
        submitLabel="Correct"
      />
      <FormModal
        open={promoteTarget !== null}
        title="Promote capture to job"
        description={promoteTarget ? `Promoting ${promoteTarget.id}` : ''}
        fields={promoteFields}
        value={promoteDraft}
        onChange={setPromoteDraft}
        onSubmit={(d) => { if (promoteTarget) void submitPromote(promoteTarget, d) }}
        onCancel={() => setPromoteTarget(null)}
        validate={validatePromote}
        pending={pending}
        submitLabel="Promote"
      />
      <FormModal
        open={removeTarget !== null}
        title="Remove capture"
        description={removeTarget ? `Removing ${removeTarget.id}` : ''}
        fields={removeFields}
        value={removeDraft}
        onChange={setRemoveDraft}
        onSubmit={(d) => { if (removeTarget) void submitRemove(removeTarget, d) }}
        onCancel={() => setRemoveTarget(null)}
        validate={validateRationaleOnly}
        pending={pending}
        submitLabel="Remove"
      />
      <FormModal
        open={restoreTarget !== null}
        title="Restore capture"
        description={restoreTarget ? `Restoring ${restoreTarget.id}` : ''}
        fields={restoreFields}
        value={restoreDraft}
        onChange={setRestoreDraft}
        onSubmit={(d) => { if (restoreTarget) void submitRestore(restoreTarget, d) }}
        onCancel={() => setRestoreTarget(null)}
        validate={validateRationaleOnly}
        pending={pending}
        submitLabel="Restore"
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

function emptyCreateDraft(): CaptureDraft {
  return { evidenceMode: 'reported', adapterId: '', adapterKind: 'connector', adapterVersion: '', observedAt: '', providerRecordId: '', providerSchema: '' }
}
function emptyCorrectDraft(): CaptureCorrectDraft {
  return { providerRecordId: '', providerSchema: '', rationale: '' }
}
function emptyPromoteDraft(): CapturePromoteDraft {
  return { companyName: '', roleTitle: '', sourceName: '', roleKind: 'new_grad', timingMode: 'unknown', workMode: 'unknown', employmentType: 'full_time', seniority: 'entry' }
}
function emptyRemoveDraft(): CaptureRemoveDraft {
  return { choice: 'preserve_historical_lineage', rationale: '' }
}
function emptyRestoreDraft(): CaptureRestoreDraft {
  return { rationale: '' }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Operation failed.'
}
