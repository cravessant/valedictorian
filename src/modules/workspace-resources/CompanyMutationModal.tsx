import { useEffect, useState } from 'react'
import type {
  CompanyAlias,
  CompanyMatchPreviewPage,
  WorkspaceCompaniesClient,
  WorkspaceCompany,
} from '@sparxie/sdk'
import {
  FormModal,
  type FieldErrors,
  type FieldSpec,
} from '@/modules/lifecycle-table/form-modal'
import {
  DESKTOP_USER_ACTOR,
  newIdempotencyKey,
} from '@/modules/lifecycle-table/lifecycle-actor'

export type CompanyModalAction =
  | { readonly kind: 'create' }
  | { readonly kind: 'identity'; readonly company: WorkspaceCompany }
  | { readonly kind: 'notes'; readonly company: WorkspaceCompany }
  | { readonly kind: 'alias_add'; readonly company: WorkspaceCompany }
  | {
    readonly kind: 'alias_update' | 'alias_remove'
    readonly company: WorkspaceCompany
    readonly alias: CompanyAlias
  }
  | { readonly kind: 'archive' | 'restore'; readonly company: WorkspaceCompany }

interface CompanyMutationModalProps {
  readonly action: CompanyModalAction | null
  readonly client: WorkspaceCompaniesClient
  readonly onChanged: (companyId: string) => void
  readonly onClose: () => void
  readonly workspaceId: string
}

interface CompanyDraft {
  readonly displayName: string
  readonly websiteUrl: string
  readonly notes: string
  readonly aliasValue: string
  readonly rationale: string
}

const emptyDraft: CompanyDraft = {
  displayName: '',
  websiteUrl: '',
  notes: '',
  aliasValue: '',
  rationale: '',
}

export function CompanyMutationModal({
  action,
  client,
  onChanged,
  onClose,
  workspaceId,
}: CompanyMutationModalProps) {
  if (!action) return null
  return (
    <CompanyMutationForm
      key={modalActionKey(action)}
      action={action}
      client={client}
      onChanged={onChanged}
      onClose={onClose}
      workspaceId={workspaceId}
    />
  )
}

function CompanyMutationForm({
  action,
  client,
  onChanged,
  onClose,
  workspaceId,
}: Omit<CompanyMutationModalProps, 'action'> & { readonly action: CompanyModalAction }) {
  const [draft, setDraft] = useState<CompanyDraft>(() => draftFor(action))
  const [idempotencyKey] = useState(() => newIdempotencyKey(`company-${action.kind}`))
  const [pending, setPending] = useState(false)
  const [preview, setPreview] = useState<CompanyMatchPreviewPage | null>(null)

  useEffect(() => {
    if (action?.kind !== 'create' || draft.displayName.trim().length === 0) {
      setPreview(null)
      return
    }
    let current = true
    const timeout = window.setTimeout(() => {
      void client.previewMatches({
        displayName: draft.displayName,
        websiteUrl: draft.websiteUrl.trim() || null,
        limit: 5,
      }).then((result) => {
        if (current) setPreview(result)
      }, () => {
        if (current) setPreview(null)
      })
    }, 200)
    return () => {
      current = false
      window.clearTimeout(timeout)
    }
  }, [action?.kind, client, draft.displayName, draft.websiteUrl])

  const presentation = modalPresentation(action)
  return (
    <FormModal
      open
      title={presentation.title}
      description={presentation.description}
      fields={presentation.fields}
      value={draft}
      onChange={setDraft}
      onCancel={onClose}
      onSubmit={async (value) => {
        setPending(true)
        try {
          const companyId = await submitAction({
            action,
            client,
            draft: value,
            idempotencyKey,
            workspaceId,
          })
          onChanged(companyId)
          onClose()
        } finally {
          setPending(false)
        }
      }}
      validate={(value) => validateDraft(action, value)}
      pending={pending}
      submitLabel={presentation.submitLabel}
      afterFields={action.kind === 'create'
        ? <MatchPreview preview={preview} />
        : undefined}
    />
  )
}

function modalActionKey(action: CompanyModalAction): string {
  if (action.kind === 'create') return action.kind
  const aliasId = 'alias' in action ? action.alias.id : ''
  return `${action.kind}:${action.company.id}:${action.company.revision}:${aliasId}`
}

function modalPresentation(action: CompanyModalAction): {
  title: string
  description: string
  submitLabel: string
  fields: readonly FieldSpec<CompanyDraft>[]
} {
  const rationale: FieldSpec<CompanyDraft> = {
    key: 'rationale',
    label: 'Rationale',
    inputType: 'textarea',
    required: true,
    description: 'Recorded in Company history.',
  }
  if (action.kind === 'create') {
    return {
      title: 'Create Company',
      description: 'Create a workspace identity. Possible matches are advisory only.',
      submitLabel: 'Create Company',
      fields: [
        { key: 'displayName', label: 'Display name', inputType: 'text', required: true },
        { key: 'websiteUrl', label: 'Website', inputType: 'text', placeholder: 'https://example.com' },
        { key: 'notes', label: 'Notes', inputType: 'textarea' },
        rationale,
      ],
    }
  }
  if (action.kind === 'identity') {
    return {
      title: 'Edit Company identity',
      description: 'Update the display name or declared website.',
      submitLabel: 'Save changes',
      fields: [
        { key: 'displayName', label: 'Display name', inputType: 'text', required: true },
        { key: 'websiteUrl', label: 'Website', inputType: 'text', placeholder: 'https://example.com' },
        rationale,
      ],
    }
  }
  if (action.kind === 'notes') {
    return {
      title: 'Edit Company notes',
      description: 'Notes remain editable when a Company has been merged.',
      submitLabel: 'Save notes',
      fields: [{ key: 'notes', label: 'Notes', inputType: 'textarea' }, rationale],
    }
  }
  if (action.kind === 'alias_add' || action.kind === 'alias_update') {
    return {
      title: action.kind === 'alias_add' ? 'Add Company alias' : 'Edit Company alias',
      description: 'Aliases improve workspace search and match preview.',
      submitLabel: action.kind === 'alias_add' ? 'Add alias' : 'Save alias',
      fields: [
        { key: 'aliasValue', label: 'Alias', inputType: 'text', required: true },
        rationale,
      ],
    }
  }
  if (action.kind === 'alias_remove') {
    return {
      title: 'Remove Company alias',
      description: 'The removal is recorded in Company history.',
      submitLabel: 'Remove alias',
      fields: [
        { key: 'aliasValue', label: 'Alias', inputType: 'text', readOnly: true },
        rationale,
      ],
    }
  }
  return {
    title: action.kind === 'archive' ? 'Archive Company' : 'Restore Company',
    description: action.kind === 'archive'
      ? 'Archived Companies leave active search but remain recoverable.'
      : 'Restore this Company to active search and selection.',
    submitLabel: action.kind === 'archive' ? 'Archive Company' : 'Restore Company',
    fields: [rationale],
  }
}

function draftFor(action: CompanyModalAction): CompanyDraft {
  if (action.kind === 'create') return emptyDraft
  return {
    ...emptyDraft,
    displayName: action.company.displayName,
    websiteUrl: action.company.websiteUrl ?? '',
    notes: action.company.notes ?? '',
    aliasValue: 'alias' in action ? action.alias.value : '',
  }
}

function validateDraft(
  action: CompanyModalAction,
  draft: CompanyDraft,
): FieldErrors<CompanyDraft> | null {
  const fieldErrors: Partial<Record<keyof CompanyDraft, string>> = {}
  if (draft.rationale.trim().length === 0) fieldErrors.rationale = 'Rationale is required.'
  if (
    (action.kind === 'create' || action.kind === 'identity')
    && draft.displayName.trim().length === 0
  ) {
    fieldErrors.displayName = 'Display name is required.'
  }
  if (
    (action.kind === 'alias_add' || action.kind === 'alias_update')
    && draft.aliasValue.trim().length === 0
  ) {
    fieldErrors.aliasValue = 'Alias is required.'
  }
  if (draft.websiteUrl.trim()) {
    try {
      const websiteUrl = new URL(draft.websiteUrl)
      if (websiteUrl.protocol !== 'http:' && websiteUrl.protocol !== 'https:') {
        fieldErrors.websiteUrl = 'Enter a complete http or https URL.'
      }
    } catch {
      fieldErrors.websiteUrl = 'Enter a complete http or https URL.'
    }
  }
  return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null
}

async function submitAction(input: {
  readonly action: CompanyModalAction
  readonly client: WorkspaceCompaniesClient
  readonly draft: CompanyDraft
  readonly idempotencyKey: string
  readonly workspaceId: string
}): Promise<string> {
  const { action, client, draft, idempotencyKey, workspaceId } = input
  const context = {
    workspaceId,
    actor: DESKTOP_USER_ACTOR,
    rationale: draft.rationale.trim(),
    idempotencyKey,
  }
  if (action.kind === 'create') {
    const result = await client.create({
      ...context,
      displayName: draft.displayName.trim(),
      websiteUrl: draft.websiteUrl.trim() || null,
      notes: draft.notes,
    })
    if (result.status === 'blocked') throw new Error(result.failure.blocker.message)
    return result.companyId
  }
  const revision = {
    ...context,
    companyId: action.company.id,
    expectedCompanyRevision: action.company.revision,
  }
  const result = action.kind === 'identity'
    ? await client.update({
      ...revision,
      displayName: draft.displayName.trim(),
      websiteUrl: draft.websiteUrl.trim() || null,
    })
    : action.kind === 'notes'
      ? await client.notes.update({ ...revision, notes: draft.notes })
      : action.kind === 'alias_add'
        ? await client.aliases.add({ ...revision, value: draft.aliasValue.trim() })
        : action.kind === 'alias_update'
          ? await client.aliases.update({
            ...revision,
            aliasId: action.alias.id,
            value: draft.aliasValue.trim(),
          })
          : action.kind === 'alias_remove'
            ? await client.aliases.remove({ ...revision, aliasId: action.alias.id })
            : action.kind === 'archive'
              ? await client.archive(revision)
              : await client.restore(revision)
  if (result.status === 'blocked') throw new Error(result.failure.blocker.message)
  return result.companyId
}

function MatchPreview({ preview }: { preview: CompanyMatchPreviewPage | null }) {
  if (!preview || preview.items.length === 0) return null
  return (
    <section className="rounded-md border border-border bg-muted/30 p-3" aria-live="polite">
      <h3 className="text-sm font-semibold">Possible existing Companies</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Review only—this list cannot choose or merge a Company.
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {preview.items.map((match) => (
          <li key={match.companyId}>
            {match.displayName}
            <span className="ml-2 text-xs text-muted-foreground">
              {match.reasons.map((reason) => reason.label).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
