import { useRef, useState, type ReactElement } from 'react'
import type {
  CreateJobInput,
  CorrectJobFactsInput,
  Job,
  JobHistoryResult,
  JobMutationResult,
  PromoteJobToOpportunityInput,
  PromoteJobToOpportunityResult,
  RemoveJobInput,
  RestoreJobInput,
  UpdateJobAvailabilityInput,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'

import { jobFactsTiming } from '../../job/job.timing'
import { DESKTOP_USER_ACTOR, newIdempotencyKey } from '../lifecycle-actor'
import { FormModal, type FieldSpec, type FieldErrors } from '../form-modal'
import type { LifecycleOutcome, LifecycleOutcomeActions } from '../lifecycle-outcome-types'
import { HistoryModal, OutcomeToast } from '../history-modal'
import { outcomeForBlocker } from '../lifecycle-result'
import { loadHistory } from '../load-history'
import type { LifecycleAggregateExtensions } from '../lifecycle-table'
import {
  AVAILABILITY_STATE_CHOICES,
  EMPLOYMENT_TYPE_CHOICES,
  REMOVAL_CHOICE_CHOICES,
  ROLE_KIND_CHOICES,
  SENIORITY_CHOICES,
  TIMING_MODE_CHOICES,
  WORK_MODE_CHOICES,
} from './field-choices'

interface JobCreateDraft {
  companyName: string
  roleTitle: string
  sourceName: string
  roleKind: string
  timingMode: string
  workMode: string
  employmentType: string
  seniority: string
  availabilityState: string
}

interface JobCorrectDraft {
  companyName: string
  roleTitle: string
  sourceName: string
  roleKind: string
  timingMode: string
  workMode: string
  employmentType: string
  seniority: string
  rationale: string
}

interface JobAvailabilityDraft {
  availabilityState: string
}

interface JobRemoveDraft {
  choice: string
  rationale: string
}

interface JobRestoreDraft {
  rationale: string
}

interface JobPromoteDraft {
  fit: string
  rank: string
  cutoff: string
  disposition: string
}

type JobCreateRetry = Pick<CreateJobInput, 'duplicateResolution'>
type JobPromotionRetry = Pick<PromoteJobToOpportunityInput, 'override' | 'duplicateResolution'>

export interface JobController {
  readonly extensions: LifecycleAggregateExtensions<Job>
  readonly modalLayer: ReactElement
  readonly openCreate: () => void
}

export function useJobController(params: {
  client: Pick<ValedictorianWorkspaceClient, 'jobs'> | null
  refresh: () => Promise<void> | void
  refreshDestination: () => Promise<void> | void
  refreshAll: () => Promise<void> | void
}): JobController {
  const { client, refresh, refreshDestination, refreshAll } = params

  const [createOpen, setCreateOpen] = useState(false)
  const [correctTarget, setCorrectTarget] = useState<Job | null>(null)
  const [availabilityTarget, setAvailabilityTarget] = useState<Job | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Job | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<Job | null>(null)
  const [historyTarget, setHistoryTarget] = useState<Job | null>(null)
  const [promoteTarget, setPromoteTarget] = useState<Job | null>(null)
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

  const [createDraft, setCreateDraft] = useState<JobCreateDraft>(emptyCreateDraft())
  const [correctDraft, setCorrectDraft] = useState<JobCorrectDraft>(emptyCorrectDraft())
  const [availabilityDraft, setAvailabilityDraft] = useState<JobAvailabilityDraft>(emptyAvailabilityDraft())
  const [removeDraft, setRemoveDraft] = useState<JobRemoveDraft>(emptyRemoveDraft())
  const [restoreDraft, setRestoreDraft] = useState<JobRestoreDraft>(emptyRestoreDraft())
  const [promoteDraft, setPromoteDraft] = useState<JobPromoteDraft>(emptyPromoteDraft())
  const createDraftRef = useRef(createDraft)
  const promoteDraftRef = useRef(promoteDraft)
  clientRef.current = client
  refreshRef.current = refresh
  refreshDestinationRef.current = refreshDestination
  refreshAllRef.current = refreshAll
  createDraftRef.current = createDraft
  promoteDraftRef.current = promoteDraft

  function requireClient(): Pick<ValedictorianWorkspaceClient, 'jobs'> {
    if (!clientRef.current) throw new Error('Workspace HTTP client is unavailable.')
    return clientRef.current
  }

  function showOutcome(next: LifecycleOutcome, actions: LifecycleOutcomeActions = {}) {
    outcomeActions.current = actions
    setOutcome(next)
  }

  function openCreate() {
    createKey.current = newIdempotencyKey('job-create')
    setCreateDraft(emptyCreateDraft())
    setOutcome(null)
    setCreateOpen(true)
  }
  function openCorrect(row: Job) {
    setCorrectDraft({
      companyName: row.facts.companyName,
      roleTitle: row.facts.roleTitle,
      sourceName: row.facts.sourceName,
      roleKind: row.facts.roleKind,
      timingMode: row.facts.timingMode,
      workMode: row.facts.workMode,
      employmentType: row.facts.employmentType,
      seniority: row.facts.seniority,
      rationale: '',
    })
    setOutcome(null)
    setCorrectTarget(row)
  }
  function openAvailability(row: Job) {
    setAvailabilityDraft({ availabilityState: row.availability.state })
    setOutcome(null)
    setAvailabilityTarget(row)
  }
  function openRemove(row: Job) { setRemoveDraft(emptyRemoveDraft()); setOutcome(null); setRemoveTarget(row) }
  function openRestore(row: Job) { setRestoreDraft(emptyRestoreDraft()); setOutcome(null); setRestoreTarget(row) }
  function openPromote(row: Job) {
    promotionKey.current = newIdempotencyKey('job-promote')
    setPromoteDraft(emptyPromoteDraft())
    setOutcome(null)
    setPromoteTarget(row)
  }
  async function openHistory(row: Job) {
    const request = ++historyRequest.current
    setHistoryOutcome(null)
    setHistoryTarget(row)
    if (!client) { setHistoryOutcome({ kind: 'error', blocker: { code: 'workspace_ownership', message: 'Workspace HTTP client is unavailable.' }, message: 'Workspace HTTP client is unavailable.' }); return }
    setHistoryPending(true)
    try {
      const entries = await loadHistory<JobHistoryResult['items'][number]>((cursor) =>
        client.jobs.history({ id: row.id, limit: 50, ...(cursor ? { cursor } : {}) }))
      if (request !== historyRequest.current) return
      setHistoryOutcome({
        kind: 'history',
        entries: entries.map((entry) => ({
          revision: entry.sequence,
          kind: entry.kind,
          actor: entry.audit.actor,
          timestamp: entry.audit.timestamp,
          summary: `${entry.kind} (#${entry.sequence})`,
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

  function validateJobFacts<T extends JobFactsDraft>(d: T): FieldErrors<T> | null {
    const fieldErrors: Record<string, string> = {}
    if (!d.companyName.trim()) fieldErrors.companyName = 'Company name is required.'
    if (!d.roleTitle.trim()) fieldErrors.roleTitle = 'Role title is required.'
    if (!d.sourceName.trim()) fieldErrors.sourceName = 'Source name is required.'
    if (!d.roleKind) fieldErrors.roleKind = 'Role kind is required.'
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors: fieldErrors as Partial<Record<keyof T & string, string>> } : null
  }

  function validateJobCorrection(d: JobCorrectDraft): FieldErrors<JobCorrectDraft> | null {
    const facts = validateJobFacts(d)
    const rationale = validateRationale(d)
    if (!facts && !rationale) return null
    return { fieldErrors: { ...facts?.fieldErrors, ...rationale?.fieldErrors } }
  }

  function validatePromote(d: JobPromoteDraft): FieldErrors<JobPromoteDraft> | null {
    const fieldErrors: Record<string, string> = {}
    if (!d.fit) fieldErrors.fit = 'Fit is required.'
    if (!d.cutoff) fieldErrors.cutoff = 'Cutoff is required.'
    if (!d.disposition) fieldErrors.disposition = 'Disposition is required.'
    if (d.rank.trim() !== '' && !Number.isFinite(Number(d.rank))) fieldErrors.rank = 'Rank must be a number or blank.'
    return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
  }

  async function submitCreate(d: JobCreateDraft, retry: JobCreateRetry = {}) {
    setPending(true)
    try {
      const input: CreateJobInput = {
        idempotencyKey: createKey.current,
        actor: DESKTOP_USER_ACTOR,
        facts: {
          companyName: d.companyName.trim(),
          roleTitle: d.roleTitle.trim(),
          sourceName: d.sourceName.trim(),
          roleKind: d.roleKind as CreateJobInput['facts']['roleKind'],
          ...jobFactsTiming({
            terms: [],
            timingMode: d.timingMode as CreateJobInput['facts']['timingMode'],
            startDate: null,
            endDate: null,
          }),
          location: null,
          workMode: d.workMode as CreateJobInput['facts']['workMode'],
          employmentType: d.employmentType as CreateJobInput['facts']['employmentType'],
          seniority: d.seniority as CreateJobInput['facts']['seniority'],
          compensation: null,
          postedAt: null,
          destination: null,
        },
        availability: {
          state: d.availabilityState as CreateJobInput['availability']['state'],
          observedAt: new Date().toISOString(),
        },
        evidenceReferences: [],
        externalIdentities: [],
        ...retry,
      }
      const result: JobMutationResult = await requireClient().jobs.create(input)
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
                targetResourceId: choice.targetResourceId as NonNullable<CreateJobInput['duplicateResolution']>['targetResourceId'],
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

  async function submitCorrect(row: Job, d: JobCorrectDraft) {
    setPending(true)
    try {
      const input: CorrectJobFactsInput = {
        jobId: row.id,
        expectedFactsRevision: row.factsRevision,
        actor: DESKTOP_USER_ACTOR,
        rationale: d.rationale.trim(),
        facts: {
          companyName: d.companyName.trim(),
          roleTitle: d.roleTitle.trim(),
          sourceName: d.sourceName.trim(),
          roleKind: d.roleKind as CorrectJobFactsInput['facts']['roleKind'],
          ...jobFactsTiming({
            terms: row.facts.terms,
            timingMode: d.timingMode as CorrectJobFactsInput['facts']['timingMode'],
            startDate: row.facts.startDate,
            endDate: row.facts.endDate,
          }),
          location: row.facts.location,
          workMode: d.workMode as CorrectJobFactsInput['facts']['workMode'],
          employmentType: d.employmentType as CorrectJobFactsInput['facts']['employmentType'],
          seniority: d.seniority as CorrectJobFactsInput['facts']['seniority'],
          compensation: row.facts.compensation,
          postedAt: row.facts.postedAt,
          destination: row.facts.destination,
        },
        evidenceReferences: row.captureEvidenceReferences,
      }
      const result = await requireClient().jobs.correctFacts(input)
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

  async function submitAvailability(row: Job, d: JobAvailabilityDraft) {
    setPending(true)
    try {
      const input: UpdateJobAvailabilityInput = {
        jobId: row.id,
        expectedAvailabilityRevision: row.availabilityRevision,
        actor: DESKTOP_USER_ACTOR,
        availability: {
          state: d.availabilityState as UpdateJobAvailabilityInput['availability']['state'],
          observedAt: new Date().toISOString(),
        },
        evidenceReferences: row.captureEvidenceReferences,
      }
      const result = await requireClient().jobs.updateAvailability(input)
      if (result.status === 'succeeded') {
        await refreshRef.current()
        showOutcome({ kind: 'succeeded' })
        setAvailabilityTarget(null)
      } else {
        showOutcome(outcomeForBlocker(result.blocker))
      }
    } catch (err) {
      showOutcome({ kind: 'error', blocker: { code: 'impossible_state', message: messageOf(err) }, message: messageOf(err) })
    } finally {
      setPending(false)
    }
  }

  async function submitRemove(row: Job, d: JobRemoveDraft) {
    setPending(true)
    try {
      const input: RemoveJobInput = {
        id: row.id,
        choice: d.choice as RemoveJobInput['choice'],
        actor: DESKTOP_USER_ACTOR,
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().jobs.remove(input)
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
            choice: d.choice as RemoveJobInput['choice'],
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

  async function submitRestore(row: Job, d: JobRestoreDraft) {
    setPending(true)
    try {
      const input: RestoreJobInput = {
        id: row.id,
        actor: DESKTOP_USER_ACTOR,
        rationale: d.rationale.trim(),
      }
      const result = await requireClient().jobs.restore(input)
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

  async function submitPromote(row: Job, d: JobPromoteDraft, retry: JobPromotionRetry = {}) {
    setPending(true)
    try {
      const input: PromoteJobToOpportunityInput = {
        idempotencyKey: promotionKey.current,
        actor: DESKTOP_USER_ACTOR,
        jobId: row.id,
        expectedFactsRevision: row.factsRevision,
        evaluation: {
          fit: d.fit as PromoteJobToOpportunityInput['evaluation']['fit'],
          rank: d.rank.trim() === '' ? null : Number(d.rank),
          cutoff: d.cutoff as PromoteJobToOpportunityInput['evaluation']['cutoff'],
          disposition: d.disposition as PromoteJobToOpportunityInput['evaluation']['disposition'],
        },
        ...retry,
      }
      const result: PromoteJobToOpportunityResult = await requireClient().jobs.promoteToOpportunity(input)
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
                targetResourceId: choice.targetResourceId as NonNullable<PromoteJobToOpportunityInput['duplicateResolution']>['targetResourceId'],
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

  const extensions: LifecycleAggregateExtensions<Job> = {
    capabilities: (row) => ({
      add: true,
      edit: !row.removedAt,
      remove: !row.removedAt,
      restore: Boolean(row.removedAt),
      history: true,
      promote: !row.removedAt,
    }),
    formActions: [
      { key: 'add', label: 'Add job', modal: true, onActivate: () => openCreate() },
      { key: 'correct', label: 'Correct facts', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openCorrect(row) },
      { key: 'availability', label: 'Update availability', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openAvailability(row) },
      { key: 'remove', label: 'Remove job', modal: true, destructive: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openRemove(row) },
      { key: 'restore', label: 'Restore job', modal: true, disabled: (row) => !row.removedAt, onActivate: (row) => openRestore(row) },
    ],
    historyAction: { key: 'history', label: 'View history', modal: true, onActivate: (row) => { void openHistory(row) } },
    promotionActions: [
      { key: 'promote-to-opportunity', label: 'Promote to opportunity', modal: true, disabled: (row) => Boolean(row.removedAt), onActivate: (row) => openPromote(row) },
    ],
  }

  const factsFields: ReadonlyArray<FieldSpec<JobCorrectDraft>> = [
    { key: 'companyName', label: 'Company name', inputType: 'text', required: true },
    { key: 'roleTitle', label: 'Role title', inputType: 'text', required: true },
    { key: 'sourceName', label: 'Source name', inputType: 'text', required: true },
    { key: 'roleKind', label: 'Role kind', inputType: 'select', choices: ROLE_KIND_CHOICES, required: true },
    { key: 'timingMode', label: 'Timing mode', inputType: 'select', choices: TIMING_MODE_CHOICES, required: true },
    { key: 'workMode', label: 'Work mode', inputType: 'select', choices: WORK_MODE_CHOICES, required: true },
    { key: 'employmentType', label: 'Employment type', inputType: 'select', choices: EMPLOYMENT_TYPE_CHOICES, required: true },
    { key: 'seniority', label: 'Seniority', inputType: 'select', choices: SENIORITY_CHOICES, required: true },
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const createFields: ReadonlyArray<FieldSpec<JobCreateDraft>> = [
    { key: 'companyName', label: 'Company name', inputType: 'text', required: true },
    { key: 'roleTitle', label: 'Role title', inputType: 'text', required: true },
    { key: 'sourceName', label: 'Source name', inputType: 'text', required: true },
    { key: 'roleKind', label: 'Role kind', inputType: 'select', choices: ROLE_KIND_CHOICES, required: true },
    { key: 'timingMode', label: 'Timing mode', inputType: 'select', choices: TIMING_MODE_CHOICES, required: true },
    { key: 'workMode', label: 'Work mode', inputType: 'select', choices: WORK_MODE_CHOICES, required: true },
    { key: 'employmentType', label: 'Employment type', inputType: 'select', choices: EMPLOYMENT_TYPE_CHOICES, required: true },
    { key: 'seniority', label: 'Seniority', inputType: 'select', choices: SENIORITY_CHOICES, required: true },
    { key: 'availabilityState', label: 'Availability', inputType: 'select', choices: AVAILABILITY_STATE_CHOICES, required: true },
  ]
  const availabilityFields: ReadonlyArray<FieldSpec<JobAvailabilityDraft>> = [
    { key: 'availabilityState', label: 'Availability state', inputType: 'select', choices: AVAILABILITY_STATE_CHOICES, required: true },
  ]
  const removeFields: ReadonlyArray<FieldSpec<JobRemoveDraft>> = [
    { key: 'choice', label: 'Removal choice', inputType: 'select', choices: REMOVAL_CHOICE_CHOICES, required: true },
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const restoreFields: ReadonlyArray<FieldSpec<JobRestoreDraft>> = [
    { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
  ]
  const promoteFields: ReadonlyArray<FieldSpec<JobPromoteDraft>> = [
    { key: 'fit', label: 'Fit', inputType: 'select', choices: FIT_CHOICES_LOCAL, required: true },
    { key: 'rank', label: 'Rank (blank for null)', inputType: 'text' },
    { key: 'cutoff', label: 'Cutoff', inputType: 'select', choices: CUTOFF_CHOICES_LOCAL, required: true },
    { key: 'disposition', label: 'Disposition', inputType: 'select', choices: DISPOSITION_CHOICES_LOCAL, required: true },
  ]

  const modalLayer = (
    <>
      <FormModal
        open={createOpen}
        title="Add job"
        description="Author a new job record."
        fields={createFields}
        value={createDraft}
        onChange={setCreateDraft}
        onSubmit={submitCreate}
        onCancel={() => setCreateOpen(false)}
        validate={validateJobFacts}
        pending={pending}
        submitLabel="Create"
      />
      <FormModal
        open={correctTarget !== null}
        title="Correct job facts"
        description={correctTarget ? `Correcting ${correctTarget.id} at facts revision ${correctTarget.factsRevision}` : ''}
        fields={factsFields}
        value={correctDraft}
        onChange={setCorrectDraft}
        onSubmit={(d) => { if (correctTarget) void submitCorrect(correctTarget, d) }}
        onCancel={() => setCorrectTarget(null)}
        validate={validateJobCorrection}
        pending={pending}
        submitLabel="Correct"
      />
      <FormModal
        open={availabilityTarget !== null}
        title="Update availability"
        description={availabilityTarget ? `Updating ${availabilityTarget.id}` : ''}
        fields={availabilityFields}
        value={availabilityDraft}
        onChange={setAvailabilityDraft}
        onSubmit={(d) => { if (availabilityTarget) void submitAvailability(availabilityTarget, d) }}
        onCancel={() => setAvailabilityTarget(null)}
        pending={pending}
        submitLabel="Update"
      />
      <FormModal
        open={removeTarget !== null}
        title="Remove job"
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
        title="Restore job"
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
        title="Promote job to opportunity"
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

interface JobFactsDraft {
  companyName: string
  roleTitle: string
  sourceName: string
  roleKind: string
}

const FIT_CHOICES_LOCAL = [
  { value: 'fit', label: 'Fit' },
  { value: 'possible', label: 'Possible' },
  { value: 'not_fit', label: 'Not fit' },
  { value: 'unknown', label: 'Unknown' },
]
const CUTOFF_CHOICES_LOCAL = [
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
  { value: 'not_evaluated', label: 'Not evaluated' },
]
const DISPOSITION_CHOICES_LOCAL = [
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'pursue', label: 'Pursue' },
  { value: 'hold', label: 'Hold' },
  { value: 'declined', label: 'Declined' },
  { value: 'archived', label: 'Archived' },
]

function emptyCreateDraft(): JobCreateDraft {
  return { companyName: '', roleTitle: '', sourceName: '', roleKind: 'new_grad', timingMode: 'unknown', workMode: 'unknown', employmentType: 'full_time', seniority: 'entry', availabilityState: 'unknown' }
}
function emptyCorrectDraft(): JobCorrectDraft {
  return { companyName: '', roleTitle: '', sourceName: '', roleKind: 'new_grad', timingMode: 'unknown', workMode: 'unknown', employmentType: 'full_time', seniority: 'entry', rationale: '' }
}
function emptyAvailabilityDraft(): JobAvailabilityDraft {
  return { availabilityState: 'unknown' }
}
function emptyRemoveDraft(): JobRemoveDraft {
  return { choice: 'preserve_historical_lineage', rationale: '' }
}
function emptyRestoreDraft(): JobRestoreDraft {
  return { rationale: '' }
}
function emptyPromoteDraft(): JobPromoteDraft {
  return { fit: 'unknown', rank: '', cutoff: 'not_evaluated', disposition: 'reviewing' }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Operation failed.'
}
