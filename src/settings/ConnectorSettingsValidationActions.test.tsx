import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectInstalledConnectorDescriptor } from '../modules/connectors/connector.capabilities'
import { createDefaultLocalConnectorRegistry } from '../modules/connectors/connector.registry'
import {
  createFixtureApi,
  INSTANCE_ID,
  renderPanel,
} from './ConnectorProviderFilters.test-helpers'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function rangeFieldError(card: HTMLElement, fieldName: RegExp | string) {
  const control = within(card).getByRole('spinbutton', { name: fieldName })
  const describedBy = control.getAttribute('aria-describedby')
  expect(describedBy).toBeTruthy()
  const ids = describedBy!.split(/\s+/).filter(Boolean)
  const messages = ids
    .map((id) => card.querySelector(`#${CSS.escape(id)}`))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map((node) => node.textContent ?? '')
  return { control, messages: messages.join(' ') }
}

function liveRegionRoles(card: HTMLElement) {
  return {
    alerts: within(card).queryAllByRole('alert'),
    statuses: within(card).queryAllByRole('status'),
  }
}

describe('connector validation and action-state synchronization', () => {
  it('keeps a field-linked inverted range error through unrelated edits until corrected or discarded', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      compensationRange: [70_000, 120_000],
      skills: [],
      keyword: 'platform',
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const minimum = within(card).getByRole('spinbutton', { name: 'Minimum compensation' })
    const maximum = within(card).getByRole('spinbutton', { name: 'Maximum compensation' })
    const save = within(card).getByRole('button', { name: 'Save Fixture provider settings' })

    fireEvent.change(minimum, { target: { value: '150000' } })
    fireEvent.change(maximum, { target: { value: '50000' } })

    const linked = rangeFieldError(card, 'Minimum compensation')
    expect(linked.control).toHaveAttribute('aria-invalid', 'true')
    expect(within(card).getByRole('spinbutton', { name: 'Maximum compensation' }))
      .toHaveAttribute('aria-invalid', 'true')
    expect(linked.messages).toMatch(/range|minimum|maximum|endpoint/i)
    expect(save).toBeDisabled()

    const regions = liveRegionRoles(card)
    expect(regions.alerts).toHaveLength(1)
    expect(regions.alerts[0]).toHaveTextContent(/range|minimum|maximum|endpoint/i)
    const fieldErrorNode = card.querySelector(
      `#${CSS.escape(linked.control.getAttribute('aria-describedby')!.split(/\s+/).at(-1)!)}`,
    )
    expect(fieldErrorNode).toHaveTextContent(/range|minimum|maximum|endpoint/i)
    expect(fieldErrorNode).not.toHaveAttribute('role', 'alert')
    expect(fieldErrorNode).not.toHaveAttribute('role', 'status')

    fireEvent.change(within(card).getByRole('textbox', { name: 'Keyword' }), {
      target: { value: 'infrastructure' },
    })
    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })

    const afterUnrelated = rangeFieldError(card, 'Minimum compensation')
    expect(afterUnrelated.control).toHaveAttribute('aria-invalid', 'true')
    expect(afterUnrelated.messages).toMatch(/range|minimum|maximum|endpoint/i)
    expect(minimum).toHaveValue(150_000)
    expect(maximum).toHaveValue(50_000)
    expect(save).toBeDisabled()

    const saveReasonId = save.getAttribute('aria-describedby')
    expect(saveReasonId).toBeTruthy()
    const saveReason = card.querySelector(`#${CSS.escape(saveReasonId!)}`)
    expect(saveReason).toHaveTextContent(/range|minimum|maximum|compatib|valid/i)

    const actions = within(card).getByTestId(`connector-settings-actions-${INSTANCE_ID}`)
    expect(actions).toHaveAttribute('tabIndex', '0')
    expect(actions.getAttribute('aria-describedby') ?? '').toContain(saveReasonId!)

    actions.focus()
    expect(actions).toHaveFocus()
    expect(card.querySelector(`#${CSS.escape(saveReasonId!)}`)).toHaveTextContent(
      /range|minimum|maximum|compatib|valid/i,
    )

    fireEvent.change(maximum, { target: { value: '160000' } })
    expect(minimum).not.toHaveAttribute('aria-invalid', 'true')
    expect(maximum).not.toHaveAttribute('aria-invalid', 'true')
    expect(save).toBeEnabled()

    fireEvent.change(minimum, { target: { value: '200000' } })
    expect(rangeFieldError(card, 'Minimum compensation').control)
      .toHaveAttribute('aria-invalid', 'true')
    expect(save).toBeDisabled()

    fireEvent.click(within(card).getByRole('button', { name: 'Discard unsaved settings' }))
    await waitFor(() => {
      expect(minimum).toHaveValue(70_000)
      expect(maximum).toHaveValue(120_000)
    })
    expect(minimum).not.toHaveAttribute('aria-invalid', 'true')
    expect(within(card).queryByText(/range minimum endpoint/i)).not.toBeInTheDocument()
  })

  it('keeps Jobright experience range field errors through taxonomy edits and blocks Run with matching disabled visuals', async () => {
    const descriptor = projectInstalledConnectorDescriptor(
      createDefaultLocalConnectorRegistry().get('jobright.resolver')!,
    )
    const taxonomySource = descriptor.dynamicOptions!.sources.find((source) =>
      source.id === 'jobright.taxonomy')!
    const connectorsApi = await createFixtureApi(
      {
        jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
        country: 'US',
        minYearsOfExperienceRange: [2, 5],
      },
      {
        search: async () => ({
          connectorInstanceId: INSTANCE_ID,
          connectorId: descriptor.connectorId,
          connectorVersion: descriptor.connectorVersion,
          filterSchemaVersion: descriptor.filterSchema!.version,
          catalogVersion: descriptor.dynamicOptions!.version,
          sourceId: taxonomySource.id,
          sourceVersion: taxonomySource.version,
          status: 'search_ready',
          options: [{
            key: 'product',
            label: 'Product Manager',
            value: { taxonomyId: 'product', title: 'Product Manager' },
          }],
          truncated: false,
        }),
      },
      { maxRunElapsedMs: 120_000 },
      descriptor,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const minimum = within(card).getByRole('spinbutton', { name: 'Minimum years of experience' })
    const maximum = within(card).getByRole('spinbutton', { name: 'Maximum years of experience' })
    const save = within(card).getByRole('button', { name: /Save .* settings/ })
    const run = within(card).getByRole('button', { name: 'Run Jobright now' })

    fireEvent.change(minimum, { target: { value: '10' } })
    fireEvent.change(maximum, { target: { value: '2' } })

    const linked = rangeFieldError(card, 'Minimum years of experience')
    expect(linked.control).toHaveAttribute('aria-invalid', 'true')
    expect(linked.messages).toMatch(/range|minimum|maximum|endpoint/i)
    expect(save).toBeDisabled()
    expect(run).toBeDisabled()
    expect(run).toHaveClass('disabled:bg-muted')
    expect(run).toHaveClass('disabled:text-muted-foreground')

    const taxonomy = within(card).getByRole('combobox', { name: /Include .*taxonomy/i })
    fireEvent.change(taxonomy, { target: { value: 'Prod' } })
    fireEvent.click(await within(card).findByRole('option', { name: 'Product Manager' }))

    expect(rangeFieldError(card, 'Minimum years of experience').control)
      .toHaveAttribute('aria-invalid', 'true')
    expect(minimum).toHaveValue(10)
    expect(maximum).toHaveValue(2)
    expect(save).toBeDisabled()
    expect(run).toBeDisabled()
    expect(run).toHaveClass('disabled:bg-muted')

    const runReasonId = run.getAttribute('aria-describedby')
    expect(runReasonId).toBeTruthy()
    expect(card.querySelector(`#${CSS.escape(runReasonId!)}`))
      .toHaveTextContent(/range|unsaved|valid|compatib/i)

    const actions = within(card).getByTestId(`connector-run-actions-${INSTANCE_ID}`)
    expect(actions).toHaveAttribute('tabIndex', '0')
    expect(save).toBeDisabled()
    expect(run).toBeDisabled()
    actions.focus()
    expect(actions).toHaveFocus()
    expect(card.querySelector(`#${CSS.escape(runReasonId!)}`)).toHaveTextContent(
      /range|unsaved|valid|compatib/i,
    )
  })

  it('disables Save for invalid earliest backfill and reports the date error on Run', async () => {
    const descriptor = projectInstalledConnectorDescriptor(
      createDefaultLocalConnectorRegistry().get('jobright.resolver')!,
    )
    const connectorsApi = await createFixtureApi(
      {
        jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
        country: 'US',
      },
      {},
      { maxRunElapsedMs: 120_000 },
      descriptor,
    )
    await connectorsApi.update({
      connectorInstanceId: INSTANCE_ID,
      earliestBackfillDate: 'not-a-date',
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const save = within(card).getByRole('button', { name: /Save .* settings/ })
    const run = within(card).getByRole('button', { name: 'Run Jobright now' })
    expect(save).toBeDisabled()
    expect(run).toBeDisabled()

    const saveReasonId = save.getAttribute('aria-describedby')
    const runReasonId = run.getAttribute('aria-describedby')
    expect(saveReasonId).toBeTruthy()
    expect(runReasonId).toBeTruthy()
    expect(card.querySelector(`#${CSS.escape(saveReasonId!)}`))
      .toHaveTextContent(/calendar date|YYYY-MM-DD|earliest|backfill/i)
    expect(card.querySelector(`#${CSS.escape(runReasonId!)}`))
      .toHaveTextContent(/calendar date|YYYY-MM-DD|earliest|backfill/i)
  })

  it('disables Save and validate until required write-only credential inputs are present and valid', async () => {
    const descriptor = projectInstalledConnectorDescriptor(
      createDefaultLocalConnectorRegistry().get('jobright.resolver')!,
    )
    const connectorsApi = await createFixtureApi(
      {
        jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
        country: 'US',
      },
      {},
      { maxRunElapsedMs: 120_000 },
      descriptor,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    fireEvent.click(within(card).getByRole('button', { name: 'Add credentials' }))

    const form = within(card).getByTestId(`connector-credential-form-${INSTANCE_ID}`)
    const saveAndValidate = within(form).getByRole('button', { name: 'Save and validate' })
    const email = within(form).getByLabelText('Jobright email')
    const password = within(form).getByLabelText('Jobright password')
    expect(saveAndValidate).toBeDisabled()
    expect(email).toBeRequired()
    expect(password).toBeRequired()

    const credentialActions = within(form).getByTestId(
      `connector-credential-actions-${INSTANCE_ID}`,
    )
    expect(credentialActions).toHaveAttribute('tabIndex', '0')
    const blankReasonId = saveAndValidate.getAttribute('aria-describedby')
    expect(blankReasonId).toBeTruthy()
    expect(form.querySelector(`#${CSS.escape(blankReasonId!)}`))
      .toHaveTextContent(/email|password/i)
    credentialActions.focus()
    expect(credentialActions).toHaveFocus()

    fireEvent.change(email, { target: { value: 'not-an-email' } })
    fireEvent.change(password, { target: { value: 'write-only-fixture-password' } })
    expect(saveAndValidate).toBeDisabled()
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(saveAndValidate.getAttribute('aria-describedby')).toBeTruthy()
    expect(form.querySelector(
      `#${CSS.escape(saveAndValidate.getAttribute('aria-describedby')!)}`,
    )).toHaveTextContent(/valid.*email/i)
    fireEvent.click(saveAndValidate)
    expect(connectorsApi.update).not.toHaveBeenCalled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()

    fireEvent.change(email, { target: { value: 'operator@example.test' } })
    expect(saveAndValidate).toBeEnabled()
    expect(email).not.toHaveAttribute('aria-invalid', 'true')

    expect(connectorsApi.update).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('write-only-fixture-password')).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByDisplayValue('write-only-fixture-password')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('operator@example.test')).not.toBeInTheDocument()
  })
})
