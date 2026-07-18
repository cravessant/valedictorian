import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFixtureApi,
  INSTANCE_ID,
  renderPanel,
  searchResult,
} from './ConnectorProviderFilters.test-helpers'

afterEach(cleanup)

describe('connector provider filter responsive containment', () => {
  it('stacks generic provider and config fields with a container-responsive contract', async () => {
    const connectorsApi = await createFixtureApi({
      employmentKind: 'internship',
      country: 'US',
    }, {}, {
      discoveryLimit: 20,
      maxRunElapsedMs: 120_000,
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const providerRegion = within(card).getByRole('region', {
      name: 'Fixture provider provider filters',
    })
    const configRegion = within(card).getByRole('region', {
      name: 'Fixture provider synchronization configuration',
    })

    const providerGrid = providerRegion.querySelector('[data-slot="connector-field-grid"]')
    const configGrid = configRegion.querySelector('[data-slot="connector-field-grid"]')
    expect(providerGrid).not.toBeNull()
    expect(configGrid).not.toBeNull()

    expect(providerRegion).toHaveClass('@container/connector-fields', 'min-w-0')
    expect(configRegion).toHaveClass('@container/connector-fields', 'min-w-0')
    expect(providerGrid).toHaveClass(
      'min-w-0',
      '@md/connector-fields:grid-cols-2',
    )
    expect(providerGrid).not.toHaveClass('md:grid-cols-2')
    expect(configGrid).toHaveClass(
      'min-w-0',
      '@md/connector-fields:grid-cols-2',
    )
    expect(configGrid).not.toHaveClass('md:grid-cols-2')

    expect(within(providerRegion).getByLabelText('Employment kind')).toBeInTheDocument()
    expect(within(providerRegion).getByLabelText('Country')).toBeInTheDocument()
    expect(within(configRegion).getByLabelText('Discovery limit')).toBeInTheDocument()
    expect(within(configRegion).getByRole('spinbutton', { name: 'Maximum run duration' }))
      .toBeInTheDocument()
  })

  it('contains number-range controls and async option results inside the field region', async () => {
    const longOptionLabel = 'Very long provider taxonomy label that must remain readable without expanding the document'
    const connectorsApi = await createFixtureApi({
      compensationRange: [70_000, 120_000],
      country: 'US',
    }, {
      search() {
        return Promise.resolve(searchResult('react', longOptionLabel))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const providerRegion = within(card).getByRole('region', {
      name: 'Fixture provider provider filters',
    })

    const range = within(providerRegion).getByRole('group', { name: 'Compensation' })
    expect(range.tagName).toBe('FIELDSET')
    expect(range).toHaveClass('min-w-0')
    expect(within(range).getByRole('spinbutton', { name: 'Minimum compensation' })).toBeInTheDocument()
    expect(within(range).getByRole('spinbutton', { name: 'Maximum compensation' })).toBeInTheDocument()
    expect(within(range).getByText(/Inclusive minimum and maximum compensation/i)).toBeInTheDocument()

    const skills = within(providerRegion).getByRole('combobox', { name: 'Include Skills' })
    fireEvent.change(skills, { target: { value: 'rea' } })
    const option = await within(providerRegion).findByRole('option', { name: longOptionLabel })
    const listbox = within(providerRegion).getByRole('listbox')

    expect(listbox).toHaveClass('max-w-full', 'min-w-0')
    expect(listbox).not.toHaveClass('overflow-x-auto')
    expect(option).toHaveClass('min-w-0', 'break-words')
    expect(option).toHaveTextContent(longOptionLabel)

    fireEvent.click(option)
    await waitFor(() => {
      expect(within(providerRegion).queryByRole('listbox')).not.toBeInTheDocument()
    })
    expect(within(providerRegion).getByText(longOptionLabel)).toBeInTheDocument()
  })
})
