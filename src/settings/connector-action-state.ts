import type { ConnectorSchemaValidationIssue } from '../modules/connectors/connector.renderer-schema-validation'
import type { ConnectorAuthCredentialDraft } from './connector-settings.types'

/** WHATWG HTML living standard valid e-mail address production. */
const BROWSER_ALIGNED_EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

export function isBrowserAlignedEmail(value: string): boolean {
  return BROWSER_ALIGNED_EMAIL_PATTERN.test(value.trim())
}

export function isConnectorCredentialDraftReady(
  draft: ConnectorAuthCredentialDraft,
): boolean {
  return isBrowserAlignedEmail(draft.email) && draft.password.length > 0
}

export function describeConnectorCredentialBlockReason(
  draft: ConnectorAuthCredentialDraft,
): string | null {
  const email = draft.email.trim()
  if (email.length === 0 && draft.password.length === 0) {
    return 'Enter a Jobright email and password before validating.'
  }
  if (email.length === 0) {
    return 'Enter a Jobright email before validating.'
  }
  if (!isBrowserAlignedEmail(draft.email)) {
    return 'Enter a valid Jobright email before validating.'
  }
  if (draft.password.length === 0) {
    return 'Enter a Jobright password before validating.'
  }
  return null
}

export function describeConnectorSettingsBlockReason(input: {
  descriptorCompatible: boolean
  filterIssues: ConnectorSchemaValidationIssue[]
  configIssues: ConnectorSchemaValidationIssue[]
  presentationCompatible: boolean
  providerFiltersCompatible: boolean
  earliestValid: boolean
  earliestMessage?: string | null
}): string | null {
  if (!input.descriptorCompatible) {
    return 'Saving is blocked because the connector descriptor is unavailable.'
  }
  if (!input.presentationCompatible) {
    return 'Saving is blocked until presentation metadata is compatible.'
  }
  if (!input.earliestValid) {
    return input.earliestMessage
      ?? 'Saving is blocked until the earliest backfill date is valid.'
  }
  const firstIssue = input.configIssues[0] ?? input.filterIssues[0]
  if (firstIssue) {
    return `Fix validation issues before saving: ${firstIssue.message}.`
  }
  if (!input.providerFiltersCompatible) {
    return 'Saving is blocked until provider filter values are compatible.'
  }
  return null
}

export function describeConnectorSaveActionReason(input: {
  isSaving: boolean
  settingsSaveAllowed: boolean
  settingsBlockReason: string | null
}): string | null {
  if (input.isSaving) {
    return 'Settings are saving.'
  }
  if (!input.settingsSaveAllowed) {
    return input.settingsBlockReason
  }
  return null
}

export function describeConnectorRunActionReason(input: {
  isRunning: boolean
  isSavingSettings: boolean
  draftDirty: boolean
  settingsValid: boolean
  earliestValid: boolean
  earliestMessage: string | null
  authReady: boolean
  connectorEnabled: boolean
  draftEnabled: boolean
  settingsBlockReason: string | null
}): string | null {
  if (input.isRunning) {
    return 'A run is already in progress.'
  }
  if (input.isSavingSettings) {
    return 'Run must wait until settings finish saving.'
  }
  if (!input.earliestValid) {
    return input.earliestMessage
      ?? input.settingsBlockReason
      ?? 'Choose a valid calendar date as YYYY-MM-DD.'
  }
  if (!input.settingsValid) {
    return input.settingsBlockReason
      ?? 'Resolve configuration issues before running.'
  }
  if (input.draftDirty) {
    return 'Save or discard unsaved settings before running.'
  }
  if (!input.authReady) {
    return 'Validate connector credentials before running.'
  }
  if (!input.draftEnabled || !input.connectorEnabled) {
    return 'Enable the connector before running.'
  }
  return null
}
