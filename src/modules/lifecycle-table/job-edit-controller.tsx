import { useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  CorrectJobFactsInput,
  Job,
  JobCompanyAssignmentPresentation,
  ReassignJobCompanyInput,
} from '@sparxie/sdk'
import type { LocalWorkspaceClientV2 } from '@/runtime/local-connector-client.contract'

import {
  CompanyAssignmentField,
  type CompanySelection,
} from '@/modules/workspace-resources/CompanyAssignmentField'
import { jobFactsTiming } from '../job/job.timing'
import { WorkspaceClientUnavailableError } from '../../app/app-load-failure'
import { DESKTOP_USER_ACTOR, newIdempotencyKey } from './lifecycle-actor'
import { FormModal, type FieldErrors, type FieldSpec } from './form-modal'
import type { LifecycleRowAction } from './lifecycle-table'
import { LifecycleBlockerError } from './use-lifecycle-command'
import { useLifecycleOutcome } from './use-lifecycle-outcome'
import {
  EMPLOYMENT_TYPE_CHOICES,
  ROLE_KIND_CHOICES,
  SENIORITY_CHOICES,
  TIMING_MODE_CHOICES,
  WORK_MODE_CHOICES,
} from './configs/field-choices'

export interface JobEditDraft {
  readonly assignedCompanyId: string
  readonly roleTitle: string
  readonly sourceName: string
  readonly companyName: string
  readonly roleKind: string
  readonly timingMode: string
  readonly workMode: string
  readonly employmentType: string
  readonly seniority: string
  readonly rationale: string
}

interface JobEditTarget {
  readonly row: Job
  readonly assignment: JobCompanyAssignmentPresentation | null
}

type JobEditClient = Pick<LocalWorkspaceClientV2, 'jobs' | 'companies' | 'companyAssignments'>

/** Coordinates Job facts and Company assignment without merging their guards. */
export function useJobEditController({
  assignments,
  client,
  refresh,
  workspaceId,
}: {
  readonly assignments: ReadonlyMap<string, JobCompanyAssignmentPresentation>
  readonly client: JobEditClient | null
  readonly refresh: () => Promise<void> | void
  readonly workspaceId: string | null
}): {
  readonly action: LifecycleRowAction<Job>
  readonly modalLayer: ReactElement
} {
  const [target, setTarget] = useState<JobEditTarget | null>(null)
  const [draft, setDraft] = useState<JobEditDraft>(() => emptyDraft())
  const [selected, setSelected] = useState<CompanySelection | null>(null)
  const reassignKey = useRef('')
  const outcome = useLifecycleOutcome()

  function requireClient(): JobEditClient {
    if (!client) throw new WorkspaceClientUnavailableError()
    return client
  }

  function open(row: Job) {
    const assignment = assignments.get(row.id) ?? null
    reassignKey.current = newIdempotencyKey('job-company-reassign')
    setDraft(draftFromJob(row, assignment))
    setSelected(assignment ? selectionFrom(assignment) : null)
    outcome.clear()
    setTarget({ row, assignment })
  }

  const companyEditable = Boolean(
    target?.assignment && workspaceId && client?.companies,
  )

  function validate(value: JobEditDraft): FieldErrors<JobEditDraft> | null {
    const fieldErrors: Partial<Record<keyof JobEditDraft, string>> = {}
    if (!value.companyName.trim()) fieldErrors.companyName = 'Posting company text is required.'
    if (!value.roleTitle.trim()) fieldErrors.roleTitle = 'Role title is required.'
    if (!value.sourceName.trim()) fieldErrors.sourceName = 'Source name is required.'
    if (!value.roleKind) fieldErrors.roleKind = 'Role kind is required.'
    if (!value.rationale.trim()) fieldErrors.rationale = 'Rationale is required.'
    if (companyEditable && selected?.companyId !== value.assignedCompanyId) {
      fieldErrors.assignedCompanyId = 'Choose a Company from the suggestions.'
    }
    const unchanged = target !== null
      && !factsChanged(target.row, value)
      && !companyChanged(target.assignment, selected)
    return Object.keys(fieldErrors).length > 0 || unchanged
      ? {
          fieldErrors,
          formError: unchanged
            ? 'Change a Job fact or the assigned Company before saving.'
            : undefined,
        }
      : null
  }

  /** Rebase guards and require a fresh destination after a stale reassignment. */
  async function rebaseAfterStaleAssignment(
    row: Job,
    jobId: JobCompanyAssignmentPresentation['jobId'],
    value: JobEditDraft,
  ): Promise<void> {
    let refreshed: JobCompanyAssignmentPresentation
    try {
      refreshed = await requireClient().companyAssignments.get(jobId)
    } catch {
      setTarget({ row, assignment: null })
      setSelected(null)
      setDraft({ ...value, assignedCompanyId: '' })
      throw new LifecycleBlockerError(
        'The Company assignment changed and the current assignment could not be reloaded. Reopen the Job to reassign its Company.',
      )
    }
    // The rebased retry is a new command and needs a new receipt.
    reassignKey.current = newIdempotencyKey('job-company-reassign')
    setTarget({ row, assignment: refreshed })
    setSelected(selectionFrom(refreshed))
    setDraft({ ...value, assignedCompanyId: refreshed.workspaceCompany.companyId })
  }

  function submit(edited: JobEditTarget, value: JobEditDraft) {
    const destination = selected
    outcome.run(async () => {
      let row = edited.row
      if (factsChanged(row, value)) {
        const result = await requireClient().jobs.correctFacts(correctionInput(row, value))
        if (result.status !== 'succeeded') {
          outcome.showBlocker(result.blocker)
          return
        }
        row = result.resource
        setTarget({ row, assignment: edited.assignment })
      }
      if (edited.assignment && workspaceId && companyChanged(edited.assignment, destination)) {
        const result = await requireClient().companyAssignments.reassign({
          workspaceId,
          actor: DESKTOP_USER_ACTOR,
          rationale: value.rationale.trim(),
          idempotencyKey: reassignKey.current,
          jobId: edited.assignment.jobId,
          expectedAssignmentRevision: edited.assignment.assignmentRevision,
          destinationCompanyId: destination.companyId as ReassignJobCompanyInput['destinationCompanyId'],
          expectedDestinationCompanyRevision: destination.revision,
        })
        if (result.status === 'blocked') {
          await refresh()
          await rebaseAfterStaleAssignment(row, edited.assignment.jobId, value)
          outcome.showBlocker(result.failure.blocker)
          return
        }
      }
      await refresh()
      outcome.show({ kind: 'succeeded' })
      setTarget(null)
    }, 'Job edit failed.')
  }

  const fields = useMemo<ReadonlyArray<FieldSpec<JobEditDraft>>>(() => {
    const companyField: ReadonlyArray<FieldSpec<JobEditDraft>> = companyEditable && client && workspaceId
      ? [{
          key: 'assignedCompanyId',
          label: 'Assigned Company',
          inputType: 'custom',
          required: true,
          description: 'The canonical Workspace Company this Job is assigned to.',
          render: ({ id, onChange, disabled, invalid }) => (
            <CompanyAssignmentField
              inputId={id}
              client={client.companies}
              workspaceId={workspaceId}
              selected={selected}
              disabled={disabled}
              invalid={invalid}
              onSelect={(next) => {
                setSelected(next)
                onChange(next.companyId)
              }}
            />
          ),
        }]
      : []
    return [
      ...companyField,
      { key: 'roleTitle', label: 'Role title', inputType: 'text', required: true },
      { key: 'sourceName', label: 'Source name', inputType: 'text', required: true },
      {
        key: 'companyName',
        label: 'Posting company text',
        inputType: 'text',
        required: true,
        description: 'Source text the posting asserted. Correcting it never changes the assigned Company.',
      },
      { key: 'roleKind', label: 'Role kind', inputType: 'select', choices: ROLE_KIND_CHOICES, required: true },
      { key: 'timingMode', label: 'Timing mode', inputType: 'select', choices: TIMING_MODE_CHOICES, required: true },
      { key: 'workMode', label: 'Work mode', inputType: 'select', choices: WORK_MODE_CHOICES, required: true },
      { key: 'employmentType', label: 'Employment type', inputType: 'select', choices: EMPLOYMENT_TYPE_CHOICES, required: true },
      { key: 'seniority', label: 'Seniority', inputType: 'select', choices: SENIORITY_CHOICES, required: true },
      { key: 'rationale', label: 'Rationale', inputType: 'textarea', required: true },
    ]
  }, [client, companyEditable, selected, workspaceId])

  return {
    action: {
      key: 'edit',
      label: 'Edit job',
      modal: true,
      disabled: (row) => Boolean(row.removedAt),
      onActivate: open,
    },
    modalLayer: (
      <>
        {/* Remount after a stale rebase so FormModal adopts the new guards. */}
        <FormModal
          key={target ? reassignKey.current : 'closed'}
          open={target !== null}
          title="Edit job"
          description={target ? editDescription(target) : ''}
          fields={fields}
          value={draft}
          onChange={setDraft}
          onSubmit={(value) => { if (target) submit(target, value) }}
          onCancel={() => setTarget(null)}
          validate={validate}
          pending={outcome.pending}
          submitLabel="Save job"
        />
        {outcome.toast}
      </>
    ),
  }
}

function editDescription(target: JobEditTarget): string {
  const facts = `Editing ${target.row.id} at facts revision ${target.row.factsRevision}`
  return target.assignment
    ? `${facts}. Assigned to ${target.assignment.workspaceCompany.displayName} at assignment revision ${target.assignment.assignmentRevision}.`
    : `${facts}.`
}

function selectionFrom(assignment: JobCompanyAssignmentPresentation): CompanySelection {
  return {
    companyId: assignment.workspaceCompany.companyId,
    revision: assignment.workspaceCompany.revision,
    displayName: assignment.workspaceCompany.displayName,
  }
}

function companyChanged(
  assignment: JobCompanyAssignmentPresentation | null,
  selected: CompanySelection | null,
): selected is CompanySelection {
  return Boolean(assignment && selected && selected.companyId !== assignment.workspaceCompany.companyId)
}

function factsChanged(row: Job, draft: JobEditDraft): boolean {
  return draft.companyName.trim() !== row.facts.companyName
    || draft.roleTitle.trim() !== row.facts.roleTitle
    || draft.sourceName.trim() !== row.facts.sourceName
    || draft.roleKind !== row.facts.roleKind
    || draft.timingMode !== row.facts.timingMode
    || draft.workMode !== row.facts.workMode
    || draft.employmentType !== row.facts.employmentType
    || draft.seniority !== row.facts.seniority
}

function correctionInput(row: Job, draft: JobEditDraft): CorrectJobFactsInput {
  return {
    jobId: row.id,
    expectedFactsRevision: row.factsRevision,
    actor: DESKTOP_USER_ACTOR,
    rationale: draft.rationale.trim(),
    facts: {
      companyName: draft.companyName.trim(),
      roleTitle: draft.roleTitle.trim(),
      sourceName: draft.sourceName.trim(),
      roleKind: draft.roleKind as CorrectJobFactsInput['facts']['roleKind'],
      ...jobFactsTiming({
        terms: row.facts.terms,
        timingMode: draft.timingMode as CorrectJobFactsInput['facts']['timingMode'],
        startDate: row.facts.startDate,
        endDate: row.facts.endDate,
      }),
      location: row.facts.location,
      workMode: draft.workMode as CorrectJobFactsInput['facts']['workMode'],
      employmentType: draft.employmentType as CorrectJobFactsInput['facts']['employmentType'],
      seniority: draft.seniority as CorrectJobFactsInput['facts']['seniority'],
      compensation: row.facts.compensation,
      postedAt: row.facts.postedAt,
      destination: row.facts.destination,
    },
    evidenceReferences: row.captureEvidenceReferences,
  }
}

function draftFromJob(
  row: Job,
  assignment: JobCompanyAssignmentPresentation | null,
): JobEditDraft {
  return {
    assignedCompanyId: assignment?.workspaceCompany.companyId ?? '',
    roleTitle: row.facts.roleTitle,
    sourceName: row.facts.sourceName,
    companyName: row.facts.companyName,
    roleKind: row.facts.roleKind,
    timingMode: row.facts.timingMode,
    workMode: row.facts.workMode,
    employmentType: row.facts.employmentType,
    seniority: row.facts.seniority,
    rationale: '',
  }
}

function emptyDraft(): JobEditDraft {
  return {
    assignedCompanyId: '',
    roleTitle: '',
    sourceName: '',
    companyName: '',
    roleKind: 'new_grad',
    timingMode: 'unknown',
    workMode: 'unknown',
    employmentType: 'full_time',
    seniority: 'entry',
    rationale: '',
  }
}
