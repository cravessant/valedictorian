import { describe, expect, it } from 'vitest'
import { createDefaultLocalConnectorRegistry } from './connector.registry'
import {
  assertSupportedConnectorSettings,
  validateCompleteConnectorFilters,
} from './connector.settings-validation'

const JOBRIGHT_FILTERS = {
  jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
}

describe('connector settings schema validation', () => {
  const jobright = createDefaultLocalConnectorRegistry().get('jobright.resolver')!

  it('allows a disabled draft to omit required filters but requires them before execution', () => {
    expect(() => assertSupportedConnectorSettings(jobright, {}, {})).not.toThrow()
    expect(() => validateCompleteConnectorFilters(jobright, {}))
      .toThrow(/jobTaxonomyList.*required/i)
    expect(() => validateCompleteConnectorFilters(jobright, JOBRIGHT_FILTERS)).not.toThrow()
  })

  it('still rejects unknown and malformed filter values while root required fields are incomplete', () => {
    expect(() => assertSupportedConnectorSettings(jobright, {}, { privateProviderFilter: true }))
      .toThrow(/not declared/i)
    expect(() => assertSupportedConnectorSettings(jobright, {}, {
      jobTaxonomyList: ['Software Engineering'],
    })).toThrow(/jobTaxonomyList\/0.*object/i)
  })

  it('rejects malformed and undeclared Jobright config without weakening valid config', () => {
    expect(() => assertSupportedConnectorSettings(jobright, { discoveryCount: 0 }, JOBRIGHT_FILTERS))
      .toThrow(/discoveryCount/i)
    expect(() => assertSupportedConnectorSettings(jobright, {
      discoveryCount: 20,
      privateProviderConfig: 'must-not-cross-the-boundary',
    }, JOBRIGHT_FILTERS)).toThrow(/privateProviderConfig|not declared/i)
    expect(() => assertSupportedConnectorSettings(jobright, { discoveryCount: 20 }, JOBRIGHT_FILTERS))
      .not.toThrow()
  })
})
