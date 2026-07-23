import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ConnectorOptionQueryResult,
  InstalledConnectorDescriptor,
} from 'sparxie'
import { ConnectorProviderFilters } from './connector-filters/ConnectorProviderFilters'
import {
  boundOptionResult,
  createFixtureApi,
  deferred,
  fixtureDescriptor,
  INSTANCE_ID,
  optionIdentityForFixture,
  type PublicOptionQueryInput,
  renderPanel,
} from './ConnectorProviderFilters.test-helpers'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [{ key: 'typescript', label: 'TypeScript', value: 'typescript' }],
          unknownValues: [],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    await waitFor(() => expect(resolveInputs).toHaveLength(1))
    await waitFor(() => expect(
      within(card).getByRole('button', { name: 'Save changes' }),
    ).toBeDisabled())
    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    await waitFor(() => expect(resolveInputs).toHaveLength(2))
    expect(resolveInputs[1]?.body.dependencies).toEqual({ country: 'CA' })
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()

    changedResolution.resolve(boundOptionResult(resolveInputs[1]!, {
      status: 'resolve_ready',
      options: [],
      unknownValues: ['typescript'],
    }))
    const feedback = await within(card).findByRole('status')
    expect(feedback).toHaveTextContent(/typescript/i)
    expect(feedback).toHaveTextContent(/cleared|removed|unavailable/i)
    expect(within(card).queryByText('TypeScript')).not.toBeInTheDocument()
    expect(within(card).queryByText('typescript')).not.toBeInTheDocument()
    await waitFor(() => expect(
      within(card).getByRole('button', { name: 'Save changes' }),
    ).toBeEnabled())
  })

  it('keeps Select… on optional string and numeric selects and omits cleared values from save/reload', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      employmentKind: 'internship',
      daysAgo: 7,
      skills: [],
    }, {}, { discoveryLimit: 20 })
    const first = renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
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

    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      enabled: true,
      filters: { country: 'US', skills: [] },
      config: {},
    }))

    first.unmount()
    renderPanel(connectorsApi)
    const reloaded = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(within(reloaded).getByRole('combobox', { name: 'Employment kind' })).toHaveValue('')
    expect(within(reloaded).getByRole('combobox', { name: 'Days ago' })).toHaveValue('')
    expect(within(reloaded).getByRole('combobox', { name: 'Discovery limit' })).toHaveValue('')
  })

  it('does not offer Select… clear on required scalar selects after a value is chosen', async () => {
    const requiredCountryDescriptor = {
      ...fixtureDescriptor,
      filterSchema: {
        ...fixtureDescriptor.filterSchema,
        schema: {
          ...fixtureDescriptor.filterSchema.schema,
          required: ['country'],
        },
      },
    } satisfies InstalledConnectorDescriptor
    const connectorsApi = await createFixtureApi(
      { country: 'US', skills: [] },
      {},
      {},
      requiredCountryDescriptor,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
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
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [],
            unknownValues: ['denver-co'],
          }))
        }
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [{ key: 'denver-co', label: 'Denver, CO', value: 'denver-co' }],
          unknownValues: [],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(
      within(card).getByRole('button', { name: 'Save changes' }),
    ).toBeDisabled())

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    const feedback = await within(card).findByRole('status')
    expect(feedback).toHaveTextContent(/denver|Denver/i)
    expect(feedback).toHaveTextContent(/cleared|removed|unavailable/i)
    expect(within(card).queryByText('Denver, CO')).not.toBeInTheDocument()
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(
      within(card).getByRole('button', { name: 'Save changes' }),
    ).toBeEnabled())

    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }))
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
      resolve(input) {
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [{ key: 'typescript', label: 'TypeScript', value: 'typescript' }],
          unknownValues: [],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('TypeScript')).toBeInTheDocument()
    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    expect(await within(card).findByText('TypeScript')).toBeInTheDocument()
    await waitFor(() => expect(
      within(card).queryByRole('status'),
    ).not.toBeInTheDocument())
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeEnabled()
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
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [{ key: 'denver-co', label: 'Denver, CO', value: 'denver-co' }],
          unknownValues: [],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(resolveInputs).toHaveLength(1))

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    await waitFor(() => expect(resolveInputs).toHaveLength(2))
    fireEvent.click(within(card).getByRole('button', { name: 'Discard changes' }))

    expect(within(card).getByRole('combobox', { name: 'Country' })).toHaveValue('US')
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()

    caResolution.resolve(boundOptionResult(resolveInputs[1]!, {
      status: 'resolve_ready',
      options: [],
      unknownValues: ['denver-co'],
    }))
    await waitFor(() => {
      expect(within(card).getByRole('combobox', { name: 'Country' })).toHaveValue('US')
      expect(within(card).getByText('Denver, CO')).toBeInTheDocument()
    })
    expect(within(card).queryByText(/cleared|removed/i)).not.toBeInTheDocument()
  })

  it('discards dependency-triggered clears back to exact persisted values without a later provider mutation', async () => {
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (input.body.dependencies.country === 'CA') {
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [],
            unknownValues: ['denver-co'],
          }))
        }
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [{ key: 'denver-co', label: 'Denver, CO', value: 'denver-co' }],
          unknownValues: [],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(resolveInputs).toHaveLength(1))

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    expect(await within(card).findByRole('status')).toHaveTextContent(/cleared|removed|unavailable/i)
    expect(within(card).queryByText('Denver, CO')).not.toBeInTheDocument()

    const resolveCountAfterClear = resolveInputs.length
    fireEvent.click(within(card).getByRole('button', { name: 'Discard changes' }))

    expect(within(card).getByRole('combobox', { name: 'Country' })).toHaveValue('US')
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(resolveInputs.length).toBe(resolveCountAfterClear)
    expect(within(card).getByText('Denver, CO')).toBeInTheDocument()
    expect(within(card).getByRole('combobox', { name: 'Country' })).toHaveValue('US')
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
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [],
            unknownValues: ['typescript'],
          }))
        }
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [{ key: 'typescript', label: 'TypeScript', value: 'typescript' }],
          unknownValues: [],
        }))
      },
    })
    const onChange = vi.fn()
    const onCompatibilityChange = vi.fn()
    const filters = { country: 'US', skills: ['typescript'] }
    const view = render(
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={fixtureDescriptor}
        disabled={false}
        filters={filters}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    expect(await screen.findByText('TypeScript')).toBeInTheDocument()
    await waitFor(() => expect(resolveInputs).toHaveLength(1))
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(true))
    onChange.mockClear()
    onCompatibilityChange.mockClear()

    const identityOnlyDescriptor = {
      ...fixtureDescriptor,
      dynamicOptions: {
        ...fixtureDescriptor.dynamicOptions,
        version: 'fixture-provider-options@2',
        sources: fixtureDescriptor.dynamicOptions.sources.map((source) => ({
          ...source,
          version: 'fixture-skills@2',
        })),
      },
    } satisfies InstalledConnectorDescriptor
    view.rerender(
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={identityOnlyDescriptor}
        disabled={false}
        filters={filters}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    await waitFor(() => expect(resolveInputs).toHaveLength(2))
    expect(resolveInputs[1]?.expectedIdentity.catalogVersion).toBe('fixture-provider-options@2')
    expect(resolveInputs[1]?.body.dependencies).toEqual({ country: 'US' })
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove TypeScript' })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    const compatibility = await screen.findByRole('alert')
    expect(compatibility).toHaveTextContent(/typescript/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(false))
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
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [],
            unknownValues: ['typescript'],
          }))
        }
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [{ key: 'typescript', label: 'TypeScript', value: 'typescript' }],
          unknownValues: [],
        }))
      },
    })
    const onChange = vi.fn()
    const onCompatibilityChange = vi.fn()
    const filters = { country: 'US', skills: ['typescript'] }
    const view = render(
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={fixtureDescriptor}
        disabled={false}
        filters={filters}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    expect(await screen.findByText('TypeScript')).toBeInTheDocument()
    await waitFor(() => expect(resolveInputs).toHaveLength(1))
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(true))
    onChange.mockClear()

    const declarationShapeDescriptor = {
      ...fixtureDescriptor,
      dynamicOptions: {
        ...fixtureDescriptor.dynamicOptions,
        version: 'fixture-provider-options@2',
        sources: fixtureDescriptor.dynamicOptions.sources.map((source) => ({
          ...source,
          version: 'fixture-skills@2',
          dependencies: [
            ...(source.dependencies ?? []),
            {
              id: 'region',
              filterPointer: '/region',
              cardinality: 'one' as const,
              required: false,
            },
          ],
        })),
      },
    } satisfies InstalledConnectorDescriptor
    view.rerender(
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={declarationShapeDescriptor}
        disabled={false}
        filters={filters}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    await waitFor(() => expect(resolveInputs).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Remove TypeScript' })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    const compatibility = await screen.findByRole('alert')
    expect(compatibility).toHaveTextContent(/typescript/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
  })

  it('does not auto-clear an initial persisted unknown when a dependency later changes', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['cobol'],
    }, {
      resolve(input) {
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [],
          unknownValues: ['cobol'],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('cobol')).toBeInTheDocument()
    expect(await within(card).findByRole('alert')).toHaveTextContent(/cobol/i)
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    expect(await within(card).findByText('cobol')).toBeInTheDocument()
    expect(within(card).queryByText(/was cleared because/i)).not.toBeInTheDocument()
    const compatibility = await within(card).findByRole('alert')
    expect(compatibility).toHaveTextContent(/cobol/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()
  })

  it('does not clear a restored persisted unknown after discard across dependency changes', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['cobol'],
    }, {
      resolve(input) {
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [],
          unknownValues: ['cobol'],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('cobol')).toBeInTheDocument()
    await within(card).findByRole('alert')

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    expect(await within(card).findByText('cobol')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Discard changes' }))

    expect(within(card).getByRole('combobox', { name: 'Country' })).toHaveValue('US')
    expect(await within(card).findByText('cobol')).toBeInTheDocument()
    expect(within(card).queryByText(/was cleared because/i)).not.toBeInTheDocument()

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    expect(await within(card).findByText('cobol')).toBeInTheDocument()
    expect(within(card).queryByText(/was cleared because/i)).not.toBeInTheDocument()
    expect(await within(card).findByRole('alert')).toHaveTextContent(/cobol/i)
  })

  it('does not auto-clear any selection when only some many-values were verified in the prior context', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript', 'cobol'],
    }, {
      resolve(input) {
        if (input.body.dependencies.country === 'CA') {
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [],
            unknownValues: ['typescript', 'cobol'],
          }))
        }
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [{ key: 'typescript', label: 'TypeScript', value: 'typescript' }],
          unknownValues: ['cobol'],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('TypeScript')).toBeInTheDocument()
    expect(within(card).getByText('cobol')).toBeInTheDocument()
    expect(await within(card).findByRole('alert')).toHaveTextContent(/cobol/i)

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    expect(await within(card).findByText('TypeScript')).toBeInTheDocument()
    expect(within(card).getByText('cobol')).toBeInTheDocument()
    expect(within(card).queryByText(/was cleared because/i)).not.toBeInTheDocument()
    expect(await within(card).findByRole('alert')).toHaveTextContent(/unknown|unavailable|compatib/i)
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()
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
          if (caAttempts === 1) {
            return Promise.resolve({
              ...optionIdentityForFixture(),
              status: 'error',
              code: 'temporarily_unavailable',
              retryable: true,
              retryAfterMs: 25,
            })
          }
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [],
            unknownValues: ['denver-co'],
          }))
        }
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [{ key: 'denver-co', label: 'Denver, CO', value: 'denver-co' }],
          unknownValues: [],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(
      within(card).getByRole('button', { name: 'Save changes' }),
    ).toBeDisabled())

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    expect(await within(card).findByRole('alert')).toHaveTextContent(/unavailable|temporarily|retry/i)
    expect(within(card).getByText('Denver, CO')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: /retry/i }))

    const feedback = await within(card).findByRole('status')
    expect(feedback).toHaveTextContent(/denver|Denver/i)
    expect(feedback).toHaveTextContent(/cleared|removed|unavailable/i)
    expect(within(card).queryByText('Denver, CO')).not.toBeInTheDocument()
    await waitFor(() => expect(
      within(card).getByRole('button', { name: 'Save changes' }),
    ).toBeEnabled())
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps optional enum selects with defaults unset after clear and reload', async () => {
    const defaultsDescriptor = {
      ...fixtureDescriptor,
      filterSchema: {
        ...fixtureDescriptor.filterSchema,
        schema: {
          ...fixtureDescriptor.filterSchema.schema,
          properties: {
            ...fixtureDescriptor.filterSchema.schema.properties,
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
          },
        },
      },
    } satisfies InstalledConnectorDescriptor
    const connectorsApi = await createFixtureApi(
      { country: 'US', skills: [] },
      {},
      {},
      defaultsDescriptor,
    )
    const first = renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
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
    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      enabled: false,
    }))

    first.unmount()
    renderPanel(connectorsApi)
    const reloaded = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(within(reloaded).getByRole('combobox', { name: 'Employment kind' })).toHaveValue('')
    expect(within(reloaded).getByRole('combobox', { name: 'Days ago' })).toHaveValue('')
    expect(within(reloaded).getByRole('combobox', { name: 'Employment kind' }))
      .toHaveTextContent('Select…')
    expect(within(reloaded).getByRole('combobox', { name: 'Days ago' }))
      .toHaveTextContent('Select…')
  })

  it('keeps absent required enum fields on Select… until the default is chosen explicitly', async () => {
    const requiredDefaultsDescriptor = {
      ...fixtureDescriptor,
      filterSchema: {
        ...fixtureDescriptor.filterSchema,
        schema: {
          ...fixtureDescriptor.filterSchema.schema,
          required: ['employmentKind', 'daysAgo', 'country'],
          properties: {
            ...fixtureDescriptor.filterSchema.schema.properties,
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
          },
        },
      },
    } satisfies InstalledConnectorDescriptor
    const connectorsApi = await createFixtureApi(
      { skills: [] },
      {},
      {},
      requiredDefaultsDescriptor,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const employmentKind = within(card).getByRole('combobox', { name: 'Employment kind' })
    const daysAgo = within(card).getByRole('combobox', { name: 'Days ago' })
    const country = within(card).getByRole('combobox', { name: 'Country' })
    const save = within(card).getByRole('button', { name: 'Save changes' })

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
