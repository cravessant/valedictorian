/**
 * Connector-details may close while independent work continues. Only drafts
 * owned by this editor and mutations that would make those drafts ambiguous
 * need to keep the dialog open.
 */
export type ConnectorDetailsDismissalState = {
  readonly credentialAuthenticationUnsafe: boolean
  readonly credentialDirty: boolean
  readonly isConnectorRemovalPending: boolean
  readonly isConnectorRunActive: boolean
  readonly scheduleDirty: boolean
  readonly scheduleSavePending: boolean
  readonly settingsDirty: boolean
  readonly settingsSavePending: boolean
  readonly unifiedSavePending: boolean
}

export type ConnectorDetailsDismissalDecision =
  | 'blocked'
  | 'confirm_discard'
  | 'dismiss'

export function connectorDetailsDismissalDecision(
  state: ConnectorDetailsDismissalState,
): ConnectorDetailsDismissalDecision {
  if (
    state.unifiedSavePending
    || state.settingsSavePending
    || state.scheduleSavePending
    || state.credentialAuthenticationUnsafe
  ) {
    return 'blocked'
  }
  if (state.settingsDirty || state.scheduleDirty || state.credentialDirty) {
    return 'confirm_discard'
  }
  // Connector runs and removal are independently owned by the panel. They can
  // complete safely after this details view closes, so they never block it.
  return 'dismiss'
}
