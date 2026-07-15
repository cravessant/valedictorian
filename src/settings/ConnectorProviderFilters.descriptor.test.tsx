import { cleanup, screen, within } from '@testing-library/react'
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

describe('declarative connector provider descriptor coverage', () => {
  it('renders every released Jobright bounded field through the provider-neutral descriptor path', async () => {
    const descriptor = projectInstalledConnectorDescriptor(
      createDefaultLocalConnectorRegistry().get('jobright.resolver')!,
    )
    const connectorsApi = await createFixtureApi(
      {
        jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
      },
      {},
      {},
      descriptor,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    for (const label of [
      'Minimum min years of experience',
      'Maximum min years of experience',
      'Annual salary minimum',
      'Is h1 bonly',
      'Exclude security clearance',
      'Exclude us citizen',
      'Exclude staffing agency',
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
    for (const label of ['Country', 'Days ago', 'Role type']) {
      expect(within(card).getByRole('combobox', { name: label })).toBeInTheDocument()
    }
    for (const label of [
      'Include job taxonomy list',
      'Exclude title',
      'Include locations',
      'Include company category',
      'Exclude company category',
      'Include skills',
      'Exclude skills',
      'Include companies',
      'Exclude companies',
    ]) {
      expect(within(card).getByRole('combobox', { name: label })).toBeInTheDocument()
    }
    expect(card).not.toHaveTextContent(['role', 'Terms'].join(''))
    expect(card).not.toHaveTextContent(['max', 'ResolutionCount'].join(''))
  })
})
