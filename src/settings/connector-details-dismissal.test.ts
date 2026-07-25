import { describe, expect, it } from 'vitest'

import { connectorDetailsDismissalDecision } from './connector-details-dismissal'

function state(overrides: Partial<Parameters<typeof connectorDetailsDismissalDecision>[0]> = {}) {
  return {
    credentialAuthenticationUnsafe: false,
    credentialDirty: false,
    isConnectorRemovalPending: false,
    isConnectorRunActive: false,
    scheduleDirty: false,
    scheduleSavePending: false,
    settingsDirty: false,
    settingsSavePending: false,
    unifiedSavePending: false,
    ...overrides,
  }
}

describe('connector details dismissal decision', () => {
  it('dismisses clean details, including while independently owned runs or removal continue', () => {
    expect(connectorDetailsDismissalDecision(state())).toBe('dismiss')
    expect(connectorDetailsDismissalDecision(state({
      isConnectorRemovalPending: true,
      isConnectorRunActive: true,
    }))).toBe('dismiss')
  })

  it.each([
    ['settings', { settingsDirty: true }],
    ['schedule', { scheduleDirty: true }],
    ['credential', { credentialDirty: true }],
  ] as const)('requires explicit discard for a dirty %s draft', (_name, dirtyState) => {
    expect(connectorDetailsDismissalDecision(state(dirtyState))).toBe('confirm_discard')
  })

  it.each([
    ['unified save', { unifiedSavePending: true }],
    ['settings save', { settingsSavePending: true }],
    ['schedule save', { scheduleSavePending: true }],
    ['unsafe credential authentication', { credentialAuthenticationUnsafe: true }],
  ] as const)('blocks dismissal during %s', (_name, pendingState) => {
    expect(connectorDetailsDismissalDecision(state(pendingState))).toBe('blocked')
  })
})
