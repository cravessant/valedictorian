import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorOptionQueryResult, InstalledConnectorDescriptor } from '@sparxie/sdk'
import {
  alphaOption,
  betaOption,
  boundOptionResult,
  catalogIdentityBumpedDescriptor,
  createFixtureApi,
  deferred,
  denverOption,
  extraDependencyDescriptor,
  filterSchemaDescriptor,
  fixtureDescriptor,
  INSTANCE_ID,
  optionIdentityForFixture,
  type PublicOptionQueryInput,
  renderPanel,
  renderProviderFilters,
  resolveReady,
  retryableUnavailableResult,
} from './ConnectorProviderFilters.test-helpers'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

async function expectCompatibilityAlert(
  scope: { findByRole: typeof screen.findByRole },
  valuePattern: RegExp,
) {
  const compatibility = await scope.findByRole('alert')
  expect(compatibility).toHaveTextContent(valuePattern)
  expect(compatibility).toHaveTextContent(/unknown|unavailable|compatib/i)
  return compatibility
}

/** Denver resolves in every dependency context except CA, which fails once before reporting it unknown. */
function denverRetryableUnderCa() {
  let caAttempts = 0
  return (input: PublicOptionQueryInput) => {
    if (input.body.dependencies.country !== 'CA') return resolveReady(input, [denverOption])
    caAttempts += 1
    if (caAttempts === 1) return Promise.resolve(retryableUnavailableResult())
    return resolveReady(input, [], ['denver-co'])
  }
}

function denverUnknownUnderCa(input: PublicOptionQueryInput) {
  if (input.body.dependencies.country === 'CA') return resolveReady(input, [], ['denver-co'])
  return resolveReady(input, [denverOption])
}

describe('connector select authorization and resolve accounting', () => {
  it('revokes clear authorization when identity changes after a retryable dependency transition', async () => {
    const resolveInputs: PublicOptionQueryInput[] = []
    const resolveDenver = denverRetryableUnderCa()
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, {
      resolve(input) {
        resolveInputs.push(input)
        return resolveDenver(input)
      },
    })
    const harness = renderProviderFilters(connectorsApi.options, {
      filters: { country: 'US', skills: ['denver-co'] },
    })

    expect(await screen.findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(true))
    harness.onChange.mockClear()

    harness.rerender({ filters: { country: 'CA', skills: ['denver-co'] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable|temporarily|retry/i)
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()

    harness.rerender({ descriptor: catalogIdentityBumpedDescriptor() })

    await waitFor(() => expect(
      resolveInputs.some((input) => input.expectedIdentity.catalogVersion === 'fixture-provider-options@2'),
    ).toBe(true))
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Denver, CO' })).toBeInTheDocument()
    expect(harness.onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    await expectCompatibilityAlert(screen, /denver/i)
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('revokes clear authorization when dependency declarations change without filter value changes', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, { resolve: denverRetryableUnderCa() })
    const harness = renderProviderFilters(connectorsApi.options, {
      filters: { country: 'US', skills: ['denver-co'] },
    })

    expect(await screen.findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(true))
    harness.onChange.mockClear()

    harness.rerender({ filters: { country: 'CA', skills: ['denver-co'] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable|temporarily|retry/i)

    harness.rerender({ descriptor: extraDependencyDescriptor() })

    await waitFor(() => expect(harness.onChange).not.toHaveBeenCalled())
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    await expectCompatibilityAlert(screen, /denver/i)
  })

  it('does not treat omitted selected values as verified during an incomplete dependency transition', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['alpha', 'beta'],
    }, {
      resolve(input) {
        if (input.body.dependencies.country === 'CA') {
          return resolveReady(input, [], ['alpha'])
        }
        return resolveReady(input, [alphaOption, betaOption])
      },
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('Alpha')).toBeInTheDocument()
    expect(within(card).getByText('Beta')).toBeInTheDocument()
    await waitFor(() => expect(saveButton(card)).toBeDisabled())

    selectCountry(card, 'CA')
    expect(await within(card).findByText('Beta')).toBeInTheDocument()
    expect(within(card).getByText('Alpha')).toBeInTheDocument()
    expect(within(card).queryByText(/was cleared because/i)).not.toBeInTheDocument()
    await expectCompatibilityAlert(within(card), /beta/i)
    expect(saveButton(card)).toBeDisabled()
  })

  it('blocks save when a resolve_ready response accounts for none of the selected values', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['beta'],
    }, {
      resolve: (input) => resolveReady(input, []),
    })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('beta')).toBeInTheDocument()
    await expectCompatibilityAlert(within(card), /beta/i)
    expect(saveButton(card)).toBeDisabled()
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
          return resolveReady(input, [{ key: 'typescript', label: 'TypeScript', value: 'typescript' }])
        }
        return resolveReady(input, [], ['typescript'])
      },
    })
    const harness = renderProviderFilters(connectorsApi.options, {
      filters: { country: 'US', skills: ['typescript'] },
    })

    expect(await screen.findByText('TypeScript')).toBeInTheDocument()
    await waitFor(() => expect(resolveInputs).toHaveLength(1))
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(true))
    harness.onChange.mockClear()
    harness.onCompatibilityChange.mockClear()

    harness.rerender({ descriptor: extraDependencyDescriptor() })

    await waitFor(() => expect(resolveInputs.length).toBeGreaterThanOrEqual(2))
    expect(resolveInputs[1]?.body.dependencies).toEqual({ country: 'US' })
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    expect(harness.onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    await expectCompatibilityAlert(screen, /typescript/i)
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(false))
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
          return resolveReady(input, [], ['denver-co'])
        }
        return resolveReady(input, [denverOption])
      },
    })
    const harness = renderProviderFilters(connectorsApi.options, {
      filters: { country: 'US', skills: ['denver-co'] },
    })

    expect(await screen.findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(true))
    harness.onChange.mockClear()

    harness.rerender({
      descriptor: catalogIdentityBumpedDescriptor(),
      filters: { country: 'CA', skills: ['denver-co'] },
    })

    await waitFor(() => expect(resolveInputs.some((input) =>
      input.expectedIdentity.catalogVersion === 'fixture-provider-options@2'
      && input.body.dependencies.country === 'CA')).toBe(true))
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()
    expect(harness.onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    await expectCompatibilityAlert(screen, /denver/i)
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('does not authorize clear when declaration shape and dependency values change together', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, { resolve: denverUnknownUnderCa })
    const harness = renderProviderFilters(connectorsApi.options, {
      filters: { country: 'US', skills: ['denver-co'] },
    })

    expect(await screen.findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(true))
    harness.onChange.mockClear()

    harness.rerender({
      descriptor: extraDependencyDescriptor(),
      filters: { country: 'CA', skills: ['denver-co'] },
    })

    expect(await screen.findByText('Denver, CO')).toBeInTheDocument()
    expect(harness.onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    await expectCompatibilityAlert(screen, /denver/i)
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(false))
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
          return resolveReady(input, [alphaOption])
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
    const harness = renderProviderFilters(connectorsApi.options, {
      filters: { country: 'US', skills: ['alpha'] },
      onChange: (next) => harness.rerender({ filters: next }),
    })

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(true))
    harness.onChange.mockClear()

    harness.rerender({ filters: { country: 'CA', skills: ['alpha'] } })
    await waitFor(() => expect(caBySelection.has('alpha')).toBe(true))

    harness.rerender({ filters: { country: 'CA', skills: ['alpha', 'beta'] } })
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
    expect(harness.onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    await expectCompatibilityAlert(screen, /beta/i)
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('does not clear a replaced cardinality-one value after an authorized dependency transition', async () => {
    const oneSkillDescriptor = {
      ...filterSchemaDescriptor({
        properties: {
          skills: { type: 'string' as const, minLength: 1, maxLength: 100 },
        },
      }),
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
          return resolveReady(input, [alphaOption])
        }
        caAttempts += 1
        if (caAttempts === 1) {
          return Promise.resolve({ ...optionIdentityForFixture(), status: 'auth_required' })
        }
        return resolveReady(input, [], ['beta'])
      },
    }, {}, oneSkillDescriptor)
    const harness = renderProviderFilters(connectorsApi.options, {
      descriptor: oneSkillDescriptor,
      filters: { country: 'US', skills: 'alpha' },
      onChange: (next) => harness.rerender({ filters: next }),
    })

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(true))
    harness.onChange.mockClear()

    harness.rerender({ filters: { country: 'CA', skills: 'alpha' } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/authentication|auth/i)
    expect(screen.getByText('Alpha')).toBeInTheDocument()

    harness.rerender({ filters: { country: 'CA', skills: 'beta' } })

    expect(await screen.findByText('beta')).toBeInTheDocument()
    expect(harness.onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/was cleared because/i)).not.toBeInTheDocument()
    await expectCompatibilityAlert(screen, /beta/i)
    await waitFor(() => expect(harness.onCompatibilityChange).toHaveBeenCalledWith(false))
  })

  it('still clears the exact unchanged selection after same-scope retry', async () => {
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: ['denver-co'],
    }, { resolve: denverRetryableUnderCa() })
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    await waitFor(() => expect(saveButton(card)).toBeDisabled())

    selectCountry(card, 'CA')
    expect(await within(card).findByRole('alert')).toHaveTextContent(/unavailable|temporarily|retry/i)
    fireEvent.click(within(card).getByRole('button', { name: /retry/i }))

    const feedback = await within(card).findByRole('status')
    expect(feedback).toHaveTextContent(/denver/i)
    expect(feedback).toHaveTextContent(/cleared|removed|unavailable/i)
    expect(within(card).queryByText('Denver, CO')).not.toBeInTheDocument()
    await waitFor(() => expect(saveButton(card)).toBeEnabled())
  })

  it('renders human provider labels in dependency-clear feedback for object-valued selections', async () => {
    const denver = { type: 'city', city: 'Denver', state: 'CO', radiusRange: 25 }
    const seattle = { type: 'city', city: 'Seattle', state: 'WA', radiusRange: 25 }
    const locationSkillsDescriptor = filterSchemaDescriptor({
      properties: {
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
    })
    const connectorsApi = await createFixtureApi({
      country: 'US',
      skills: [denver, seattle],
    }, {
      resolve(input) {
        if (input.body.dependencies.country === 'CA') {
          return resolveReady(input, [], [denver, seattle])
        }
        return resolveReady(input, [
          { key: 'denver-co', label: 'Denver, CO', value: denver },
          { key: 'seattle-wa', label: 'Seattle, WA', value: seattle },
        ])
      },
    }, {}, locationSkillsDescriptor)
    renderPanel(connectorsApi)

    const card = await instanceCard()
    expect(await within(card).findByText('Denver, CO')).toBeInTheDocument()
    expect(within(card).getByText('Seattle, WA')).toBeInTheDocument()
    await waitFor(() => expect(saveButton(card)).toBeDisabled())

    selectCountry(card, 'CA')

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
