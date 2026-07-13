import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createListResult,
  createPolicyApi,
  createSettingsApi,
  openSettingsPage
} from './App.test-helpers'
import { defaultPolicyConfig } from 'sparxie'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { profile?: unknown }).profile
  delete (window as Window & { workspace?: unknown }).workspace
  delete (window as Window & { valedictorianWindowChrome?: unknown }).valedictorianWindowChrome
})

describe('policy settings', () => {
  it('renders complete policy controls and saves section drafts with toast feedback', async () => {
    const policyApi = createPolicyApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        policyApi={policyApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Policy' }))
    expect(await screen.findByRole('heading', { name: 'Policy' })).toBeInTheDocument()

    const settingsSidebar = screen.getByRole('complementary', { name: 'Settings navigation' })
    const settingsShell = settingsSidebar.parentElement
    expect(settingsShell).toHaveClass(
      'grid-cols-1',
      'grid-rows-1',
      'md:grid-cols-[280px_1fr]',
    )
    expect(settingsShell).not.toHaveClass('grid-rows-[auto_1fr]')
    expect(settingsSidebar).toHaveClass(
      'absolute',
      'left-0',
      'top-0',
      'z-40',
      'h-full',
      'w-[280px]',
      'max-w-[85vw]',
      'border-r',
      'md:static',
      'md:h-[calc(100vh-3rem)]',
      'md:max-w-none',
    )
    expect(settingsSidebar).not.toHaveClass('h-auto', 'max-h-72', 'w-full', 'border-b')

    for (const sectionName of [
      'Action Queue decisions',
      'Manual review',
      'Evidence requirements',
      'Application gates',
      'Retry recovery',
      'Sourcing windows',
    ]) {
      expect(screen.getByRole('heading', { name: sectionName })).toBeInTheDocument()
    }

    for (const fieldName of [
      'Apply cutoff',
      'Stale lock hours',
      'Manual pickup delay',
      'Pickup window start',
      'Pickup window end',
      'Pickup window timezone',
      'Non-overridable evidence tags',
      'Manual review companies',
      'Explicit approval companies',
      'Allowed native platforms',
      'High-risk form builders',
      'Require employer-domain verification',
      'Require final review receipt',
      'Require second pass verification',
      'Captcha/security retries',
      'Platform error retries',
      'Login recovery required',
      'Sourcing timezone',
      'Overlap minutes',
      'Weekday cadence',
      'Overnight cadence',
      'Weekend cadence',
      'Minimum lookback',
      'Overnight start hour',
      'Overnight end hour',
    ]) {
      expect(screen.getByLabelText(fieldName)).toBeInTheDocument()
    }

    expect(screen.queryByRole('button', { name: 'Save policy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument()

    const queueDecisions = screen.getByRole('region', { name: 'Action Queue decisions' })
    const manualReview = screen.getByRole('region', { name: 'Manual review' })
    const queueSaveButton = within(queueDecisions).getByRole('button', {
      name: 'Save Action Queue decisions',
    })
    const manualReviewSaveButton = within(manualReview).getByRole('button', {
      name: 'Save manual review',
    })

    for (const [sectionName, saveLabel] of [
      ['Action Queue decisions', 'Save Action Queue decisions'],
      ['Manual review', 'Save manual review'],
      ['Evidence requirements', 'Save evidence requirements'],
      ['Application gates', 'Save application gates'],
      ['Retry recovery', 'Save retry recovery'],
      ['Sourcing windows', 'Save sourcing windows'],
    ] as const) {
      expect(
        within(screen.getByRole('region', { name: sectionName })).getByRole('button', {
          name: saveLabel,
        }),
      ).toBeDisabled()
    }

    fireEvent.change(screen.getByLabelText('Apply cutoff'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Manual pickup delay'), { target: { value: '8' } })
    const explicitApprovalCompanies = screen.getByLabelText('Explicit approval companies')
    expect(explicitApprovalCompanies).toHaveAttribute('data-slot', 'textarea')
    expect(explicitApprovalCompanies).toHaveClass('min-h-24', 'resize-y')
    expect(explicitApprovalCompanies.closest('[data-slot="field"]')).not.toBeNull()
    fireEvent.change(explicitApprovalCompanies, {
      target: { value: 'TikTok\nByteDance\nOpenAI' },
    })

    expect(policyApi.config.update).not.toHaveBeenCalled()
    expect(queueSaveButton).toBeEnabled()
    expect(manualReviewSaveButton).toBeEnabled()

    fireEvent.click(queueSaveButton)

    await waitFor(() => {
      expect(policyApi.config.update).toHaveBeenCalledTimes(1)
    })

    expect(vi.mocked(policyApi.config.update).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        actionQueue: expect.objectContaining({
          staleLockHours: defaultPolicyConfig.actionQueue.staleLockHours,
        }),
        scoring: expect.objectContaining({
          applyCutoff: 7,
        }),
      }),
    )
    expect(await screen.findByText('Action Queue decisions saved.')).toBeInTheDocument()
    expect(queueSaveButton).toBeDisabled()
    expect(manualReviewSaveButton).toBeEnabled()
    expect(screen.getByLabelText('Manual pickup delay')).toHaveValue(8)

    fireEvent.click(manualReviewSaveButton)

    await waitFor(() => {
      expect(policyApi.config.update).toHaveBeenCalledTimes(2)
    })

    expect(vi.mocked(policyApi.config.update).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        manualReview: expect.objectContaining({
          explicitApprovalCompanyPatterns: ['TikTok', 'ByteDance', 'OpenAI'],
          pickupDelayHours: 8,
        }),
      }),
    )
    expect(await screen.findByText('Manual review saved.')).toBeInTheDocument()
    expect(manualReviewSaveButton).toBeDisabled()
  })

  it('resets policy defaults only after alert confirmation and clears pending section saves', async () => {
    const policyApi = createPolicyApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        policyApi={policyApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Policy' }))
    expect(await screen.findByRole('heading', { name: 'Policy' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Apply cutoff'), { target: { value: '9' } })
    expect(screen.getByLabelText('Apply cutoff')).toHaveValue(9)

    expect(
      within(screen.getByRole('region', { name: 'Action Queue decisions' })).getByRole('button', {
        name: 'Save Action Queue decisions',
      }),
    ).toBeEnabled()
    expect(policyApi.config.update).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reset policy' }))

    const cancelDialog = await screen.findByRole('alertdialog', { name: 'Reset policy?' })
    expect(policyApi.config.reset).not.toHaveBeenCalled()
    expect(cancelDialog).toHaveAccessibleDescription(
      'This restores default policy buckets, gates, and sourcing windows.',
    )
    fireEvent.click(within(cancelDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Reset policy?' })).not.toBeInTheDocument()
    })
    expect(policyApi.config.reset).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Apply cutoff')).toHaveValue(9)

    fireEvent.click(screen.getByRole('button', { name: 'Reset policy' }))
    const confirmDialog = await screen.findByRole('alertdialog', { name: 'Reset policy?' })
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Reset policy' }))

    await waitFor(() => {
      expect(policyApi.config.reset).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByLabelText('Apply cutoff')).toHaveValue(defaultPolicyConfig.scoring.applyCutoff)
    expect(
      within(screen.getByRole('region', { name: 'Action Queue decisions' })).getByRole('button', {
        name: 'Save Action Queue decisions',
      }),
    ).toBeDisabled()
    expect(await screen.findByText('Policy reset.')).toBeInTheDocument()
  })

  it('keeps the policy reset alert open with an error and disables confirm while pending', async () => {
    const policyApi = createPolicyApi()
    let rejectReset: ((reason?: unknown) => void) | undefined
    policyApi.config.reset = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectReset = reject
        }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        policyApi={policyApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Policy' }))
    expect(await screen.findByRole('heading', { name: 'Policy' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reset policy' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Reset policy?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset policy' }))

    await waitFor(() => {
      expect(policyApi.config.reset).toHaveBeenCalledTimes(1)
    })
    expect(within(dialog).getByRole('button', { name: 'Resetting...' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()

    rejectReset?.(new Error('Policy store unavailable.'))

    expect(await within(dialog).findByText('Policy store unavailable.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Reset policy' })).toBeEnabled()
    expect(screen.getByRole('alertdialog', { name: 'Reset policy?' })).toBeInTheDocument()
  })

})
