import { useRef, useState, type ReactElement } from 'react'
import type {
  CaptureMutationResult,
  CreateCaptureInput,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'

import { FormModal, type FieldErrors, type FieldSpec } from '../form-modal'
import { OutcomeToast } from '../history-modal'
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

export interface CaptureController {
  readonly modalLayer: ReactElement
  readonly openCreate: () => void
}

export function useCaptureController(params: {
  client: Pick<ValedictorianWorkspaceClient, 'captures'> | null
  refresh: () => Promise<void> | void
}): CaptureController {
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState<CaptureDraft>(emptyDraft())
  const [outcome, setOutcome] = useState<LifecycleOutcome | null>(null)
  const [pending, setPending] = useState(false)
  const clientRef = useRef(params.client)
  const refreshRef = useRef(params.refresh)
  clientRef.current = params.client
  refreshRef.current = params.refresh

  function openCreate() {
    setDraft(emptyDraft())
    setOutcome(null)
    setCreateOpen(true)
  }

  function validate(value: CaptureDraft): FieldErrors<CaptureDraft> | null {
    const fieldErrors: Partial<Record<keyof CaptureDraft, string>> = {}
    if (!value.evidenceMode) fieldErrors.evidenceMode = 'Evidence mode is required.'
    if (!value.adapterId.trim()) fieldErrors.adapterId = 'Source id is required.'
    if (!value.adapterVersion.trim()) fieldErrors.adapterVersion = 'Source version is required.'
    if (!value.observedAt.trim()) fieldErrors.observedAt = 'Observed at is required.'
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }

  async function submit(value: CaptureDraft) {
    setPending(true)
    try {
      if (!clientRef.current) throw new Error('Workspace HTTP client is unavailable.')
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
      const result: CaptureMutationResult = await clientRef.current.captures.create(input)
      if (result.status !== 'succeeded') {
        throw new Error(result.blocker.message)
      }
      await refreshRef.current()
      setCreateOpen(false)
      setOutcome({ kind: 'succeeded' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Capture creation failed.'
      setOutcome({
        kind: 'error',
        blocker: { code: 'impossible_state', message },
        message,
      })
    } finally {
      setPending(false)
    }
  }

  const fields: ReadonlyArray<FieldSpec<CaptureDraft>> = [
    {
      key: 'evidenceMode',
      label: 'Evidence mode',
      inputType: 'select',
      choices: EVIDENCE_MODE_CHOICES,
      required: true,
    },
    {
      key: 'adapterId',
      label: 'Source id',
      inputType: 'text',
      placeholder: 'manual',
      required: true,
    },
    {
      key: 'adapterVersion',
      label: 'Source version',
      inputType: 'text',
      placeholder: '1.0.0',
      required: true,
    },
    {
      key: 'observedAt',
      label: 'Observed at',
      inputType: 'text',
      placeholder: '2026-07-23T12:00:00Z',
      required: true,
    },
    { key: 'providerRecordId', label: 'Source record id', inputType: 'text' },
    { key: 'providerSchema', label: 'Source schema', inputType: 'text' },
  ]

  return {
    openCreate,
    modalLayer: (
      <>
        <FormModal
          open={createOpen}
          title="Add capture"
          description="Add a lead to the Capture inbox."
          fields={fields}
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          onCancel={() => setCreateOpen(false)}
          validate={validate}
          pending={pending}
          submitLabel="Create"
        />
        {outcome ? (
          <OutcomeToast
            outcome={outcome}
            pending={pending}
            onDismiss={() => setOutcome(null)}
          />
        ) : null}
      </>
    ),
  }
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
