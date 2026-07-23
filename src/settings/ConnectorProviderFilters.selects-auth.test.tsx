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

describe('connector select authorization and resolve accounting', () => {
  it('revokes clear authorization when identity changes after a retryable dependency transition', async () => {
    let caAttempts = 0
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (input.body.dependencies.country !== 'CA') {
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [{ key: 'denver-co', label: 'Denver, CO', value: 'denver-co' }],
            unknownValues: [],
          }))
        }
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
      },
    })
    const onChange = vi.fn()
    const onCompatibilityChange = vi.fn()
    const filters = { country: 'CA', skills: ['denver-co'] }
    const initialFilters = { country: 'US', skills: ['denver-co'] }
    const view = render(
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={fixtureDescriptor}
        disabled={false}
        filters={initialFilters}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    expect(await screen.findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(true))
    onChange.mockClear()

    view.rerender(
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
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable|temporarily|retry/i)
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()

    const identityBumpedDescriptor = {
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
        descriptor={identityBumpedDescriptor}
        disabled={false}
        filters={filters}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    await waitFor(() => expect(
      resolveInputs.some((input) => input.expectedIdentity.catalogVersion === 'fixture-provider-options@2'),
    ).toBe(true))
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Denver, CO' })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    const compatibility = await screen.findByRole('alert')
    expect(compatibility).toHaveTextContent(/denver|Denver/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('revokes clear authorization when dependency declarations change without filter value changes', async () => {
    let caAttempts = 0
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, {
      resolve(input) {
        if (input.body.dependencies.country !== 'CA') {
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [{ key: 'denver-co', label: 'Denver, CO', value: 'denver-co' }],
            unknownValues: [],
          }))
        }
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
      },
    })
    const onChange = vi.fn()
    const onCompatibilityChange = vi.fn()
    const view = render(
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={fixtureDescriptor}
        disabled={false}
        filters={{ country: 'US', skills: ['denver-co'] }}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    expect(await screen.findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(true))
    onChange.mockClear()

    view.rerender(
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={fixtureDescriptor}
        disabled={false}
        filters={{ country: 'CA', skills: ['denver-co'] }}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable|temporarily|retry/i)

    const declarationChangedDescriptor = {
      ...fixtureDescriptor,
      dynamicOptions: {
        ...fixtureDescriptor.dynamicOptions,
        sources: fixtureDescriptor.dynamicOptions.sources.map((source) => ({
          ...source,
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
        descriptor={declarationChangedDescriptor}
        disabled={false}
        filters={{ country: 'CA', skills: ['denver-co'] }}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    await waitFor(() => expect(onChange).not.toHaveBeenCalled())
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    const compatibility = await screen.findByRole('alert')
    expect(compatibility).toHaveTextContent(/denver|Denver/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
  })

  it('does not treat omitted selected values as verified during an incomplete dependency transition', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['alpha', 'beta'],
    }, {
      resolve(input) {
        if (input.body.dependencies.country === 'CA') {
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [],
            unknownValues: ['alpha'],
          }))
        }
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [
            { key: 'alpha', label: 'Alpha', value: 'alpha' },
            { key: 'beta', label: 'Beta', value: 'beta' },
          ],
          unknownValues: [],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('Alpha')).toBeInTheDocument()
    expect(within(card).getByText('Beta')).toBeInTheDocument()
    await waitFor(() => expect(
      within(card).getByRole('button', { name: 'Save changes' }),
    ).toBeDisabled())

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })
    expect(await within(card).findByText('Beta')).toBeInTheDocument()
    expect(within(card).getByText('Alpha')).toBeInTheDocument()
    expect(within(card).queryByText(/was cleared because/i)).not.toBeInTheDocument()
    const compatibility = await within(card).findByRole('alert')
    expect(compatibility).toHaveTextContent(/beta/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()
  })

  it('blocks save when a resolve_ready response accounts for none of the selected values', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['beta'],
    }, {
      resolve(input) {
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [],
          unknownValues: [],
        }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('beta')).toBeInTheDocument()
    const compatibility = await within(card).findByRole('alert')
    expect(compatibility).toHaveTextContent(/beta/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()
  })

  it('re-resolves after dependency declaration shape changes instead of reusing known verification', async () => {
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (resolveInputs.length === 1) {
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [{ key: 'typescript', label: 'TypeScript', value: 'typescript' }],
            unknownValues: [],
          }))
        }
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [],
          unknownValues: ['typescript'],
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

    const declarationOnlyDescriptor = {
      ...fixtureDescriptor,
      dynamicOptions: {
        ...fixtureDescriptor.dynamicOptions,
        sources: fixtureDescriptor.dynamicOptions.sources.map((source) => ({
          ...source,
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
        descriptor={declarationOnlyDescriptor}
        disabled={false}
        filters={filters}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    await waitFor(() => expect(resolveInputs.length).toBeGreaterThanOrEqual(2))
    expect(resolveInputs[1]?.body.dependencies).toEqual({ country: 'US' })
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    const compatibility = await screen.findByRole('alert')
    expect(compatibility).toHaveTextContent(/typescript/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('does not authorize clear when identity and dependency values change in one transition', async () => {
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (
          input.expectedIdentity.catalogVersion === 'fixture-provider-options@2'
          && input.body.dependencies.country === 'CA'
        ) {
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
    const onChange = vi.fn()
    const onCompatibilityChange = vi.fn()
    const view = render(
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={fixtureDescriptor}
        disabled={false}
        filters={{ country: 'US', skills: ['denver-co'] }}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    expect(await screen.findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(true))
    onChange.mockClear()

    const identityAndCountryDescriptor = {
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
        descriptor={identityAndCountryDescriptor}
        disabled={false}
        filters={{ country: 'CA', skills: ['denver-co'] }}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    await waitFor(() => expect(resolveInputs.some((input) =>
      input.expectedIdentity.catalogVersion === 'fixture-provider-options@2'
      && input.body.dependencies.country === 'CA')).toBe(true))
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    const compatibility = await screen.findByRole('alert')
    expect(compatibility).toHaveTextContent(/denver|Denver/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('does not authorize clear when declaration shape and dependency values change together', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, {
      resolve(input) {
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
    const onChange = vi.fn()
    const onCompatibilityChange = vi.fn()
    const view = render(
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={fixtureDescriptor}
        disabled={false}
        filters={{ country: 'US', skills: ['denver-co'] }}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    expect(await screen.findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(true))
    onChange.mockClear()

    const declarationAndCountryDescriptor = {
      ...fixtureDescriptor,
      dynamicOptions: {
        ...fixtureDescriptor.dynamicOptions,
        sources: fixtureDescriptor.dynamicOptions.sources.map((source) => ({
          ...source,
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
        descriptor={declarationAndCountryDescriptor}
        disabled={false}
        filters={{ country: 'CA', skills: ['denver-co'] }}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    expect(await screen.findByText('Denver, CO')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    const compatibility = await screen.findByRole('alert')
    expect(compatibility).toHaveTextContent(/denver|Denver/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('does not clear a manually added many-value after an authorized dependency transition', async () => {
    const caBySelection = new Map<string, ReturnType<typeof deferred<ConnectorOptionQueryResult>>>()
    const resolveInputs: PublicOptionQueryInput[] = []
    function selectionKey(values: unknown[]) {
      return [...values].map(String).sort().join(',')
    }
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['alpha'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        if (input.body.dependencies.country !== 'CA') {
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [{ key: 'alpha', label: 'Alpha', value: 'alpha' }],
            unknownValues: [],
          }))
        }
        const values = input.body.operation.kind === 'resolve' ? input.body.operation.values : []
        const key = selectionKey(values)
        let pending = caBySelection.get(key)
        if (!pending) {
          pending = deferred<ConnectorOptionQueryResult>()
          caBySelection.set(key, pending)
        }
        return pending.promise
      },
    })
    const onChange = vi.fn()
    const onCompatibilityChange = vi.fn()
    let filters: Record<string, unknown> = { country: 'US', skills: ['alpha'] }
    const renderFilters = () => (
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={fixtureDescriptor}
        disabled={false}
        filters={filters}
        instanceId={INSTANCE_ID}
        onChange={(next) => {
          onChange(next)
          filters = next
        }}
        onCompatibilityChange={onCompatibilityChange}
      />
    )
    const view = render(renderFilters())

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(true))
    onChange.mockClear()

    filters = { country: 'CA', skills: ['alpha'] }
    view.rerender(renderFilters())
    await waitFor(() => expect(caBySelection.has('alpha')).toBe(true))

    filters = { country: 'CA', skills: ['alpha', 'beta'] }
    view.rerender(renderFilters())
    await waitFor(() => expect(caBySelection.has('alpha,beta')).toBe(true))

    caBySelection.get('alpha')!.resolve(boundOptionResult(resolveInputs[1]!, {
      status: 'resolve_ready',
      options: [],
      unknownValues: ['alpha'],
    }))
    caBySelection.get('alpha,beta')!.resolve(boundOptionResult(
      resolveInputs.find((input) =>
        input.body.operation.kind === 'resolve'
        && input.body.operation.values.includes('beta'))!,
      {
        status: 'resolve_ready',
        options: [],
        unknownValues: ['alpha', 'beta'],
      },
    ))

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    const compatibility = await screen.findByRole('alert')
    expect(compatibility).toHaveTextContent(/beta/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('does not clear a replaced cardinality-one value after an authorized dependency transition', async () => {
    const oneSkillDescriptor = {
      ...fixtureDescriptor,
      filterSchema: {
        ...fixtureDescriptor.filterSchema,
        schema: {
          ...fixtureDescriptor.filterSchema.schema,
          properties: {
            ...fixtureDescriptor.filterSchema.schema.properties,
            skills: {
              type: 'string' as const,
              minLength: 1,
              maxLength: 100,
            },
          },
        },
      },
      dynamicOptions: {
        ...fixtureDescriptor.dynamicOptions,
        bindings: fixtureDescriptor.dynamicOptions.bindings.map((binding) =>
          binding.filterPointer === '/skills'
            ? { ...binding, cardinality: 'one' as const }
            : binding),
      },
    } satisfies InstalledConnectorDescriptor
    let caAttempts = 0
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: 'alpha',
    }, {
      resolve(input) {
        if (input.body.dependencies.country !== 'CA') {
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [{ key: 'alpha', label: 'Alpha', value: 'alpha' }],
            unknownValues: [],
          }))
        }
        caAttempts += 1
        if (caAttempts === 1) {
          return Promise.resolve({
            ...optionIdentityForFixture(),
            status: 'auth_required',
          })
        }
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [],
          unknownValues: ['beta'],
        }))
      },
    }, {}, oneSkillDescriptor)
    const onChange = vi.fn()
    const onCompatibilityChange = vi.fn()
    let filters: Record<string, unknown> = { country: 'US', skills: 'alpha' }
    const renderFilters = () => (
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={oneSkillDescriptor}
        disabled={false}
        filters={filters}
        instanceId={INSTANCE_ID}
        onChange={(next) => {
          onChange(next)
          filters = next
        }}
        onCompatibilityChange={onCompatibilityChange}
      />
    )
    const view = render(renderFilters())

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(true))
    onChange.mockClear()

    filters = { country: 'CA', skills: 'alpha' }
    view.rerender(renderFilters())
    expect(await screen.findByRole('alert')).toHaveTextContent(/authentication|auth/i)
    expect(screen.getByText('Alpha')).toBeInTheDocument()

    filters = { country: 'CA', skills: 'beta' }
    view.rerender(renderFilters())

    expect(await screen.findByText('beta')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    const compatibility = await screen.findByRole('alert')
    expect(compatibility).toHaveTextContent(/beta/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('still clears the exact unchanged selection after same-scope retry', async () => {
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
    fireEvent.click(within(card).getByRole('button', { name: /retry/i }))

    const feedback = await within(card).findByRole('status')
    expect(feedback).toHaveTextContent(/denver|Denver/i)
    expect(feedback).toHaveTextContent(/cleared|removed|unavailable/i)
    expect(within(card).queryByText('Denver, CO')).not.toBeInTheDocument()
    await waitFor(() => expect(
      within(card).getByRole('button', { name: 'Save changes' }),
    ).toBeEnabled())
  })

  it('renders human provider labels in dependency-clear feedback for object-valued selections', async () => {
    const denver = {
      type: 'city',
      city: 'Denver',
      state: 'CO',
      radiusRange: 25,
    }
    const seattle = {
      type: 'city',
      city: 'Seattle',
      state: 'WA',
      radiusRange: 25,
    }
    const locationSkillsDescriptor = {
      ...fixtureDescriptor,
      filterSchema: {
        ...fixtureDescriptor.filterSchema,
        schema: {
          ...fixtureDescriptor.filterSchema.schema,
          properties: {
            ...fixtureDescriptor.filterSchema.schema.properties,
            skills: {
              type: 'array' as const,
              maxItems: 10,
              uniqueItems: true,
              items: {
                type: 'object' as const,
                additionalProperties: false,
                required: ['type', 'city', 'state', 'radiusRange'],
                properties: {
                  type: { type: 'string' as const },
                  city: { type: 'string' as const },
                  state: { type: 'string' as const },
                  radiusRange: { type: 'number' as const },
                },
              },
            },
          },
        },
      },
    } satisfies InstalledConnectorDescriptor
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: [denver, seattle],
    }, {
      resolve(input) {
        if (input.body.dependencies.country === 'CA') {
          return Promise.resolve(boundOptionResult(input, {
            status: 'resolve_ready',
            options: [],
            unknownValues: [denver, seattle],
          }))
        }
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [
            { key: 'denver-co', label: 'Denver, CO', value: denver },
            { key: 'seattle-wa', label: 'Seattle, WA', value: seattle },
          ],
          unknownValues: [],
        }))
      },
    }, {}, locationSkillsDescriptor)
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    expect(within(card).getByText('Seattle, WA')).toBeInTheDocument()
    await waitFor(() => expect(
      within(card).getByRole('button', { name: 'Save changes' }),
    ).toBeDisabled())

    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })

    const feedback = await within(card).findByRole('status')
    expect(feedback).toHaveTextContent('Denver, CO')
    expect(feedback).toHaveTextContent('Seattle, WA')
    expect(feedback).toHaveTextContent(/were cleared|was cleared/i)
    expect(feedback).toHaveTextContent(/unavailable with the current filter dependencies/i)
    expect(feedback.textContent ?? '').not.toMatch(/[{}"]|radiusRange/)
    expect(feedback.textContent ?? '').not.toContain('"type"')
    expect(feedback.textContent ?? '').not.toContain('"city"')
    expect(feedback.textContent ?? '').not.toContain('"state"')
    expect(feedback.className).toMatch(/break-words/)
    expect(within(card).queryByRole('button', { name: 'Remove Denver, CO' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Remove Seattle, WA' })).not.toBeInTheDocument()
  })
})
