import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InstalledConnectorDescriptor } from 'sparxie'
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

describe('declarative connector provider descriptor coverage', () => {
  it('renders every released Jobright bounded field through the provider-neutral descriptor path', async () => {
    const descriptor = projectInstalledConnectorDescriptor(
      createDefaultLocalConnectorRegistry().get('jobright.resolver')!,
    )
    const connectorsApi = await createFixtureApi(
      {
        jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
        jobTypes: [1],
        workModel: [2],
        seniority: [3],
        country: 'US',
        isH1BOnly: false,
        excludeSecurityClearance: true,
        excludeUsCitizen: false,
        excludeStaffingAgency: true,
      },
      {},
      { maxRunElapsedMs: 120_000 },
      descriptor,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    for (const label of [
      'Minimum years of experience',
      'Maximum years of experience',
      'Minimum annual salary',
      'H-1B only',
      'Exclude security clearance',
      'Exclude U.S. citizen requirement',
      'Exclude staffing agencies',
    ]) {
      expect(within(card).getByLabelText(label)).toBeInTheDocument()
    }
    for (const legend of [
      'Job types',
      'Work model',
      'Seniority',
      'Company stages',
    ]) {
      expect(within(card).getByRole('group', { name: legend })).toBeInTheDocument()
    }
    for (const label of ['Country', 'Posted within', 'Role type']) {
      expect(within(card).getByRole('combobox', { name: label })).toBeInTheDocument()
    }
    for (const label of [
      'Include Job taxonomy',
      'Exclude titles',
      'Include Locations',
      'Include Industries',
      'Exclude industries',
      'Include Skills',
      'Exclude skills',
      'Include Companies',
      'Exclude companies',
    ]) {
      expect(within(card).getByRole('combobox', { name: label })).toBeInTheDocument()
    }

    expect(within(card).getByRole('checkbox', { name: 'Full-time' })).toBeInTheDocument()
    expect(within(card).getByRole('checkbox', { name: 'Remote' })).toBeInTheDocument()
    expect(within(card).getByRole('checkbox', { name: 'Mid level' })).toBeInTheDocument()
    expect(within(card).queryByRole('checkbox', { name: '1' })).not.toBeInTheDocument()
    expect(within(card).getByRole('combobox', { name: 'Country' })).toHaveTextContent('United States')
    expect(within(card).getByRole('combobox', { name: 'Country' })).toHaveTextContent('Canada')

    const h1b = within(card).getByRole('switch', { name: 'H-1B only' })
    expect(h1b).toHaveAccessibleDescription(/H-1B sponsorship/i)
    expect(within(card).getByRole('switch', { name: 'Exclude U.S. citizen requirement' }))
      .toHaveAccessibleDescription(/U\.S\. citizenship/i)
    expect(within(card).getByRole('switch', { name: 'Exclude security clearance' }))
      .toHaveAccessibleDescription(/security clearance/i)
    expect(within(card).getByRole('switch', { name: 'Exclude staffing agencies' }))
      .toHaveAccessibleDescription(/staffing agencies/i)

    const duration = within(card).getByRole('spinbutton', { name: 'Maximum run duration' })
    expect(duration).toHaveValue(2)
    expect(duration).toHaveAccessibleDescription(/elapsed time/i)
    expect(within(card).getByText('Minutes')).toBeInTheDocument()
    expect(card).not.toHaveTextContent(/Max run elapsed ms/i)
    expect(card).not.toHaveTextContent(/Is h1 bonly/i)

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Contract' }))
    fireEvent.change(duration, { target: { value: '1.5' } })
    fireEvent.click(within(card).getByRole('button', { name: /Save .* settings/ }))

    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith(expect.objectContaining({
      connectorInstanceId: INSTANCE_ID,
      enabled: true,
      config: expect.objectContaining({ maxRunElapsedMs: 90_000 }),
      filters: expect.objectContaining({
        country: 'CA',
        jobTypes: expect.arrayContaining([1, 2]),
      }),
    })))

    expect(card).not.toHaveTextContent(['role', 'Terms'].join(''))
    expect(card).not.toHaveTextContent(['max', 'ResolutionCount'].join(''))
  })

  it('blocks editing when released presentation metadata is missing', async () => {
    const complete = projectInstalledConnectorDescriptor(
      createDefaultLocalConnectorRegistry().get('jobright.resolver')!,
    )
    const stripped = {
      ...complete,
      configSchema: complete.configSchema
        ? { version: complete.configSchema.version, schema: complete.configSchema.schema }
        : undefined,
      filterSchema: complete.filterSchema
        ? { version: complete.filterSchema.version, schema: complete.filterSchema.schema }
        : undefined,
    } as InstalledConnectorDescriptor
    const connectorsApi = await createFixtureApi(
      {
        jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
        country: 'US',
      },
      {},
      { maxRunElapsedMs: 120_000 },
      stripped,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const compatibility = within(card).getAllByRole('alert')[0]
    expect(compatibility).toHaveTextContent(/presentation|metadata|compatib/i)
    expect(within(card).queryByRole('checkbox', { name: '1' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('spinbutton', { name: /max run elapsed/i })).not.toBeInTheDocument()
    const save = within(card).getByRole('button', { name: /Save .* settings/ })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('blocks save when a dynamic oneOf field is missing presentation metadata', async () => {
    const complete = projectInstalledConnectorDescriptor(
      createDefaultLocalConnectorRegistry().get('jobright.resolver')!,
    )
    expect(complete.filterSchema?.presentation?.fields['/locations']).toBeDefined()
    expect(complete.dynamicOptions?.bindings.some((binding) =>
      binding.filterPointer === '/locations')).toBe(true)

    const { '/locations': _removed, ...remainingFields } = complete.filterSchema!.presentation!.fields
    const withoutLocationsPresentation = {
      ...complete,
      filterSchema: {
        ...complete.filterSchema!,
        presentation: { fields: remainingFields },
      },
    } as InstalledConnectorDescriptor

    const connectorsApi = await createFixtureApi(
      {
        jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
        country: 'US',
      },
      {},
      { maxRunElapsedMs: 120_000 },
      withoutLocationsPresentation,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const compatibility = within(card).getByRole('alert')
    expect(compatibility).toHaveTextContent(/presentation|metadata|compatib/i)
    expect(within(card).queryByRole('combobox', { name: /locations/i })).not.toBeInTheDocument()
    const save = within(card).getByRole('button', { name: /Save .* settings/ })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })
})
