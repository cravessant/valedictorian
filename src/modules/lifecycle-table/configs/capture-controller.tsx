import { useState, type ReactElement } from 'react'
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

import { WorkspaceClientUnavailableError } from '../../../app/app-load-failure'
import { DESKTOP_USER_ACTOR } from '../lifecycle-actor'
import { FormModal, requireRationale, type FieldErrors, type FieldSpec } from '../form-modal'
import { lifecycleKeys, type LifecycleScope } from '../lifecycle-queries'
import { LifecycleBlockerError, commandFailureMessage } from '../use-lifecycle-command'
import { useLifecycleHistory } from '../use-lifecycle-history'
import { useLifecycleOutcome } from '../use-lifecycle-outcome'
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
  scope: LifecycleScope
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
  const outcome = useLifecycleOutcome()
  const pending = outcome.pending
  const history = useLifecycleHistory<CaptureListPresentation, CaptureHistoryResult['items'][number]>(
    lifecycleKeys.captures(params.scope),
    (row) => row.captureId,
    (row, page) => requireClient().captures.history({ id: row.captureId, ...page }),
    (entry) => ({ revision: entry.revision, summary: `Capture ${entry.kind}.` }),
  )
  function requireClient(): Pick<ValedictorianWorkspaceClient, 'captures'> {
    if (!params.client) throw new WorkspaceClientUnavailableError()
    return params.client
  }

  function openCreate() {
    setCreateDraft(emptyDraft())
    outcome.clear()
    setCreateOpen(true)
  }

  function openRemove(row: CaptureListPresentation) {
    if (pending) return
    setRemoveDraft(emptyRemovalDraft())
    setRemoveBlocker(null)
    outcome.clear()
    setRemoveTarget(row)
  }

  function openRestore(row: CaptureListPresentation) {
    setRestoreDraft(emptyRestoreDraft())
    outcome.clear()
    setRestoreTarget(row)
  }

  function validateCreate(value: CaptureDraft): FieldErrors<CaptureDraft> | null {
    const fieldErrors: Partial<Record<keyof CaptureDraft, string>> = {}
    if (!value.evidenceMode) fieldErrors.evidenceMode = 'Evidence mode is required.'
    if (!value.adapterId.trim()) fieldErrors.adapterId = 'Source id is required.'
    if (!value.adapterVersion.trim()) fieldErrors.adapterVersion = 'Source version is required.'
    if (!value.observedAt.trim()) fieldErrors.observedAt = 'Observed at is required.'
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }


  function validateRemoval(value: CaptureRemovalDraft): FieldErrors<CaptureRemovalDraft> | null {
    const fieldErrors: Partial<Record<keyof CaptureRemovalDraft, string>> = {}
    if (!value.rationale.trim()) fieldErrors.rationale = 'Rationale is required.'
    if (removeBlocker && !removeBlocker.supportedChoices.includes(value.choice as RemovalChoice)) {
      fieldErrors.choice = 'Choose one of the server-supported removal options.'
    }
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }

  function submitCreate(value: CaptureDraft) {
    outcome.run(async () => {
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
      if (result.status !== 'succeeded') throw new LifecycleBlockerError(result.blocker.message)
      await params.refresh()
      setCreateOpen(false)
      outcome.show({ kind: 'succeeded' })
    }, 'Capture creation failed.')
  }

  function submitRemove(row: CaptureListPresentation, value: CaptureRemovalDraft) {
    outcome.run(async () => {
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
      params.onRemoved?.(row.captureId)
      try {
        await params.refresh()
        outcome.show({ kind: 'removed', affectedDependentIds: result.affectedDependentIds })
      } catch (error) {
        outcome.show({ kind: 'partial-success', action: 'removed', refreshError: commandFailureMessage(error, 'The current Capture projection could not be refreshed.') })
      }
    }, 'Capture removal failed.')
  }

  function submitRestore(row: CaptureListPresentation, value: CaptureRestoreDraft) {
    outcome.run(async () => {
      const input: RestoreInput = {
        id: row.captureId,
        actor: DESKTOP_USER_ACTOR,
        rationale: value.rationale.trim(),
      }
      const result = await requireClient().captures.restore(input)
      if (result.status === 'blocked') {
        outcome.show({
          kind: 'error',
          blocker: result.blocker,
          message: result.blocker.message,
        })
        return
      }
      setRestoreTarget(null)
      try {
        await params.refresh()
        outcome.show({
          kind: 'restored',
          dependentLinks: result.dependentLinks,
          message: 'Only this Capture was restored. Downstream resources are not restored automatically. It is now available in All and no longer appears in Removed.',
        })
      } catch (error) {
        outcome.show({ kind: 'partial-success', action: 'restored', refreshError: commandFailureMessage(error, 'The current Capture projection could not be refreshed.') })
      }
    }, 'Capture restoration failed.')
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
    openHistory: history.open,
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
          onSubmit={(value) => { if (removeTarget) submitRemove(removeTarget, value) }}
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
          onSubmit={(value) => { if (restoreTarget) submitRestore(restoreTarget, value) }}
          onCancel={() => setRestoreTarget(null)}
          validate={requireRationale}
          pending={pending}
          submitLabel="Restore Capture"
          afterFields={<p className="text-sm text-muted-foreground">This restores only the Capture, not any downstream resources.</p>}
        />
        {history.modal}
        {outcome.toast}
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
