import { useRef, useState } from 'react'
import type { WorkspaceCompaniesClient } from '@sparxie/sdk'

import { Button } from '@/components/ui/button'
import {
  InlineAutocomplete,
  type InlineAutocompleteOption,
} from '@/components/ui/inline-autocomplete'
import { CompanyMutationModal } from './CompanyMutationModal'
import {
  COMPANY_SEARCH_LIMIT,
  hasExactCompanyNameMatch,
  useCompanySearch,
  type CompanySearchState,
} from './use-company-search'

/** The identity and guard revision a reassignment is allowed to submit. */
export interface CompanySelection {
  readonly companyId: string
  readonly revision: number
  readonly displayName: string
}

export interface CompanyAssignmentFieldProps {
  readonly inputId: string
  readonly client: WorkspaceCompaniesClient
  readonly workspaceId: string
  readonly selected: CompanySelection | null
  readonly onSelect: (selection: CompanySelection) => void
  readonly disabled?: boolean
  readonly invalid?: boolean
}

/** Keeps search text separate from a server-backed Company selection. */
export function CompanyAssignmentField({
  inputId,
  client,
  workspaceId,
  selected,
  onSelect,
  disabled = false,
  invalid = false,
}: CompanyAssignmentFieldProps) {
  const [query, setQuery] = useState(selected?.displayName ?? '')
  const [creating, setCreating] = useState(false)
  const [creationFailure, setCreationFailure] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const search = useCompanySearch(client, query)

  const items = search.kind === 'ready' ? search.items : []
  const options: InlineAutocompleteOption[] = items.map((item) => ({
    value: item.companyId,
    label: item.displayName,
    detail: item.websiteUrl ?? undefined,
  }))
  const trimmedQuery = query.trim()
  const offerCreate = search.kind === 'ready'
    && trimmedQuery.length > 0
    && !hasExactCompanyNameMatch(items, trimmedQuery)

  function select(next: CompanySelection) {
    setQuery(next.displayName)
    setCreationFailure(null)
    onSelect(next)
  }

  async function adoptCreatedCompany(companyId: string) {
    try {
      const detail = await client.get(companyId)
      const created = detail.lookup.canonical
      select({
        companyId: created.id,
        revision: created.revision,
        displayName: created.displayName,
      })
    } catch {
      setCreationFailure('The Company was created but could not be selected. Search for it and choose it.')
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <InlineAutocomplete
        id={inputId}
        inputRef={inputRef}
        query={query}
        onQueryChange={setQuery}
        options={options}
        onSelect={(option) => {
          const match = items.find((item) => item.companyId === option.value)
          if (match) {
            select({
              companyId: match.companyId,
              revision: match.revision,
              displayName: match.displayName,
            })
          }
        }}
        listLabel="Company suggestions"
        selectedValue={selected?.companyId ?? null}
        placeholder="Search active Companies"
        disabled={disabled}
        invalid={invalid}
        status={<CompanySearchStatus state={search} />}
        footer={offerCreate ? (
          <div className="border-t border-border p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setCreating(true)}
            >
              {`Create new Company “${trimmedQuery}”`}
            </Button>
          </div>
        ) : null}
      />
      <p className="text-sm text-muted-foreground" data-slot="company-assignment-selection">
        {selected
          ? `Selected Company: ${selected.displayName}`
          : 'No Company selected. Choose one from the suggestions.'}
      </p>
      {creationFailure ? <p className="text-sm text-destructive">{creationFailure}</p> : null}
      <CompanyMutationModal
        action={creating ? { kind: 'create', displayName: trimmedQuery } : null}
        client={client}
        workspaceId={workspaceId}
        onChanged={adoptCreatedCompany}
        onClose={() => {
          setCreating(false)
          inputRef.current?.focus()
        }}
      />
    </div>
  )
}

function CompanySearchStatus({ state }: { readonly state: CompanySearchState }) {
  const message = statusMessage(state)
  if (!message) return null
  return (
    <p role="status" className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
      {message}
    </p>
  )
}

function statusMessage(state: CompanySearchState): string | null {
  if (state.kind === 'searching') return 'Searching Companies…'
  if (state.kind === 'failed') return 'Company search could not be loaded.'
  if (state.kind !== 'ready') return null
  if (state.items.length === 0) return 'No matching active Companies.'
  return state.truncated
    ? `Showing the first ${COMPANY_SEARCH_LIMIT} matches. Refine the search to narrow them.`
    : null
}
