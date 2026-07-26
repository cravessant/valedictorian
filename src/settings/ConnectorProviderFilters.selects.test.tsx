import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorOptionQueryResult } from '@sparxie/sdk'
import {
  boundOptionResult,
  catalogIdentityBumpedDescriptor,
  createFixtureApi,
  deferred,
  denverOption,
  discardFixtureConnectorEditorChangesAndReopen,
  extraDependencyDescriptor,
  filterSchemaDescriptor,
  INSTANCE_ID,
  type PublicOptionQueryInput,
  renderPanel,
  renderProviderFilters,
  resolveReady,
  retryableUnavailableResult,
  typescriptOption,
} from './ConnectorProviderFilters.test-helpers'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const enumDefaultsProperties = {
  employmentKind: {
    type: 'string' as const,
    enum: ['internship', 'full_time'],
    default: 'internship',
  },
  daysAgo: {
    type: 'integer' as const,
    enum: [1, 3, 7],
    default: 7,
  },
}

function instanceCard() {
  return screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
}

function saveButton(card: HTMLElement) {
  return within(card).getByRole('button', { name: 'Save changes' })
}

function selectCountry(card: HTMLElement, value: string) {
  fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
    target: { value },
  })
}

async function expectClearFeedback(card: HTMLElement, valuePattern: RegExp) {
  const feedback = await within(card).findByRole('status')
  expect(feedback).toHaveTextContent(valuePattern)
  expect(feedback).toHaveTextContent(/cleared|removed|unavailable/i)
  return feedback
}

async function expectCompatibilityAlert(
  scope: { findByRole: typeof screen.findByRole },
  valuePattern: RegExp,
) {
  const compatibility = await scope.findByRole('alert')
  expect(compatibility).toHaveTextContent(valuePattern)
  expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
  return compatibility
}

describe('connector optional selects and dependency invalidation', () => {
  it('re-resolves persisted values when a declared dependency changes and blocks save while pending', async () => {
    const changedResolution = deferred<ConnectorOptionQueryResult>()
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (input.body.dependencies.country === 'CA') return changedResolution.promise
        return resolveReady(input, [typescriptOption])
      },
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    await waitFor(() => expect(resolveInputs).toHaveLength(1))
    await waitFor(() => expect(saveButton(card)).toBeDisabled())
    selectCountry(card, 'CA')
    await waitFor(() => expect(resolveInputs).toHaveLength(2))
    expect(resolveInputs[1]?.body.dependencies).toEqual({ country: 'CA' })
    expect(saveButton(card)).toBeDisabled()

    changedResolution.resolve(boundOptionResult(resolveInputs[1]!, {
      status: 'resolve_ready',
      options: [],
      unknownValues: ['typescript'],
    }))
    await expectClearFeedback(card, /typescript/i)
    expect(within(card).queryByText('TypeScript')).not.toBeInTheDocument()
    expect(within(card).queryByText('typescript')).not.toBeInTheDocument()
    await waitFor(() => expect(saveButton(card)).toBeEnabled())
  })

  it('keeps Select… on optional string and numeric selects and omits cleared values from save/reload', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      employmentKind: 'internship',
      daysAgo: 7,
      skills: [],
    }, {}, { discoveryLimit: 20 })
    const first = renderPanel(connectorsApi)

    const card = await instanceCard()
    const employmentKind = within(card).getByRole('combobox', { name: 'Employment kind' })
    const daysAgo = within(card).getByRole('combobox', { name: 'Days ago' })
    const discoveryLimit = within(card).getByRole('combobox', { name: 'Discovery limit' })

    expect(employmentKind).toHaveTextContent('Select…')
    expect(daysAgo).toHaveTextContent('Select…')
    expect(discoveryLimit).toHaveTextContent('Select…')

    fireEvent.change(employmentKind, { target: { value: '' } })
    fireEvent.change(daysAgo, { target: { value: '' } })
    fireEvent.change(discoveryLimit, { target: { value: '' } })
    expect(employmentKind).toHaveValue('')
    expect(daysAgo).toHaveValue('')
    expect(discoveryLimit).toHaveValue('')

    employmentKind.focus()
    fireEvent.change(employmentKind, { target: { value: 'full_time' } })
    expect(employmentKind).toHaveTextContent('Select…')
    fireEvent.keyDown(employmentKind, { key: 'Home' })
    fireEvent.change(employmentKind, { target: { value: '' } })
    expect(employmentKind).toHaveValue('')

    fireEvent.click(saveButton(card))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      enabled: true,
      filters: { country: 'US', skills: [] },
      config: {},
    }))

    first.unmount()
    renderPanel(connectorsApi)
    const reloaded = await instanceCard()
    expect(within(reloaded).getByRole('combobox', { name: 'Employment kind' })).toHaveValue('')
    expect(within(reloaded).getByRole('combobox', { name: 'Days ago' })).toHaveValue('')
    expect(within(reloaded).getByRole('combobox', { name: 'Discovery limit' })).toHaveValue('')
  })

  it('does not offer Select… clear on required scalar selects after a value is chosen', async () => {
    const connectorsApi = await createFixtureApi(
      { country: 'US', skills: [] },
      {},
      {},
      filterSchemaDescriptor({ required: ['country'] }),
    )
    renderPanel(connectorsApi)

    const card = await instanceCard()
    const country = within(card).getByRole('combobox', { name: 'Country' })
    expect(country).toHaveValue('US')
    expect(country).not.toHaveTextContent('Select…')
  })

  it('clears dependency-invalid dynamic values with accessible feedback and keeps save valid', async () => {
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (input.body.dependencies.country === 'CA') {
          return resolveReady(input, [], ['denver-co'])
        }
        return resolveReady(input, [denverOption])
      },
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(saveButton(card)).toBeDisabled())

    selectCountry(card, 'CA')
    await expectClearFeedback(card, /denver/i)
    expect(within(card).queryByText('Denver, CO')).not.toBeInTheDocument()
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(saveButton(card)).toBeEnabled())

    fireEvent.click(saveButton(card))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      enabled: true,
      filters: { country: 'CA', skills: [] },
    }))
    expect(resolveInputs.some((input) => input.body.dependencies.country === 'CA')).toBe(true)
  })

  it('keeps dependent values that resolve successfully in the new dependency context', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript'],
    }, {
      resolve: (input) => resolveReady(input, [typescriptOption]),
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('TypeScript')).toBeInTheDocument()
    selectCountry(card, 'CA')
    expect(await within(card).findByText('TypeScript')).toBeInTheDocument()
    await waitFor(() => expect(
      within(card).queryByRole('status'),
    ).not.toBeInTheDocument())
    expect(saveButton(card)).toBeEnabled()
  })

  it('ignores a stale dependency-context resolve after discard restores persisted values', async () => {
    const caResolution = deferred<ConnectorOptionQueryResult>()
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (input.body.dependencies.country === 'CA') return caResolution.promise
        return resolveReady(input, [denverOption])
      },
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(resolveInputs).toHaveLength(1))

    selectCountry(card, 'CA')
    await waitFor(() => expect(resolveInputs).toHaveLength(2))
    const restoredCard = await discardFixtureConnectorEditorChangesAndReopen(card)

    expect(within(restoredCard).getByRole('combobox', { name: 'Country' })).toHaveValue('US')
    expect(await within(restoredCard).findByText('Denver, CO')).toBeInTheDocument()

    caResolution.resolve(boundOptionResult(resolveInputs[1]!, {
      status: 'resolve_ready',
      options: [],
      unknownValues: ['denver-co'],
    }))
    await waitFor(() => {
      expect(within(restoredCard).getByRole('combobox', { name: 'Country' })).toHaveValue('US')
      expect(within(restoredCard).getByText('Denver, CO')).toBeInTheDocument()
    })
    expect(within(restoredCard).queryByText(/cleared|removed/i)).not.toBeInTheDocument()
  })

  it('restores exact persisted values when discarding dependency-triggered clears', async () => {
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (input.body.dependencies.country === 'CA') {
          return resolveReady(input, [], ['denver-co'])
        }
        return resolveReady(input, [denverOption])
      },
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(resolveInputs).toHaveLength(1))

    selectCountry(card, 'CA')
    expect(await within(card).findByRole('status')).toHaveTextContent(/cleared|removed|unavailable/i)
    expect(within(card).queryByText('Denver, CO')).not.toBeInTheDocument()

    const resolveCountAfterClear = resolveInputs.length
    const restoredCard = await discardFixtureConnectorEditorChangesAndReopen(card)

    expect(within(restoredCard).getByRole('combobox', { name: 'Country' })).toHaveValue('US')
    expect(await within(restoredCard).findByText('Denver, CO')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(resolveInputs.length).toBe(resolveCountAfterClear + 1)
    expect(within(restoredCard).getByText('Denver, CO')).toBeInTheDocument()
    expect(within(restoredCard).getByRole('combobox', { name: 'Country' })).toHaveValue('US')
  })

  it('does not clear persisted dynamic values when only catalog/source identity changes', async () => {
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (input.expectedIdentity.catalogVersion === 'fixture-provider-options@2') {
          return resolveReady(input, [], ['typescript'])
        }
        return resolveReady(input, [typescriptOption])
      },
    })
    const filters = { country: 'US', skills: ['typescript'] }
    const harness = renderProviderFilters(connectorsApi.options, { filters })

    expect(await screen.findByText('TypeScript')).toBeInTheDocument()
    await waitFor(() => expect(resolveInputs).toHaveLength(1))
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(true))
    harness.onChange.mockClear()
    harness.onCompatibilityChange.mockClear()

    harness.rerender({ descriptor: catalogIdentityBumpedDescriptor() })

    await waitFor(() => expect(resolveInputs).toHaveLength(2))
    expect(resolveInputs[1]?.expectedIdentity.catalogVersion).toBe('fixture-provider-options@2')
    expect(resolveInputs[1]?.body.dependencies).toEqual({ country: 'US' })
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove TypeScript' })).toBeInTheDocument()
    expect(harness.onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await expectCompatibilityAlert(screen, /typescript/i)
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('does not clear persisted dynamic values when dependency declarations change without filter value changes', async () => {
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (input.expectedIdentity.catalogVersion === 'fixture-provider-options@2') {
          return resolveReady(input, [], ['typescript'])
        }
        return resolveReady(input, [typescriptOption])
      },
    })
    const filters = { country: 'US', skills: ['typescript'] }
    const harness = renderProviderFilters(connectorsApi.options, { filters })

    expect(await screen.findByText('TypeScript')).toBeInTheDocument()
    await waitFor(() => expect(resolveInputs).toHaveLength(1))
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(true))
    harness.onChange.mockClear()

    harness.rerender({
      descriptor: extraDependencyDescriptor(catalogIdentityBumpedDescriptor()),
    })

    await waitFor(() => expect(resolveInputs).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Remove TypeScript' })).toBeInTheDocument()
    expect(harness.onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    await expectCompatibilityAlert(screen, /typescript/i)
  })

  it('does not auto-clear an initial persisted unknown when a dependency later changes', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['cobol'],
    }, {
      resolve: (input) => resolveReady(input, [], ['cobol']),
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('cobol')).toBeInTheDocument()
    expect(await within(card).findByRole('alert')).toHaveTextContent(/cobol/i)
    expect(saveButton(card)).toBeDisabled()

    selectCountry(card, 'CA')
    expect(await within(card).findByText('cobol')).toBeInTheDocument()
    expect(within(card).queryByText(/was cleared because/i)).not.toBeInTheDocument()
    await expectCompatibilityAlert(within(card), /cobol/i)
    expect(saveButton(card)).toBeDisabled()
  })

  it('does not clear a restored persisted unknown after discard across dependency changes', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['cobol'],
    }, {
      resolve: (input) => resolveReady(input, [], ['cobol']),
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('cobol')).toBeInTheDocument()
    await within(card).findByRole('alert')

    selectCountry(card, 'CA')
    expect(await within(card).findByText('cobol')).toBeInTheDocument()
    const restoredCard = await discardFixtureConnectorEditorChangesAndReopen(card)

    expect(within(restoredCard).getByRole('combobox', { name: 'Country' })).toHaveValue('US')
    expect(await within(restoredCard).findByText('cobol')).toBeInTheDocument()
    expect(within(restoredCard).queryByText(/was cleared because/i)).not.toBeInTheDocument()

    selectCountry(restoredCard, 'CA')
    expect(await within(restoredCard).findByText('cobol')).toBeInTheDocument()
    expect(within(restoredCard).queryByText(/was cleared because/i)).not.toBeInTheDocument()
    expect(await within(restoredCard).findByRole('alert')).toHaveTextContent(/cobol/i)
  })

  it('does not auto-clear any selection when only some many-values were verified in the prior context', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript', 'cobol'],
    }, {
      resolve(input) {
        if (input.body.dependencies.country === 'CA') {
          return resolveReady(input, [], ['typescript', 'cobol'])
        }
        return resolveReady(input, [typescriptOption], ['cobol'])
      },
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('TypeScript')).toBeInTheDocument()
    expect(within(card).getByText('cobol')).toBeInTheDocument()
    expect(await within(card).findByRole('alert')).toHaveTextContent(/cobol/i)

    selectCountry(card, 'CA')
    expect(await within(card).findByText('TypeScript')).toBeInTheDocument()
    expect(within(card).getByText('cobol')).toBeInTheDocument()
    expect(within(card).queryByText(/was cleared because/i)).not.toBeInTheDocument()
    expect(await within(card).findByRole('alert')).toHaveTextContent(/unknown|unavailable|compatib/i)
    expect(saveButton(card)).toBeDisabled()
  })

  it('retains clear authorization across retryable resolve failure after a verified dependency change', async () => {
    let caAttempts = 0
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, {
      resolve(input) {
        if (input.body.dependencies.country === 'CA') {
          caAttempts += 1
          if (caAttempts === 1) return Promise.resolve(retryableUnavailableResult())
          return resolveReady(input, [], ['denver-co'])
        }
        return resolveReady(input, [denverOption])
      },
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(saveButton(card)).toBeDisabled())

    selectCountry(card, 'CA')
    expect(await within(card).findByRole('alert')).toHaveTextContent(/unavailable|temporarily|retry/i)
    expect(within(card).getByText('Denver, CO')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: /retry/i }))

    await expectClearFeedback(card, /denver/i)
    expect(within(card).queryByText('Denver, CO')).not.toBeInTheDocument()
    await waitFor(() => expect(saveButton(card)).toBeEnabled())
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps optional enum selects with defaults unset after clear and reload', async () => {
    const connectorsApi = await createFixtureApi(
      { country: 'US', skills: [] },
      {},
      {},
      filterSchemaDescriptor({ properties: enumDefaultsProperties }),
    )
    const first = renderPanel(connectorsApi)

    const card = await instanceCard()
    const employmentKind = within(card).getByRole('combobox', { name: 'Employment kind' })
    const daysAgo = within(card).getByRole('combobox', { name: 'Days ago' })
    expect(employmentKind).toHaveValue('')
    expect(daysAgo).toHaveValue('')
    expect(employmentKind).toHaveTextContent('Select…')
    expect(daysAgo).toHaveTextContent('Select…')

    fireEvent.change(employmentKind, { target: { value: 'full_time' } })
    fireEvent.change(daysAgo, { target: { value: '3' } })
    expect(employmentKind).toHaveValue('full_time')
    expect(daysAgo).toHaveValue('3')

    fireEvent.change(employmentKind, { target: { value: '' } })
    fireEvent.change(daysAgo, { target: { value: '' } })
    expect(employmentKind).toHaveValue('')
    expect(daysAgo).toHaveValue('')

    fireEvent.click(within(card).getByRole('switch', {
      name: 'Fixture provider connector enabled',
    }))
    fireEvent.click(saveButton(card))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      enabled: false,
    }))

    first.unmount()
    renderPanel(connectorsApi)
    const reloaded = await instanceCard()
    expect(within(reloaded).getByRole('combobox', { name: 'Employment kind' })).toHaveValue('')
    expect(within(reloaded).getByRole('combobox', { name: 'Days ago' })).toHaveValue('')
    expect(within(reloaded).getByRole('combobox', { name: 'Employment kind' }))
      .toHaveTextContent('Select…')
    expect(within(reloaded).getByRole('combobox', { name: 'Days ago' }))
      .toHaveTextContent('Select…')
  })

  it('keeps absent required enum fields on Select… until the default is chosen explicitly', async () => {
    const connectorsApi = await createFixtureApi(
      { skills: [] },
      {},
      {},
      filterSchemaDescriptor({
        properties: enumDefaultsProperties,
        required: ['employmentKind', 'daysAgo', 'country'],
      }),
    )
    renderPanel(connectorsApi)

    const card = await instanceCard()
    const employmentKind = within(card).getByRole('combobox', { name: 'Employment kind' })
    const daysAgo = within(card).getByRole('combobox', { name: 'Days ago' })
    const country = within(card).getByRole('combobox', { name: 'Country' })
    const save = saveButton(card)

    expect(employmentKind).toHaveValue('')
    expect(daysAgo).toHaveValue('')
    expect(country).toHaveValue('')
    expect(employmentKind).toHaveTextContent('Select…')
    expect(daysAgo).toHaveTextContent('Select…')
    expect(country).toHaveTextContent('Select…')
    expect(save).toBeDisabled()

    fireEvent.change(employmentKind, { target: { value: 'internship' } })
    fireEvent.change(daysAgo, { target: { value: '7' } })
    fireEvent.change(country, { target: { value: 'US' } })
    expect(employmentKind).toHaveValue('internship')
    expect(daysAgo).toHaveValue('7')
    expect(country).toHaveValue('US')
    expect(employmentKind).not.toHaveTextContent('Select…')
    expect(daysAgo).not.toHaveTextContent('Select…')
    expect(country).not.toHaveTextContent('Select…')
    await waitFor(() => expect(save).toBeEnabled())

    fireEvent.click(save)
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      enabled: true,
      filters: {
        country: 'US',
        employmentKind: 'internship',
        daysAgo: 7,
        skills: [],
      },
    }))
  })
})
