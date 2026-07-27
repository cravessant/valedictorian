// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompanySearchResult, WorkspaceCompaniesClient } from '@sparxie/sdk'

import {
  CompanyAssignmentField,
  type CompanySelection,
} from './CompanyAssignmentField'

afterEach(cleanup)

function makeResult(overrides: Partial<CompanySearchResult> = {}): CompanySearchResult {
  return {
    companyId: '01900000-0000-7000-8000-000000000010',
    revision: 5,
    displayName: 'Acme Robotics',
    websiteUrl: null,
    status: 'active',
    assignedJobCount: 3,
    ...overrides,
  } as CompanySearchResult
}

const alpha = makeResult()
const beta = makeResult({
  companyId: '01900000-0000-7000-8000-000000000011' as CompanySearchResult['companyId'],
  revision: 9,
  displayName: 'Beta Industries',
})

type ClientStubs = {
  readonly search: ReturnType<typeof vi.fn>
  readonly previewMatches: ReturnType<typeof vi.fn>
  readonly create: ReturnType<typeof vi.fn>
  readonly get: ReturnType<typeof vi.fn>
}

function makeClient(overrides: Partial<ClientStubs> = {}) {
  const stubs: ClientStubs = {
    search: overrides.search ?? vi.fn(async () => ({ items: [alpha, beta], truncated: false })),
    previewMatches: overrides.previewMatches ?? vi.fn(async () => ({ items: [], truncated: false })),
    create: overrides.create ?? vi.fn(async () => ({ status: 'created', companyId: beta.companyId })),
    get: overrides.get ?? vi.fn(async () => ({
      lookup: {
        canonical: {
          id: beta.companyId,
          displayName: beta.displayName,
          revision: beta.revision,
        },
      },
    })),
  }
  return { client: stubs as unknown as WorkspaceCompaniesClient, ...stubs }
}

function Harness({
  client,
  onSelect,
}: {
  readonly client: WorkspaceCompaniesClient
  readonly onSelect?: (next: CompanySelection) => void
}) {
  const [selected, setSelected] = useState<CompanySelection | null>(null)
  return (
    <div>
      <label htmlFor="assigned-company">Assigned Company</label>
      <CompanyAssignmentField
        inputId="assigned-company"
        client={client}
        workspaceId="workspace-1"
        selected={selected}
        onSelect={(next) => {
          setSelected(next)
          onSelect?.(next)
        }}
      />
    </div>
  )
}

function combobox() {
  return screen.getByRole('combobox', { name: 'Assigned Company' })
}

async function typeAndSettle(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(combobox(), text)
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
}

describe('CompanyAssignmentField', () => {
  it('keeps the newest results when an earlier search resolves last', async () => {
    const user = userEvent.setup({ delay: null })
    const settle: Array<(page: { items: CompanySearchResult[]; truncated: boolean }) => void> = []
    const search = vi.fn(() => new Promise<{ items: CompanySearchResult[]; truncated: boolean }>(
      (resolve) => { settle.push(resolve) },
    ))
    const { client } = makeClient({ search })
    render(<Harness client={client} />)

    await user.type(combobox(), 'A')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    await user.type(combobox(), 'B')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))

    await act(async () => {
      settle[1]?.({ items: [beta], truncated: false })
      settle[0]?.({ items: [alpha], truncated: false })
    })

    const list = screen.getByRole('listbox', { name: 'Company suggestions' })
    expect(within(list).getByRole('option', { name: /Beta Industries/ })).toBeInTheDocument()
    expect(within(list).queryByRole('option', { name: /Acme Robotics/ })).not.toBeInTheDocument()
  })

  it('selects a suggestion with the keyboard and reports its id and revision', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    const onSelect = vi.fn()
    render(<Harness client={client} onSelect={onSelect} />)

    await typeAndSettle(user, 'A')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(combobox()).toHaveAttribute('aria-activedescendant')
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith({
      companyId: beta.companyId,
      revision: 9,
      displayName: 'Beta Industries',
    })
    expect(combobox()).toHaveValue('Beta Industries')
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')
    expect(combobox()).toHaveFocus()
    expect(screen.getByText('Selected Company: Beta Industries')).toBeInTheDocument()
  })

  it('creates a Company from an unmatched query and assigns only the created record', async () => {
    const user = userEvent.setup()
    const { client, create, get } = makeClient({
      search: vi.fn(async () => ({ items: [], truncated: false })),
      previewMatches: vi.fn(async () => ({
        items: [{
          companyId: alpha.companyId,
          revision: 5,
          displayName: 'Acme Robotics',
          websiteUrl: null,
          score: 0.8,
          reasons: [{ code: 'normalized_name_similarity', label: 'Similar name' }],
        }],
        truncated: false,
      })),
    })
    const onSelect = vi.fn()
    render(<Harness client={client} onSelect={onSelect} />)

    await user.type(combobox(), 'Beta Industries')
    const createAction = await screen.findByRole('button', {
      name: 'Create new Company “Beta Industries”',
    })
    expect(onSelect).not.toHaveBeenCalled()
    await user.click(createAction)

    const dialog = await screen.findByRole('dialog', { name: 'Create Company' })
    expect(within(dialog).getByLabelText('Display name')).toHaveValue('Beta Industries')
    expect(await within(dialog).findByText('Possible existing Companies')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Rationale'), 'New employer.')
    await user.click(within(dialog).getByRole('button', { name: 'Create Company' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      displayName: 'Beta Industries',
      rationale: 'New employer.',
    }))
    await waitFor(() => expect(get).toHaveBeenCalledWith(beta.companyId))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({
      companyId: beta.companyId,
      revision: 9,
      displayName: 'Beta Industries',
    }))
  })
})
