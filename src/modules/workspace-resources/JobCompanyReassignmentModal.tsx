import { useMemo, useState } from 'react'
import type {
  JobCompanyAssignmentPresentation,
  ReassignJobCompanyInput,
} from '@sparxie/sdk'
import type { LocalWorkspaceClientV2 } from '@/runtime/local-connector-client.contract'
import {
  FormModal,
  type FieldErrors,
  type FieldSpec,
} from '@/modules/lifecycle-table/form-modal'
import {
  DESKTOP_USER_ACTOR,
  newIdempotencyKey,
} from '@/modules/lifecycle-table/lifecycle-actor'
import {
  CompanyAssignmentField,
  type CompanySelection,
} from './CompanyAssignmentField'

interface ReassignmentDraft {
  readonly destinationCompanyId: string
  readonly rationale: string
}

/** Standalone reassignment recovery that leaves Job facts untouched. */
export function JobCompanyReassignmentModal({
  assignment,
  client,
  onChanged,
  onClose,
  workspaceId,
}: {
  readonly assignment: JobCompanyAssignmentPresentation
  readonly client: Pick<LocalWorkspaceClientV2, 'companies' | 'companyAssignments'>
  readonly onChanged: () => Promise<void> | void
  readonly onClose: () => void
  readonly workspaceId: string
}) {
  const [draft, setDraft] = useState<ReassignmentDraft>({
    destinationCompanyId: '',
    rationale: '',
  })
  const [selected, setSelected] = useState<CompanySelection | null>(null)
  const [pending, setPending] = useState(false)
  const [idempotencyKey] = useState(() => newIdempotencyKey('job-company-reassign'))

  const fields = useMemo<readonly FieldSpec<ReassignmentDraft>[]>(() => [
    {
      key: 'destinationCompanyId',
      label: 'Destination Company',
      inputType: 'custom',
      required: true,
      description: 'Searches active workspace Companies.',
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
    },
    {
      key: 'rationale',
      label: 'Rationale',
      inputType: 'textarea',
      required: true,
      description: 'Recorded in assignment history.',
    },
  ], [client, selected, workspaceId])

  return (
    <FormModal
      open
      title="Reassign Job Company"
      description={`Currently assigned to ${assignment.workspaceCompany.displayName}. Job facts will not change.`}
      fields={fields}
      value={draft}
      onChange={setDraft}
      onCancel={onClose}
      validate={(value) => validate(value, assignment, selected)}
      pending={pending}
      submitLabel="Reassign Company"
      onSubmit={async (value) => {
        if (!selected || selected.companyId !== value.destinationCompanyId) {
          throw new Error('Choose a Company from the suggestions.')
        }
        setPending(true)
        try {
          const result = await client.companyAssignments.reassign({
            workspaceId,
            actor: DESKTOP_USER_ACTOR,
            rationale: value.rationale.trim(),
            idempotencyKey,
            jobId: assignment.jobId,
            expectedAssignmentRevision: assignment.assignmentRevision,
            destinationCompanyId: selected.companyId as ReassignJobCompanyInput['destinationCompanyId'],
            expectedDestinationCompanyRevision: selected.revision,
          })
          if (result.status === 'blocked') {
            throw new Error(result.failure.blocker.message)
          }
          await onChanged()
          onClose()
        } finally {
          setPending(false)
        }
      }}
    />
  )
}

function validate(
  draft: ReassignmentDraft,
  assignment: JobCompanyAssignmentPresentation,
  selected: CompanySelection | null,
): FieldErrors<ReassignmentDraft> | null {
  const fieldErrors: Partial<Record<keyof ReassignmentDraft, string>> = {}
  if (!selected || selected.companyId !== draft.destinationCompanyId) {
    fieldErrors.destinationCompanyId = 'Choose a Company from the suggestions.'
  } else if (selected.companyId === assignment.workspaceCompany.companyId) {
    fieldErrors.destinationCompanyId = 'Choose a Company other than the current assignment.'
  }
  if (!draft.rationale.trim()) fieldErrors.rationale = 'Rationale is required.'
  return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
}
