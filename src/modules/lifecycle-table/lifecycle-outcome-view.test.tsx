// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LifecycleOutcomeView } from './lifecycle-outcome-view'
import type { LifecycleOutcome } from './lifecycle-outcome-types'

afterEach(cleanup)

describe('LifecycleOutcomeView', () => {
  it('renders an error outcome in an alert with the blocker message and code, visually distinct from warnings', () => {
    const outcome: LifecycleOutcome = {
      kind: 'error',
      blocker: {
        code: 'invalid_input',
        message: 'Company name is required.',
        field: 'companyName',
      },
      message: 'Company name is required.',
    }
    render(<LifecycleOutcomeView outcome={outcome} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('invalid_input')
    expect(alert).toHaveTextContent('Company name is required.')
    expect(alert).toHaveTextContent(/Error/i)
  })

  it('renders a warnings outcome in a non-alert region with warning codes and an override form that captures rationale and codes', async () => {
    const user = userEvent.setup()
    const onOverride = vi.fn()
    const outcome: LifecycleOutcome = {
      kind: 'warnings',
      warnings: [
        { code: 'fit', message: 'Fit not evaluated.' },
        { code: 'rank', message: 'Rank missing.' },
      ],
      override: null,
    }
    render(<LifecycleOutcomeView outcome={outcome} onOverrideWarnings={onOverride} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('lifecycle-outcome-warnings')).toBeInTheDocument()
    expect(screen.getByText('fit')).toBeInTheDocument()
    expect(screen.getByText('rank')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /fit/i }))
    await user.type(screen.getByRole('textbox', { name: /rationale/i }), 'Reviewed manually.')
    await user.click(screen.getByRole('button', { name: /override warnings/i }))
    expect(onOverride).toHaveBeenCalledWith(['fit'], 'Reviewed manually.')
  })

  it('does not allow override submission until at least one warning code and rationale are provided', async () => {
    const user = userEvent.setup()
    const onOverride = vi.fn()
    const outcome: LifecycleOutcome = {
      kind: 'warnings',
      warnings: [{ code: 'fit', message: 'm' }],
      override: null,
    }
    render(<LifecycleOutcomeView outcome={outcome} onOverrideWarnings={onOverride} />)
    await user.click(screen.getByRole('button', { name: /override warnings/i }))
    expect(onOverride).not.toHaveBeenCalled()
  })

  it('renders a duplicate blocker with attach/merge choices and the target id, firing onResolveDuplicate', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const outcome: LifecycleOutcome = {
      kind: 'duplicate',
      blocker: {
        code: 'deterministic_duplicate',
        message: 'Duplicate of job-123.',
        conflictingResourceId: 'job-123',
        allowedDuplicateResolutions: ['attach', 'merge'],
      },
      choices: [
        { action: 'attach', targetResourceId: 'job-123' },
        { action: 'merge', targetResourceId: 'job-123' },
      ],
      message: 'Duplicate of job-123.',
    }
    render(<LifecycleOutcomeView outcome={outcome} onResolveDuplicate={onResolve} />)
    expect(screen.getByRole('alert')).toHaveTextContent('deterministic_duplicate')
    expect(screen.getByText('job-123')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^attach/i }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'attach', targetResourceId: 'job-123' })
    await user.click(screen.getByRole('button', { name: /^merge/i }))
    expect(onResolve).toHaveBeenCalledWith({ action: 'merge', targetResourceId: 'job-123' })
  })

  it('renders a blocked removal with dependent ids and supported choices, requiring rationale to resolve', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const outcome: LifecycleOutcome = {
      kind: 'removal-blocked',
      blocker: {
        code: 'bounded_data_violation',
        message: 'Dependents exist.',
      },
      choice: {
        choice: 'preserve_historical_lineage',
        dependentIds: ['job-1', 'job-2'],
        supportedChoices: ['preserve_historical_lineage', 'unlink_dependents'],
      },
      message: 'Dependents exist.',
    }
    render(<LifecycleOutcomeView outcome={outcome} onResolveRemoval={onResolve} />)
    expect(screen.getByRole('alert')).toHaveTextContent('bounded_data_violation')
    expect(screen.getByText('job-1')).toBeInTheDocument()
    expect(screen.getByText('job-2')).toBeInTheDocument()
    const select = screen.getByRole('combobox', { name: /removal choice/i })
    await user.selectOptions(select, 'unlink_dependents')
    await user.type(screen.getByRole('textbox', { name: /rationale/i }), 'Stale dependents.')
    await user.click(screen.getByRole('button', { name: /confirm removal/i }))
    expect(onResolve).toHaveBeenCalledWith('unlink_dependents', 'Stale dependents.')
  })

  it('renders a successful removal summary with affected dependent ids', () => {
    const outcome: LifecycleOutcome = {
      kind: 'removed',
      affectedDependentIds: ['dep-1', 'dep-2'],
    }
    render(<LifecycleOutcomeView outcome={outcome} />)
    expect(screen.getByRole('status')).toHaveTextContent(/removed/i)
    expect(screen.getByText('dep-1')).toBeInTheDocument()
    expect(screen.getByText('dep-2')).toBeInTheDocument()
  })

  it('renders a restore summary with dependent link states', () => {
    const outcome: LifecycleOutcome = {
      kind: 'restored',
      dependentLinks: [
        { dependentId: 'dep-1', state: 'restored' },
        { dependentId: 'dep-2', state: 'remained_tombstoned' },
      ],
    }
    render(<LifecycleOutcomeView outcome={outcome} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/restored/i)
    expect(status).toHaveTextContent('dep-1')
    expect(status).toHaveTextContent('remained_tombstoned')
  })

  it('renders a history list read-only without mutation controls', () => {
    const outcome: LifecycleOutcome = {
      kind: 'history',
      entries: [
        { revision: 1, kind: 'created', actor: { id: 'u', type: 'user', displayName: 'U' }, timestamp: '2025-01-01T00:00:00Z', summary: 'Created.' },
      ],
    }
    render(<LifecycleOutcomeView outcome={outcome} />)
    const container = screen.getByTestId('lifecycle-outcome-history')
    expect(container).toHaveTextContent('r1')
    expect(container).toHaveTextContent('created')
    expect(screen.queryByRole('button', { name: /override|confirm|attach|merge/i })).not.toBeInTheDocument()
  })
})