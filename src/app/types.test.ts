import { describe, expect, it } from 'vitest'

describe('app navigation type constants', () => {
  it('exports stable app view ids', async () => {
    const { APP_VIEWS } = await import('./types')

    expect(APP_VIEWS).toEqual({
      APPLICATIONS: 'applications',
      PROFILE: 'profile',
      ACTION_QUEUE: 'action-queue',
      CONNECTORS: 'connectors',
      SETTINGS: 'settings',
      SOURCING: 'sourcing',
    })
  })

  it('exports stable settings panel ids', async () => {
    const { SETTINGS_PANELS } = await import('./types')

    expect(SETTINGS_PANELS).toEqual({
      PROFILE: 'profile',
      GENERAL: 'general',
      CONNECTORS: 'connectors',
      POLICY: 'policy',
      APPEARANCE: 'appearance',
      CONFIGURATION: 'configuration',
      AGENT_ACCESS: 'agent-access',
      AGENT_WORKFLOWS: 'agent-workflows',
      SOURCING_RUNS: 'sourcing-runs',
      ADVANCED: 'advanced',
      DATA: 'data',
    })
  })
})
