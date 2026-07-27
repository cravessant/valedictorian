import { useEffect, useMemo, useState } from 'react'
import type {
  CompanySearchResult,
  JobCompanyAssignmentPresentation,
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

interface ReassignmentDraft {
  readonly query: string
  readonly destinationCompanyId: string
  readonly rationale: string
}

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
    query: '',
    destinationCompanyId: '',
    rationale: '',
  })
  const [matches, setMatches] = useState<readonly CompanySearchResult[]>([])
  const [searchFailure, setSearchFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [idempotencyKey] = useState(() => newIdempotencyKey('job-company-reassign'))

  useEffect(() => {
    const query = draft.query.trim()
    if (!query) {
      setMatches([])
      setSearchFailure(null)
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      void client.companies.search({
        query,
        scope: 'active',
        limit: 20,
      }).then((page) => {
        if (!current) return
        setMatches(page.items.filter((item) =>
          item.companyId !== assignment.workspaceCompany.companyId))
        setSearchFailure(null)
      }, () => {
        if (!current) return
        setMatches([])
        setSearchFailure('Company search could not be loaded.')
      })
    }, 200)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [assignment.workspaceCompany.companyId, client, draft.query])

  const fields = useMemo<readonly FieldSpec<ReassignmentDraft>[]>(() => [
    {
      key: 'query',
      label: 'Find Company',
      inputType: 'text',
      required: true,
      description: 'Searches active workspace Companies.',
    },
    {
      key: 'destinationCompanyId',
      label: 'Destination Company',
      inputType: 'select',
      required: true,
      choices: [
        { value: '', label: matches.length === 0 ? 'No matches' : 'Choose a Company' },
        ...matches.map((match) => ({
          value: match.companyId,
          label: match.displayName,
        })),
      ],
    },
    {
      key: 'rationale',
      label: 'Rationale',
      inputType: 'textarea',
      required: true,
      description: 'Recorded in assignment history.',
    },
  ], [matches])

  return (
    <FormModal
      open
      title="Reassign Job Company"
      description={`Currently assigned to ${assignment.workspaceCompany.displayName}. Job facts will not change.`}
      fields={fields}
      value={draft}
      onChange={setDraft}
      onCancel={onClose}
      validate={(value) => validate(value, matches)}
      error={searchFailure}
      pending={pending}
      submitLabel="Reassign Company"
      onSubmit={async (value) => {
        const destination = matches.find((match) =>
          match.companyId === value.destinationCompanyId)
        if (!destination) throw new Error('Choose a current Company search result.')
        setPending(true)
        try {
          const result = await client.companyAssignments.reassign({
            workspaceId,
            actor: DESKTOP_USER_ACTOR,
            rationale: value.rationale.trim(),
            idempotencyKey,
            jobId: assignment.jobId,
            expectedAssignmentRevision: assignment.assignmentRevision,
            destinationCompanyId: destination.companyId,
            expectedDestinationCompanyRevision: destination.revision,
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
  matches: readonly CompanySearchResult[],
): FieldErrors<ReassignmentDraft> | null {
  const fieldErrors: Partial<Record<keyof ReassignmentDraft, string>> = {}
  if (!draft.query.trim()) fieldErrors.query = 'Enter a Company search.'
  if (!matches.some((match) => match.companyId === draft.destinationCompanyId)) {
    fieldErrors.destinationCompanyId = 'Choose a Company from the current results.'
  }
  if (!draft.rationale.trim()) fieldErrors.rationale = 'Rationale is required.'
  return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
}
