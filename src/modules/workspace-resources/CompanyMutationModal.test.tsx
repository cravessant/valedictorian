import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceCompaniesClient, WorkspaceCompany } from '@sparxie/sdk'
import { CompanyMutationModal } from './CompanyMutationModal'

afterEach(cleanup)

const company = {
  id: '018f0000-0000-7000-8000-000000000001',
  workspaceId: 'workspace-modal',
  displayName: 'Existing Company',
  aliases: [],
  websiteUrl: null,
  notes: null,
  revision: 2,
  status: 'active',
  mergedIntoCompanyId: null,
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
} as unknown as WorkspaceCompany

function clientWith(overrides: Partial<WorkspaceCompaniesClient> = {}) {
  return {
    previewMatches: vi.fn(async () => ({
      items: [{
        companyId: company.id,
        revision: 2,
        displayName: 'Existing Company',
        websiteUrl: null,
        score: 0.9,
        reasons: [{
          code: 'normalized_name_similarity' as const,
          label: 'Company names are similar.',
        }],
      }],
      truncated: false,
    })),
    create: vi.fn(async () => ({
      status: 'created' as const,
      workspaceId: 'workspace-modal',
      companyId: company.id,
      requestCompanyRevision: null,
      idempotencyKey: 'created',
      company,
    })),
    ...overrides,
  } as unknown as WorkspaceCompaniesClient
}

describe('CompanyMutationModal', () => {
  it('opens identity, notes, and alias edits with the selected values', () => {
    const client = clientWith()
    const existing = {
      ...company,
      websiteUrl: 'https://existing.example',
      notes: 'Existing notes',
      aliases: [{ id: 'alias-existing', value: 'Existing alias' }],
    } as WorkspaceCompany
    const props = {
      client,
      workspaceId: 'workspace-modal',
      onChanged: vi.fn(),
      onClose: vi.fn(),
    }
    const { rerender } = render(
      <CompanyMutationModal action={{ kind: 'identity', company: existing }} {...props} />,
    )
    expect(screen.getByLabelText('Display name')).toHaveValue('Existing Company')
    expect(screen.getByLabelText('Website')).toHaveValue('https://existing.example')

    rerender(<CompanyMutationModal action={{ kind: 'notes', company: existing }} {...props} />)
    expect(screen.getByLabelText('Notes')).toHaveValue('Existing notes')

    rerender(<CompanyMutationModal
      action={{ kind: 'alias_update', company: existing, alias: existing.aliases[0]! }}
      {...props}
    />)
    expect(screen.getByLabelText('Alias')).toHaveValue('Existing alias')
  })

  it('creates from a modal and keeps match preview advisory-only', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async () => ({
      status: 'created' as const,
      workspaceId: 'workspace-modal',
      companyId: company.id,
      requestCompanyRevision: null,
      idempotencyKey: 'created',
      company,
    }))
    const client = clientWith({ create })
    const changed = vi.fn()
    const close = vi.fn()
    render(
      <CompanyMutationModal
        action={{ kind: 'create' }}
        client={client}
        workspaceId="workspace-modal"
        onChanged={changed}
        onClose={close}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Create Company' })
    await user.type(within(dialog).getByLabelText('Display name'), 'Existing Labs')
    await user.type(within(dialog).getByLabelText('Website'), 'https://labs.example')
    await user.type(within(dialog).getByLabelText('Notes'), 'Operator notes')
    await user.type(within(dialog).getByLabelText('Rationale'), 'Create a distinct identity.')

    expect(await within(dialog).findByText('Existing Company')).toBeInTheDocument()
    expect(within(dialog).getByText(/Review only/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Existing Company' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Create Company' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-modal',
      displayName: 'Existing Labs',
      websiteUrl: 'https://labs.example',
      notes: 'Operator notes',
      rationale: 'Create a distinct identity.',
    })))
    expect(changed).toHaveBeenCalledWith(company.id)
    expect(close).toHaveBeenCalledOnce()
  })

  it('returns an edited Company form to its immediate Cancel exit after a full revert', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    render(
      <CompanyMutationModal
        action={{ kind: 'identity', company }}
        client={clientWith()}
        workspaceId="workspace-modal"
        onChanged={vi.fn()}
        onClose={close}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit Company identity' })
    const displayName = within(dialog).getByLabelText('Display name')
    await user.clear(displayName)
    await user.type(displayName, company.displayName)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog', { name: /discard/i })).not.toBeInTheDocument()
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps a stale edit modal open with the refresh-and-resubmit message', async () => {
    const user = userEvent.setup()
    const update = vi.fn(async () => ({
      status: 'blocked' as const,
      workspaceId: 'workspace-modal',
      companyId: company.id,
      requestCompanyRevision: 2,
      idempotencyKey: 'blocked',
      failure: {
        kind: 'stale_guard' as const,
        blocker: {
          code: 'impossible_state' as const,
          message: 'The Company changed. Refresh and submit the change again.',
        },
        recovery: {
          action: 'refresh_and_resubmit' as const,
          guards: [{
            kind: 'company_revision' as const,
            companyId: company.id,
            expectedRevision: 2,
            currentRevision: 3,
          }],
        },
      },
    }))
    const client = clientWith({ update } as never)
    const close = vi.fn()
    render(
      <CompanyMutationModal
        action={{ kind: 'identity', company }}
        client={client}
        workspaceId="workspace-modal"
        onChanged={vi.fn()}
        onClose={close}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit Company identity' })
    await user.clear(within(dialog).getByLabelText('Display name'))
    await user.type(within(dialog).getByLabelText('Display name'), 'Changed Company')
    await user.type(within(dialog).getByLabelText('Rationale'), 'Update identity.')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The Company changed. Refresh and submit the change again.',
    )
    expect(close).not.toHaveBeenCalled()
  })
})
