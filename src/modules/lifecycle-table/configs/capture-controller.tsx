import { useRef, useState, type ReactElement } from 'react'
import type {
  CaptureHistoryResult,
  CaptureListPresentation,
  CaptureMutationResult,
  CreateCaptureInput,
  RemovalChoice,
  RemovalInput,
  RestoreInput,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'

import { DESKTOP_USER_ACTOR } from '../lifecycle-actor'
import { FormModal, type FieldErrors, type FieldSpec } from '../form-modal'
import { HistoryModal, OutcomeToast } from '../history-modal'
import { afterPage, loadHistory } from '../load-history'
import type { LifecycleOutcome } from '../lifecycle-outcome-types'
import { EVIDENCE_MODE_CHOICES } from './field-choices'

interface CaptureDraft {
  evidenceMode: string
  adapterId: string
  adapterVersion: string
  observedAt: string
  providerRecordId: string
  providerSchema: string
}

interface CaptureRemovalDraft {
  choice: string
  rationale: string
}

interface CaptureRestoreDraft {
  rationale: string
}

interface CaptureRemovalBlocker {
  readonly dependentIds: ReadonlyArray<string>
  readonly supportedChoices: ReadonlyArray<RemovalChoice>
}

export interface CaptureController {
  readonly modalLayer: ReactElement
  readonly removalPending: boolean
  readonly openCreate: () => void
  readonly openHistory: (row: CaptureListPresentation) => void
  readonly openRemove: (row: CaptureListPresentation) => void
  readonly openRestore: (row: CaptureListPresentation) => void
}

export function useCaptureController(params: {
  client: Pick<ValedictorianWorkspaceClient, 'captures'> | null
  refresh: () => Promise<void> | void
  onRemoved?: (captureId: string) => void
}): CaptureController {
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<CaptureDraft>(emptyDraft())
  const [removeTarget, setRemoveTarget] = useState<CaptureListPresentation | null>(null)
  const [removeDraft, setRemoveDraft] = useState<CaptureRemovalDraft>(emptyRemovalDraft())
  const [removeBlocker, setRemoveBlocker] = useState<CaptureRemovalBlocker | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<CaptureListPresentation | null>(null)
  const [restoreDraft, setRestoreDraft] = useState<CaptureRestoreDraft>(emptyRestoreDraft())
  const [historyTarget, setHistoryTarget] = useState<CaptureListPresentation | null>(null)
  const [outcome, setOutcome] = useState<LifecycleOutcome | null>(null)
  const [historyOutcome, setHistoryOutcome] = useState<LifecycleOutcome | null>(null)
  const [pending, setPending] = useState(false)
  const [historyPending, setHistoryPending] = useState(false)
  const mutationInFlight = useRef(false)
  const historyRequest = useRef(0)
  const clientRef = useRef(params.client)
  const refreshRef = useRef(params.refresh)
  const onRemovedRef = useRef(params.onRemoved)
  clientRef.current = params.client
  refreshRef.current = params.refresh
  onRemovedRef.current = params.onRemoved

  function requireClient(): Pick<ValedictorianWorkspaceClient, 'captures'> {
    if (!clientRef.current) throw new Error('Workspace HTTP client is unavailable.')
    return clientRef.current
  }

  function openCreate() {
    setCreateDraft(emptyDraft())
    setOutcome(null)
    setCreateOpen(true)
  }

  function openRemove(row: CaptureListPresentation) {
    if (pending) return
    setRemoveDraft(emptyRemovalDraft())
    setRemoveBlocker(null)
    setOutcome(null)
    setRemoveTarget(row)
  }

  function openRestore(row: CaptureListPresentation) {
    setRestoreDraft(emptyRestoreDraft())
    setOutcome(null)
    setRestoreTarget(row)
  }

  async function openHistory(row: CaptureListPresentation) {
    const request = ++historyRequest.current
    setHistoryOutcome(null)
    setHistoryTarget(row)
    setHistoryPending(true)
    try {
      const entries = await loadHistory<CaptureHistoryResult['items'][number]>((after) =>
        requireClient().captures.history({ id: row.captureId, limit: 50, ...afterPage(after) }))
      if (request !== historyRequest.current) return
      setHistoryOutcome({
        kind: 'history',
        entries: entries.map((entry) => ({
          revision: entry.revision,
          kind: entry.kind,
          actor: entry.audit.actor,
          timestamp: entry.audit.timestamp,
          summary: `Capture ${entry.kind}.`,
        })),
      })
    } catch (error) {
      if (request !== historyRequest.current) return
      const message = messageOf(error)
      setHistoryOutcome({ kind: 'error', blocker: { code: 'impossible_state', message }, message })
    } finally {
      if (request === historyRequest.current) setHistoryPending(false)
    }
  }

  function closeHistory() {
    historyRequest.current += 1
    setHistoryPending(false)
    setHistoryTarget(null)
  }

  function validateCreate(value: CaptureDraft): FieldErrors<CaptureDraft> | null {
    const fieldErrors: Partial<Record<keyof CaptureDraft, string>> = {}
    if (!value.evidenceMode) fieldErrors.evidenceMode = 'Evidence mode is required.'
    if (!value.adapterId.trim()) fieldErrors.adapterId = 'Source id is required.'
    if (!value.adapterVersion.trim()) fieldErrors.adapterVersion = 'Source version is required.'
    if (!value.observedAt.trim()) fieldErrors.observedAt = 'Observed at is required.'
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }

  function validateRationale<T extends { rationale: string }>(value: T): FieldErrors<T> | null {
    return value.rationale.trim() === ''
      ? { fieldErrors: { rationale: 'Rationale is required.' } as Partial<Record<keyof T & string, string>> }
      : null
  }

  function validateRemoval(value: CaptureRemovalDraft): FieldErrors<CaptureRemovalDraft> | null {
    const fieldErrors: Partial<Record<keyof CaptureRemovalDraft, string>> = {}
    if (!value.rationale.trim()) fieldErrors.rationale = 'Rationale is required.'
    if (removeBlocker && !removeBlocker.supportedChoices.includes(value.choice as RemovalChoice)) {
      fieldErrors.choice = 'Choose one of the server-supported removal options.'
    }
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }

  async function submitCreate(value: CaptureDraft) {
    setPending(true)
    try {
      const input: CreateCaptureInput = {
        evidenceMode: value.evidenceMode as CreateCaptureInput['evidenceMode'],
        adapter: {
          id: value.adapterId.trim(),
          kind: 'manual',
          version: value.adapterVersion.trim(),
        },
        observedAt: value.observedAt.trim(),
        providerRecordId: value.providerRecordId.trim() || null,
        providerSchema: value.providerSchema.trim() || null,
        payload: null,
        evidence: [],
      }
      const result: CaptureMutationResult = await requireClient().captures.create(input)
      if (result.status !== 'succeeded') throw new Error(result.blocker.message)
      await refreshRef.current()
      setCreateOpen(false)
      setOutcome({ kind: 'succeeded' })
    } catch (error) {
      const message = messageOf(error, 'Capture creation failed.')
      setOutcome({ kind: 'error', blocker: { code: 'impossible_state', message }, message })
    } finally {
      setPending(false)
    }
  }

  async function submitRemove(row: CaptureListPresentation, value: CaptureRemovalDraft) {
    if (mutationInFlight.current) return
    mutationInFlight.current = true
    setPending(true)
    try {
      const choice = removeBlocker
        ? value.choice as RemovalChoice
        : 'reject_if_dependents' as const
      const input: RemovalInput = {
        id: row.captureId,
        choice,
        actor: DESKTOP_USER_ACTOR,
        rationale: value.rationale.trim(),
      }
      const result = await requireClient().captures.remove(input)
      if (result.status === 'blocked') {
        setRemoveBlocker({
          dependentIds: result.dependentIds,
          supportedChoices: result.supportedChoices,
        })
        setRemoveDraft((current) => ({
          ...current,
          choice: result.supportedChoices[0] ?? '',
        }))
        return
      }
      setRemoveBlocker(null)
      setRemoveTarget(null)
      onRemovedRef.current?.(row.captureId)
      try {
        await refreshRef.current()
        setOutcome({ kind: 'removed', affectedDependentIds: result.affectedDependentIds })
      } catch (error) {
        setOutcome({ kind: 'partial-success', action: 'removed', refreshError: messageOf(error, 'The current Capture projection could not be refreshed.') })
      }
    } catch (error) {
      const message = messageOf(error, 'Capture removal failed.')
      setOutcome({ kind: 'error', blocker: { code: 'impossible_state', message }, message })
    } finally {
      mutationInFlight.current = false
      setPending(false)
    }
  }

  async function submitRestore(row: CaptureListPresentation, value: CaptureRestoreDraft) {
    if (mutationInFlight.current) return
    mutationInFlight.current = true
    setPending(true)
    try {
      const input: RestoreInput = {
        id: row.captureId,
        actor: DESKTOP_USER_ACTOR,
        rationale: value.rationale.trim(),
      }
      const result = await requireClient().captures.restore(input)
      if (result.status === 'blocked') {
        setOutcome({
          kind: 'error',
          blocker: result.blocker,
          message: result.blocker.message,
        })
        return
      }
      setRestoreTarget(null)
      try {
        await refreshRef.current()
        setOutcome({
          kind: 'restored',
          dependentLinks: result.dependentLinks,
          message: 'Only this Capture was restored. Downstream resources are not restored automatically. It is now available in All and no longer appears in Removed.',
        })
      } catch (error) {
        setOutcome({ kind: 'partial-success', action: 'restored', refreshError: messageOf(error, 'The current Capture projection could not be refreshed.') })
      }
    } catch (error) {
      const message = messageOf(error, 'Capture restoration failed.')
      setOutcome({ kind: 'error', blocker: { code: 'impossible_state', message }, message })
    } finally {
      mutationInFlight.current = false
      setPending(false)
    }
  }

  const createFields: ReadonlyArray<FieldSpec<CaptureDraft>> = [
    { key: 'evidenceMode', label: 'Evidence mode', inputType: 'select', choices: EVIDENCE_MODE_CHOICES, required: true },
    { key: 'adapterId', label: 'Source id', inputType: 'text', placeholder: 'manual', required: true },
    { key: 'adapterVersion', label: 'Source version', inputType: 'text', placeholder: '1.0.0', required: true },
    { key: 'observedAt', label: 'Observed at', inputType: 'text', placeholder: '2026-07-23T12:00:00Z', required: true },
    { key: 'providerRecordId', label: 'Source record id', inputType: 'text' },
    { key: 'providerSchema', label: 'Source schema', inputType: 'text' },
  ]
  const removeFields: ReadonlyArray<FieldSpec<CaptureRemovalDraft>> = removeBlocker
    ? [
        {
          key: 'choice',
          label: 'Removal option',
          inputType: 'select',
          choices: removeBlocker.supportedChoices.map((choice) => ({
            value: choice,
            label: removalChoiceLabel(choice),
          })),
          required: true,
        },
        { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
      ]
    : [{ key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true }]
  const restoreFields: ReadonlyArray<FieldSpec<CaptureRestoreDraft>> = [
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]

  return {
    removalPending: removeTarget !== null && pending,
    openCreate,
    openHistory,
    openRemove,
    openRestore,
    modalLayer: (
      <>
        <FormModal
          open={createOpen}
          title="Add capture"
          description="Add a lead to the Capture inbox."
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
          open={removeTarget !== null}
          title="Remove Capture"
          description={removeTarget ? `Remove ${removeTarget.captureId} from the active Capture view.` : ''}
          fields={removeFields}
          value={removeDraft}
          onChange={setRemoveDraft}
          onSubmit={(value) => { if (removeTarget) void submitRemove(removeTarget, value) }}
          onCancel={() => { setRemoveTarget(null); setRemoveBlocker(null) }}
          validate={validateRemoval}
          pending={pending}
          submitLabel={removeBlocker ? 'Confirm removal' : 'Check and remove'}
          afterFields={<CaptureRemovalContext blocker={removeBlocker} />}
        />
        <FormModal
          open={restoreTarget !== null}
          title="Restore Capture"
          description={restoreTarget ? `Restore ${restoreTarget.captureId} to the active Capture view.` : ''}
          fields={restoreFields}
          value={restoreDraft}
          onChange={setRestoreDraft}
          onSubmit={(value) => { if (restoreTarget) void submitRestore(restoreTarget, value) }}
          onCancel={() => setRestoreTarget(null)}
          validate={validateRationale}
          pending={pending}
          submitLabel="Restore Capture"
          afterFields={<p className="text-sm text-muted-foreground">This restores only the Capture, not any downstream resources.</p>}
        />
        <HistoryModal
          open={historyTarget !== null}
          title={historyTarget ? `History · ${historyTarget.captureId}` : 'History'}
          outcome={historyOutcome}
          pending={historyPending}
          onClose={closeHistory}
        />
        {outcome ? <OutcomeToast outcome={outcome} pending={pending} onDismiss={() => setOutcome(null)} /> : null}
      </>
    ),
  }
}

function CaptureRemovalContext({ blocker }: { readonly blocker: CaptureRemovalBlocker | null }): ReactElement {
  if (!blocker) {
    return <p className="text-sm text-muted-foreground">First, check whether active Jobs depend on this Capture. Nothing downstream changes during this check.</p>
  }
  return (
    <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <p className="font-medium">Active dependents block this first removal attempt.</p>
      <div>
        <p className="text-xs">Dependent IDs:</p>
        <ul className="flex flex-wrap gap-1">
          {blocker.dependentIds.map((id) => <li key={id} className="rounded bg-destructive/20 px-1.5 py-0.5 font-mono text-xs">{id}</li>)}
        </ul>
      </div>
      <ul className="space-y-1 text-sm">
        {blocker.supportedChoices.map((choice) => <li key={choice}>{removalChoiceConsequence(choice)}</li>)}
      </ul>
    </div>
  )
}

function emptyDraft(): CaptureDraft {
  return {
    evidenceMode: 'reported',
    adapterId: '',
    adapterVersion: '',
    observedAt: '',
    providerRecordId: '',
    providerSchema: '',
  }
}

function emptyRemovalDraft(): CaptureRemovalDraft {
  return { choice: 'reject_if_dependents', rationale: '' }
}

function emptyRestoreDraft(): CaptureRestoreDraft {
  return { rationale: '' }
}

function removalChoiceLabel(choice: RemovalChoice): string {
  const labels: Record<RemovalChoice, string> = {
    reject_if_dependents: 'Check for active dependents',
    preserve_historical_lineage: 'Preserve historical lineage',
    unlink_dependents: 'Unlink dependents',
    cascade_tombstone: 'Tombstone downstream chain',
  }
  return labels[choice]
}

function removalChoiceConsequence(choice: RemovalChoice): string {
  const consequences: Record<RemovalChoice, string> = {
    reject_if_dependents: 'Check for active dependents without changing downstream resources.',
    preserve_historical_lineage: 'Preserve historical lineage: active Jobs remain linked to this Capture.',
    unlink_dependents: 'Unlink dependents: permanently remove Capture→Job evidence references.',
    cascade_tombstone: 'Tombstone downstream chain: tombstone this Capture and every linked downstream Job, Opportunity, and Application resource.',
  }
  return consequences[choice]
}

function messageOf(error: unknown, fallback = 'Operation failed.'): string {
  return error instanceof Error ? error.message : fallback
}
