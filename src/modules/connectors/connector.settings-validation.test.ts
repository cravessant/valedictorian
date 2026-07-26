import { describe, expect, it } from 'vitest'
import { createDefaultLocalConnectorRegistry } from './connector.registry'
import { admitConnectorSettings } from './connector.settings-validation'

const JOBRIGHT_FILTERS = {
  jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
}

describe('connector settings admission', () => {
  const jobright = createDefaultLocalConnectorRegistry().get('jobright.resolver')!.descriptor

  it('allows a draft to omit required filters while enabled admission demands them', () => {
    expect(() => admitConnectorSettings(jobright, { config: {}, filters: {} }, 'draft'))
      .not.toThrow()
    expect(() => admitConnectorSettings(jobright, { config: {}, filters: {} }, 'enabled'))
      .toThrow(/jobTaxonomyList.*required/i)
    expect(() => admitConnectorSettings(
      jobright,
      { config: {}, filters: JOBRIGHT_FILTERS },
      'enabled',
    )).not.toThrow()
  })

  it('still rejects unknown and malformed filter values in draft mode', () => {
    expect(() => admitConnectorSettings(
      jobright,
      { config: {}, filters: { privateProviderFilter: true } },
      'draft',
    )).toThrow(/not declared/i)
    expect(() => admitConnectorSettings(
      jobright,
      { config: {}, filters: { jobTaxonomyList: ['Software Engineering'] } },
      'draft',
    )).toThrow(/jobTaxonomyList\/0.*object/i)
  })

  it('rejects malformed and undeclared Jobright config without weakening valid config', () => {
    expect(() => admitConnectorSettings(
      jobright,
      { config: { discoveryCount: 0 }, filters: JOBRIGHT_FILTERS },
      'draft',
    )).toThrow(/discoveryCount/i)
    expect(() => admitConnectorSettings(jobright, {
      config: { discoveryCount: 20, privateProviderConfig: 'must-not-cross-the-boundary' },
      filters: JOBRIGHT_FILTERS,
    }, 'draft')).toThrow(/privateProviderConfig|not declared/i)
    expect(() => admitConnectorSettings(
      jobright,
      { config: { discoveryCount: 20 }, filters: JOBRIGHT_FILTERS },
      'draft',
    )).not.toThrow()
  })
})
