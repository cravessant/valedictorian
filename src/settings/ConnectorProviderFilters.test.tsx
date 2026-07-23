import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  missingPresentationDescriptor,
  optionIdentityForFixture,
  type PublicOptionQueryInput,
  renderPanel,
  searchResult,
} from './ConnectorProviderFilters.test-helpers'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('declarative connector provider filters', () => {
  it('renders every fixture field from its schema and round-trips exact values on save and reload', async () => {
    const connectorsApi = await createFixtureApi({
      employmentKind: 'internship',
      remoteOnly: false,
      minimumSalary: 60_000,
      compensationRange: [70_000, 120_000],
      keyword: 'platform',
      postedAfter: '2026-07-01',
      workModels: ['remote'],
      country: 'US',
      skills: ['typescript'],
      excludedSkills: ['php'],
    })
    const first = renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(within(card).getByRole('heading', { name: 'Provider filters' })).toBeInTheDocument()
    expect(within(card).getByLabelText('Employment kind')).toHaveValue('internship')
    expect(within(card).getByRole('switch', { name: 'Remote only' })).not.toBeChecked()
    expect(within(card).getByRole('spinbutton', { name: 'Minimum salary' })).toHaveValue(60_000)
    expect(within(card).getByRole('spinbutton', { name: 'Minimum compensation' })).toHaveValue(70_000)
    expect(within(card).getByRole('spinbutton', { name: 'Maximum compensation' })).toHaveValue(120_000)
    expect(within(card).getByRole('textbox', { name: 'Keyword' })).toHaveValue('platform')
    expect(within(card).queryByLabelText('Unsupported provider object')).not.toBeInTheDocument()
    expect(within(card).getByLabelText('Posted after')).toHaveAttribute('type', 'date')
    expect(within(card).getByLabelText('Posted after')).toHaveValue('2026-07-01')
    expect(within(card).getByRole('checkbox', { name: 'Remote' })).toBeChecked()
    expect(within(card).getByRole('checkbox', { name: 'Hybrid' })).not.toBeChecked()
    expect(within(card).getByRole('combobox', { name: 'Include Skills' })).toBeInTheDocument()
    expect(within(card).getByRole('combobox', { name: 'Exclude skills' })).toBeInTheDocument()
    expect(await within(card).findByText('TypeScript')).toBeInTheDocument()
    expect(await within(card).findByText('PHP')).toBeInTheDocument()
    for (const legacyName of [
      ['role', 'Terms'].join(''),
      ['max', 'ResolutionCount'].join(''),
    ]) {
      expect(card).not.toHaveTextContent(legacyName)
    }

    fireEvent.change(within(card).getByLabelText('Employment kind'), {
      target: { value: 'full_time' },
    })
    fireEvent.click(within(card).getByRole('switch', { name: 'Remote only' }))
    fireEvent.change(within(card).getByRole('spinbutton', { name: 'Minimum salary' }), {
      target: { value: '80000' },
    })
    fireEvent.change(within(card).getByRole('spinbutton', { name: 'Minimum compensation' }), {
      target: { value: '90000' },
    })
    fireEvent.change(within(card).getByRole('spinbutton', { name: 'Maximum compensation' }), {
      target: { value: '150000' },
    })
    const keyword = within(card).getByRole('textbox', { name: 'Keyword' })
    fireEvent.change(keyword, { target: { value: 'x' } })
    expect(within(card).getByRole('button', { name: 'Save changes' })).toBeDisabled()
    fireEvent.change(keyword, { target: { value: 'infrastructure' } })
    fireEvent.change(within(card).getByLabelText('Posted after'), {
      target: { value: '2026-07-07' },
    })
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Hybrid' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }))

    const expectedFilters = {
      employmentKind: 'full_time',
      remoteOnly: true,
      minimumSalary: 80_000,
      compensationRange: [90_000, 150_000],
      keyword: 'infrastructure',
      postedAfter: '2026-07-07',
      workModels: ['remote', 'hybrid'],
      country: 'US',
      skills: ['typescript'],
      excludedSkills: ['php'],
    }
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      enabled: true,
      filters: expectedFilters,
    }))

    first.unmount()
    renderPanel(connectorsApi)
    const reloaded = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(within(reloaded).getByLabelText('Employment kind')).toHaveValue('full_time')
    expect(within(reloaded).getByRole('switch', { name: 'Remote only' })).toBeChecked()
    expect(within(reloaded).getByRole('spinbutton', { name: 'Minimum salary' })).toHaveValue(80_000)
    expect(within(reloaded).getByRole('spinbutton', { name: 'Minimum compensation' })).toHaveValue(90_000)
    expect(within(reloaded).getByRole('spinbutton', { name: 'Maximum compensation' })).toHaveValue(150_000)
    expect(within(reloaded).getByRole('textbox', { name: 'Keyword' })).toHaveValue('infrastructure')
    expect(within(reloaded).getByLabelText('Posted after')).toHaveValue('2026-07-07')
    expect(within(reloaded).getByRole('checkbox', { name: 'Hybrid' })).toBeChecked()
    expect(await within(reloaded).findByText('TypeScript')).toBeInTheDocument()
    expect(await within(reloaded).findByText('PHP')).toBeInTheDocument()
  })

  it('explains that provider filters own sourcing while candidate-fit remains downstream', async () => {
    const connectorsApi = await createFixtureApi({ country: 'US', skills: [] })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const providerFilters = within(card).getByRole('heading', { name: 'Provider filters' })
      .closest('section')!
    expect(providerFilters).toHaveTextContent(/sourcing/i)
    expect(providerFilters).toHaveTextContent(/candidate.?fit/i)
    expect(providerFilters).toHaveTextContent(/downstream|separate/i)
  })

  it('cancels a stale dynamic search and never presents its late provider result', async () => {
    const firstSearch = deferred<ConnectorOptionQueryResult>()
    const secondSearch = deferred<ConnectorOptionQueryResult>()
    const searchSignals: AbortSignal[] = []
    const connectorsApi = await createFixtureApi({ country: 'US', skills: [] }, {
      search(input, signal) {
        if (signal) searchSignals.push(signal)
        const search = input.body.operation.kind === 'search'
          ? input.body.operation.search
          : ''
        return search === 'rea' ? firstSearch.promise : secondSearch.promise
      },
    })
    renderPanel(connectorsApi)

    const skills = await screen.findByRole('combobox', { name: 'Include Skills' })
    fireEvent.change(skills, { target: { value: 'rea' } })
    expect(searchSignals).toHaveLength(0)
    await waitFor(() => expect(searchSignals).toHaveLength(1))
    fireEvent.change(skills, { target: { value: 'react' } })
    expect(searchSignals).toHaveLength(1)
    await waitFor(() => expect(searchSignals).toHaveLength(2))
    expect(searchSignals[0].aborted).toBe(true)

    secondSearch.resolve(searchResult('react', 'React'))
    expect(await screen.findByRole('option', { name: 'React' })).toBeInTheDocument()
    firstSearch.resolve(searchResult('reason', 'ReasonML'))
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'ReasonML' })).not.toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'React' })).toBeInTheDocument()
    })
  })

  it('invalidates an in-flight search when a declared dependency changes and never renders its stale result', async () => {
    const staleSearch = deferred<ConnectorOptionQueryResult>()
    const searchSignals: AbortSignal[] = []
    const connectorsApi = await createFixtureApi({ country: 'US', skills: [] }, {
      search(input, signal) {
        if (signal) searchSignals.push(signal)
        return input.body.dependencies.country === 'US'
          ? staleSearch.promise
          : Promise.resolve(searchResult('rust', 'Rust'))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const skills = within(card).getByRole('combobox', { name: 'Include Skills' })
    fireEvent.change(skills, { target: { value: 'rea' } })
    await waitFor(() => expect(searchSignals).toHaveLength(1))
    fireEvent.change(within(card).getByRole('combobox', { name: 'Country' }), {
      target: { value: 'CA' },
    })

    await waitFor(() => expect(searchSignals[0]?.aborted).toBe(true))
    staleSearch.resolve(searchResult('reason', 'ReasonML'))
    await waitFor(() => expect(
      screen.queryByRole('option', { name: 'ReasonML' }),
    ).not.toBeInTheDocument())
  })

  it('invalidates a debounced search when its descriptor source identity changes', async () => {
    const connectorsApi = await createFixtureApi({ country: 'US', skills: [] })
    const onChange = vi.fn()
    const onCompatibilityChange = vi.fn()
    const view = render(
      <ConnectorProviderFilters
        api={connectorsApi.options}
        allowMissingRootRequired={false}
        descriptor={fixtureDescriptor}
        disabled={false}
        filters={{ country: 'US', skills: [] }}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Include Skills' }), {
      target: { value: 'rea' },
    })
    const changedDescriptor = {
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
        descriptor={changedDescriptor}
        disabled={false}
        filters={{ country: 'US', skills: [] }}
        instanceId={INSTANCE_ID}
        onChange={onChange}
        onCompatibilityChange={onCompatibilityChange}
      />,
    )

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(connectorsApi.options.query).not.toHaveBeenCalled()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('rejects searches longer than the declared client limit without querying the provider', async () => {
    const connectorsApi = await createFixtureApi({ country: 'US', skills: [] })
    renderPanel(connectorsApi)

    const skills = await screen.findByRole('combobox', { name: 'Include Skills' })
    fireEvent.change(skills, { target: { value: 'x'.repeat(101) } })

    expect(await screen.findByRole('status')).toHaveTextContent(/100|too long|at most/i)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(connectorsApi.options.query).not.toHaveBeenCalled()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('keeps an unknown persisted dynamic value visible, explains incompatibility, and blocks save', async () => {
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
    expect(within(card).getByText('cobol')).toBeInTheDocument()
    const compatibility = await within(card).findByRole('alert')
    expect(compatibility).toHaveTextContent(/cobol/i)
    expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
    const save = within(card).getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('keeps save blocked while persisted dynamic values are still being resolved', async () => {
    const resolution = deferred<ConnectorOptionQueryResult>()
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript'],
    }, {
      resolve: () => resolution.promise,
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    await waitFor(() => expect(connectorsApi.options.query).toHaveBeenCalled())
    expect(within(card).getByText('typescript')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()

    resolution.resolve({
      ...optionIdentityForFixture(),
      status: 'resolve_ready',
      options: [{ key: 'typescript', label: 'TypeScript', value: 'typescript' }],
      unknownValues: [],
    })
    await waitFor(() => {
      expect(within(card).getByRole('button', { name: 'Save changes' }))
        .toBeDisabled()
    })
    fireEvent.click(within(card).getByRole('switch', { name: 'Remote only' }))
    expect(within(card).getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it.each([
    {
      name: 'authentication-required',
      result: { ...optionIdentityForFixture(), status: 'auth_required' as const },
      message: /authentication.*required/i,
      retry: false,
    },
    {
      name: 'retryable provider failure',
      result: {
        ...optionIdentityForFixture(),
        status: 'error' as const,
        code: 'temporarily_unavailable' as const,
        retryable: true as const,
        retryAfterMs: 25,
      },
      message: /temporarily unavailable|try again/i,
      retry: true,
    },
  ])('keeps persisted values and save safety when resolve reports $name', async ({
    result,
    message,
    retry,
  }) => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript'],
    }, {
      resolve: () => Promise.resolve(result),
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(within(card).getByText('typescript')).toBeInTheDocument()
    const compatibility = await within(card).findByRole('alert')
    expect(compatibility).toHaveTextContent(message)
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()
    if (retry) expect(within(card).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('shows a compatibility error and blocks save when a dynamic binding names no declared source', async () => {
    const mismatchedDescriptor = {
      ...fixtureDescriptor,
      dynamicOptions: {
        ...fixtureDescriptor.dynamicOptions,
        bindings: fixtureDescriptor.dynamicOptions.bindings.map((binding) =>
          binding.filterPointer === '/skills'
            ? { ...binding, sourceId: 'fixture.missing-source' }
            : binding),
      },
    } as InstalledConnectorDescriptor
    const connectorsApi = await createFixtureApi(
      { country: 'US', skills: ['typescript'] },
      {},
      {},
      mismatchedDescriptor,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const compatibility = await within(card).findByRole('alert')
    expect(compatibility).toHaveTextContent(/binding|source|declaration|compatib/i)
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('blocks persisted dynamic values that have no declared resolve operation', async () => {
    const descriptorWithoutResolve = {
      ...fixtureDescriptor,
      dynamicOptions: {
        ...fixtureDescriptor.dynamicOptions,
        sources: fixtureDescriptor.dynamicOptions.sources.map((source) => ({
          ...source,
          operations: { search: source.operations.search },
        })),
      },
    } as InstalledConnectorDescriptor
    const connectorsApi = await createFixtureApi(
      { country: 'US', skills: ['typescript'] },
      {},
      {},
      descriptorWithoutResolve,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(within(card).getByText('typescript')).toBeInTheDocument()
    expect(await within(card).findByRole('alert')).toHaveTextContent(/resolve|verify|compatib/i)
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()
  })

  it('blocks persisted dynamic values while a required declared dependency is missing', async () => {
    const connectorsApi = await createFixtureApi({ skills: ['typescript'] })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(within(card).getByText('typescript')).toBeInTheDocument()
    expect(within(card).getAllByText(/complete the dependent filters first/i).length).toBeGreaterThan(0)
    expect(await within(card).findByRole('alert')).toHaveTextContent(/depend|require|compatib/i)
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()
  })

  it('retries auth-blocked persisted-value resolution without discarding or reselecting the value', async () => {
    let attempt = 0
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript'],
    }, {
      resolve(input) {
        attempt += 1
        return Promise.resolve(attempt === 1
          ? { ...optionIdentityForFixture(), status: 'auth_required' }
          : boundOptionResult(input, {
              status: 'resolve_ready',
              options: [{ key: 'typescript', label: 'TypeScript', value: 'typescript' }],
              unknownValues: [],
            }))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(card).findByRole('alert')).toHaveTextContent(/authentication.*required/i)
    expect(within(card).getByText('typescript')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: /retry|check again|reconnect/i }))

    await waitFor(() => expect(attempt).toBe(2))
    await waitFor(() => expect(within(card).queryByRole('alert')).not.toBeInTheDocument())
    expect(within(card).getByText('TypeScript')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('switch', { name: 'Remote only' }))
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeEnabled()
  })

  it('closes permissive connector config schemas at the UI persistence boundary', async () => {
    const permissiveConfigDescriptor = {
      ...fixtureDescriptor,
      configSchema: {
        ...fixtureDescriptor.configSchema,
        schema: { ...fixtureDescriptor.configSchema.schema, additionalProperties: true },
      },
    } as InstalledConnectorDescriptor
    const connectorsApi = await createFixtureApi(
      { country: 'US', skills: [] },
      {},
      { discoveryLimit: 10, privateProviderConfig: 'must-not-be-saved' },
      permissiveConfigDescriptor,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const compatibility = await within(card).findByRole('alert')
    expect(compatibility).toHaveTextContent(/private provider config|not declared|compatib/i)
    expect(within(card).getByRole('button', { name: 'Save changes' }))
      .toBeDisabled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('shows loading, empty, and authentication-required option states', async () => {
    const pending = deferred<ConnectorOptionQueryResult>()
    const connectorsApi = await createFixtureApi({ country: 'US', skills: [] }, {
      search: () => pending.promise,
    })
    const first = renderPanel(connectorsApi)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Include Skills' }), {
      target: { value: 'rea' },
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/searching/i)
    pending.resolve({ ...optionIdentityForFixture(), status: 'search_empty' })
    expect(await screen.findByRole('status')).toHaveTextContent(/no matching/i)
    first.unmount()

    const authApi = await createFixtureApi({ country: 'US', skills: [] }, {
      search: () => Promise.resolve({
        ...optionIdentityForFixture(),
        status: 'auth_required',
      }),
    })
    renderPanel(authApi)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Include Skills' }), {
      target: { value: 'rea' },
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/authentication.*required/i)
  })

  it('offers Retry for retryable option failures and succeeds without changing the search', async () => {
    let attempt = 0
    const connectorsApi = await createFixtureApi({ country: 'US', skills: [] }, {
      search: () => Promise.resolve(attempt++ === 0
        ? {
            ...optionIdentityForFixture(),
            status: 'error',
            code: 'temporarily_unavailable',
            retryable: true,
            retryAfterMs: 25,
          }
        : searchResult('react', 'React')),
    })
    renderPanel(connectorsApi)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Include Skills' }), {
      target: { value: 'rea' },
    })
    const retry = await screen.findByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    expect(await screen.findByRole('option', { name: 'React' })).toBeInTheDocument()
  })

  it('distinguishes a terminal provider rejection and does not offer Retry', async () => {
    const connectorsApi = await createFixtureApi({ country: 'US', skills: [] }, {
      search: () => Promise.resolve({
        ...optionIdentityForFixture(),
        status: 'error',
        code: 'provider_rejected',
        retryable: false,
      }),
    })
    renderPanel(connectorsApi)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Include Skills' }), {
      target: { value: 'rea' },
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/rejected|cannot be retried/i)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('renders numeric enums as bounded choices and supports unique keyboard-operated comboboxes', async () => {
    const connectorsApi = await createFixtureApi({ country: 'US', daysAgo: 7, skills: [] }, {
      search(input) {
        const search = input.body.operation.kind === 'search' ? input.body.operation.search : ''
        return Promise.resolve(searchResult(search, 'React'))
      },
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const daysAgo = within(card).getByRole('combobox', { name: 'Days ago' })
    expect(daysAgo).toHaveValue('7')
    expect(within(card).queryByRole('spinbutton', { name: 'Days ago' })).not.toBeInTheDocument()

    const include = within(card).getByRole('combobox', { name: 'Include Skills' })
    const exclude = within(card).getByRole('combobox', { name: 'Exclude skills' })
    expect(include).toHaveAttribute('aria-autocomplete', 'list')
    expect(include).toHaveAttribute('aria-controls')
    expect(exclude).toHaveAttribute('aria-controls')
    expect(include.getAttribute('aria-controls')).not.toBe(exclude.getAttribute('aria-controls'))

    fireEvent.change(include, { target: { value: 'rea' } })
    const option = await screen.findByRole('option', { name: 'React' })
    expect(option).toHaveAttribute('tabindex', '-1')
    expect(option.parentElement).toHaveAttribute('id', include.getAttribute('aria-controls'))
    include.focus(); fireEvent.keyDown(include, { key: 'ArrowDown' })
    expect(include).toHaveAttribute('aria-activedescendant', option.id)
    expect(document.activeElement).toBe(include)
    fireEvent.keyDown(include, { key: 'Enter' })
    expect(await within(card).findByRole('button', { name: 'Remove React' })).toBeInTheDocument()
    expect(document.activeElement).toBe(include)
    fireEvent.click(within(card).getByRole('button', { name: 'Remove React' })); fireEvent.change(include, { target: { value: 'rea' } })
    const reopenedOption = await screen.findByRole('option', { name: 'React' })
    include.focus(); fireEvent.keyDown(include, { key: 'ArrowDown' })
    expect(include).toHaveAttribute('aria-activedescendant', reopenedOption.id)
    await userEvent.tab()
    expect(document.activeElement).not.toBe(include); expect(document.activeElement).not.toBe(reopenedOption)
    expect(screen.queryByRole('option', { name: 'React' })).not.toBeInTheDocument()
    expect(include).not.toHaveAttribute('aria-activedescendant')
    include.focus(); fireEvent.keyDown(include, { key: 'Enter' })
    const staleSelection = within(card).queryByRole('button', { name: 'Remove React' })
    expect.soft(staleSelection).not.toBeInTheDocument()
    if (staleSelection) fireEvent.click(staleSelection)
    const completedSearchCount = connectorsApi.options.query.mock.calls.length
    fireEvent.change(include, { target: { value: 'react' } })
    await userEvent.tab(); await new Promise((resolve) => setTimeout(resolve, 200))
    expect.soft(connectorsApi.options.query).toHaveBeenCalledTimes(completedSearchCount)
    expect.soft(screen.queryByRole('option')).not.toBeInTheDocument()
    include.focus(); fireEvent.change(include, { target: { value: 'rea' } })
    await screen.findByRole('option', { name: 'React' })
    fireEvent.keyDown(include, { key: 'Escape' }); expect(screen.queryByRole('option', { name: 'React' })).not.toBeInTheDocument()
  })

  it('rejects inverted fixed numeric ranges and preserves an empty endpoint instead of coercing it to zero', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      compensationRange: [70_000, 120_000],
      skills: [],
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const minimum = within(card).getByRole('spinbutton', { name: 'Minimum compensation' })
    const maximum = within(card).getByRole('spinbutton', { name: 'Maximum compensation' })
    const save = within(card).getByRole('button', { name: 'Save changes' })

    fireEvent.change(minimum, { target: { value: '150000' } })
    expect(await within(card).findByRole('alert')).toHaveTextContent(/range|minimum|maximum|endpoint/i)
    expect(save).toBeDisabled()

    fireEvent.change(maximum, { target: { value: '' } })
    expect(maximum).toHaveValue(null)
    expect(maximum).not.toHaveValue(0)
    expect(within(card).getByRole('alert')).toHaveTextContent(/required|range|endpoint|maximum/i)
    expect(save).toBeDisabled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('blocks any settings save when the persisted descriptor is unavailable', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['typescript'],
    })
    vi.mocked(connectorsApi.descriptors.list).mockResolvedValueOnce({ items: [] })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    fireEvent.click(within(card).getByRole('switch', { name: 'Enabled' }))
    const compatibility = within(card).getByRole('alert')
    expect(compatibility).toHaveTextContent(/descriptor|compatib/i)
    const save = within(card).getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('renders declared config separately from provider filters and round-trips its exact value', async () => {
    const connectorsApi = await createFixtureApi(
      { country: 'US', skills: [] },
      {},
      { discoveryLimit: 10 },
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const configuration = within(card).getByRole('heading', { name: 'Synchronization configuration' })
    const configurationSection = configuration.closest('section')!
    const providerFilters = within(card).getByRole('heading', { name: 'Provider filters' }).closest('section')!
    const control = within(configurationSection).getByRole('combobox', { name: 'Discovery limit' })
    expect(control).toHaveValue('10')
    expect(within(providerFilters).queryByLabelText('Discovery limit')).not.toBeInTheDocument()

    fireEvent.change(control, { target: { value: '20' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      enabled: true,
      config: { discoveryLimit: 20 },
      filters: { country: 'US', skills: [] },
    }))
  })

  it('reports incompatible persisted values and prevents a destructive save', async () => {
    const connectorsApi = await createFixtureApi({
      employmentKind: 'contractor',
      skills: [],
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const compatibility = within(card).getByRole('alert')
    expect(compatibility).toHaveTextContent(/compatib/i)
    expect(compatibility).toHaveTextContent(/employmentKind|employment kind/i)
    expect(compatibility).toHaveTextContent(/contractor/i)
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('can safely disable an incompatible persisted instance without resubmitting unchanged settings', async () => {
    const connectorsApi = await createFixtureApi({
      employmentKind: 'contractor',
      skills: [],
    }, {}, { privateProviderConfig: 'legacy' })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(within(card).getByRole('alert')).toHaveTextContent(/compatib/i)
    fireEvent.click(within(card).getByRole('switch', { name: 'Enabled' }))
    const save = within(card).getByRole('button', { name: 'Save changes' })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      enabled: false,
    }))
  })

  it('falls back to the installed same-id descriptor for an old instance and saves an explicit version upgrade', async () => {
    const currentDescriptor = {
      ...fixtureDescriptor,
      connectorVersion: '0.13.0',
      filterSchema: {
        ...fixtureDescriptor.filterSchema,
        schema: {
          ...fixtureDescriptor.filterSchema.schema,
          required: ['country'],
        },
      },
    } satisfies InstalledConnectorDescriptor
    const connectorsApi = await createFixtureApi({}, {}, {}, currentDescriptor, '0.12.0')
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const country = within(card).getByRole('combobox', { name: 'Country' })
    fireEvent.change(country, { target: { value: 'CA' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      connectorVersion: '0.13.0',
      enabled: true,
      filters: { country: 'CA' },
    }))
  })

  it('repairs an old instance through the current required dynamic option and reloads exact upgraded values', async () => {
    const currentDescriptor = {
      ...fixtureDescriptor,
      connectorVersion: '0.13.0',
      filterSchema: {
        ...fixtureDescriptor.filterSchema,
        schema: {
          ...fixtureDescriptor.filterSchema.schema,
          required: ['skills'],
        },
      },
      dynamicOptions: {
        ...fixtureDescriptor.dynamicOptions,
        sources: fixtureDescriptor.dynamicOptions.sources.map((source) => ({
          ...source,
          dependencies: [],
        })),
      },
    } satisfies InstalledConnectorDescriptor
    const searchInputs: PublicOptionQueryInput[] = []
    const resolveInputs: PublicOptionQueryInput[] = []
    const connectorsApi = await createFixtureApi({}, {
      search(input) {
        searchInputs.push(input)
        return Promise.resolve({
          connectorInstanceId: input.connectorInstanceId,
          ...input.expectedIdentity,
          sourceId: input.body.sourceId,
          status: 'search_ready',
          options: [{ key: 'react', label: 'React', value: 'react' }],
          truncated: false,
        })
      },
      resolve(input) {
        resolveInputs.push(input)
        return Promise.resolve(boundOptionResult(input, {
          status: 'resolve_ready',
          options: [{ key: 'react', label: 'React', value: 'react' }],
          unknownValues: [],
        }))
      },
    }, {}, currentDescriptor, '0.12.0')
    const first = renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const skills = within(card).getByRole('combobox', { name: 'Include Skills' })
    fireEvent.change(skills, { target: { value: 'rea' } })
    fireEvent.click(await screen.findByRole('option', { name: 'React' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      connectorVersion: '0.13.0',
      enabled: true,
      filters: { skills: ['react'] },
    }))
    expect(searchInputs).toEqual([
      expect.objectContaining({
        connectorInstanceId: INSTANCE_ID,
        expectedIdentity: expect.objectContaining({ connectorVersion: '0.13.0' }),
      }),
    ])

    first.unmount()
    renderPanel(connectorsApi)
    const reloaded = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(await within(reloaded).findByText('React')).toBeInTheDocument()
    await waitFor(() => expect(resolveInputs).toEqual([
      expect.objectContaining({
        connectorInstanceId: INSTANCE_ID,
        expectedIdentity: expect.objectContaining({ connectorVersion: '0.13.0' }),
        body: expect.objectContaining({
          sourceId: 'fixture.skills',
          operation: { kind: 'resolve', values: ['react'] },
        }),
      }),
    ]))
    await expect(connectorsApi.list()).resolves.toMatchObject({
      items: [{ connectorVersion: '0.13.0', filters: { skills: ['react'] } }],
    })
  })

  it('prefers an exact-version descriptor over a newer same-id fallback', async () => {
    const oldDescriptor = {
      ...fixtureDescriptor,
      connectorVersion: '0.12.0',
      filterSchema: {
        version: 'fixture-provider-filters@0.12',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            legacyKeyword: { type: 'string', minLength: 1 },
          },
        },
        presentation: {
          fields: {
            '/legacyKeyword': {
              label: 'Legacy keyword',
              description: 'Legacy free-text keyword retained for older instances.',
            },
          },
        },
      },
      dynamicOptions: undefined,
    } satisfies InstalledConnectorDescriptor
    const currentDescriptor = {
      ...fixtureDescriptor,
      connectorVersion: '0.13.0',
    } satisfies InstalledConnectorDescriptor
    const connectorsApi = await createFixtureApi({}, {}, {}, currentDescriptor, '0.12.0')
    vi.mocked(connectorsApi.descriptors.list).mockResolvedValueOnce({
      items: [currentDescriptor, oldDescriptor],
    })
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    expect(within(card).getByRole('textbox', { name: 'Legacy keyword' })).toBeInTheDocument()
    expect(within(card).queryByRole('combobox', { name: 'Country' })).not.toBeInTheDocument()
  })

  it('renders presentation option labels and duration minutes while saving exact provider values', async () => {
    const connectorsApi = await createFixtureApi(
      {
        country: 'US',
        workModels: ['remote'],
        skills: [],
      },
      {},
      { maxRunElapsedMs: 120_000 },
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const country = within(card).getByRole('combobox', { name: 'Country' })
    expect(country).toHaveTextContent('United States')
    expect(country).toHaveTextContent('Canada')
    expect(within(card).getByRole('checkbox', { name: 'Remote' })).toBeChecked()
    expect(within(card).getByRole('checkbox', { name: 'Hybrid' })).toBeInTheDocument()

    const remoteOnly = within(card).getByRole('switch', { name: 'Remote only' })
    expect(remoteOnly).toHaveAccessibleDescription(/remote roles/i)
    expect(within(card).getByRole('combobox', { name: 'Include Skills' }))
      .toHaveAccessibleDescription(/skills to include/i)

    const duration = within(card).getByRole('spinbutton', { name: 'Maximum run duration' })
    expect(duration).toHaveValue(2)
    expect(duration).toHaveAccessibleDescription(/elapsed time/i)
    expect(within(card).getByText('Minutes')).toBeInTheDocument()

    fireEvent.change(country, { target: { value: 'CA' } })
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Hybrid' }))
    fireEvent.change(duration, { target: { value: '1.5' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: INSTANCE_ID,
      enabled: true,
      config: { maxRunElapsedMs: 90_000 },
      filters: {
        country: 'CA',
        workModels: ['remote', 'hybrid'],
        skills: [],
      },
    }))
  })

  it('shows an explicit compatibility alert and blocks save when presentation metadata is missing', async () => {
    const connectorsApi = await createFixtureApi(
      { country: 'US', skills: [] },
      {},
      { maxRunElapsedMs: 120_000 },
      missingPresentationDescriptor,
    )
    renderPanel(connectorsApi)

    const card = await screen.findByTestId(`connector-instance-card-${INSTANCE_ID}`)
    const compatibility = within(card).getAllByRole('alert')[0]
    expect(compatibility).toHaveTextContent(/presentation|metadata|compatib/i)
    expect(within(card).queryByRole('combobox', { name: 'Country' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('spinbutton', { name: 'Maximum run duration' }))
      .not.toBeInTheDocument()
    const save = within(card).getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

})
