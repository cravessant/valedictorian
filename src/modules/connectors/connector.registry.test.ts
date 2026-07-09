import { describe, expect, it } from 'vitest'
import { createDefaultLocalConnectorRegistry } from './connector.registry'

describe('connector registry', () => {
  it('registers the published Jobright connector by persisted connector id', () => {
    const registry = createDefaultLocalConnectorRegistry()

    expect(registry.get('jobright.resolver')?.definition).toMatchObject({
      displayName: 'Jobright public jobs',
      id: 'jobright.resolver',
      version: '0.3.0',
    })
    expect(registry.get('jobright.public')).toBeNull()
  })
})
