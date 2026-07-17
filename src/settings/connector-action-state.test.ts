import { describe, expect, it } from 'vitest'
import {
  describeConnectorCredentialBlockReason,
  describeConnectorRunActionReason,
  describeConnectorSaveActionReason,
  describeConnectorSettingsBlockReason,
  isBrowserAlignedEmail,
  isConnectorCredentialDraftReady,
} from './connector-action-state'

describe('connector action-state derivation', () => {
  it('rejects blank and browser-invalid emails for credential readiness', () => {
    expect(isBrowserAlignedEmail('')).toBe(false)
    expect(isBrowserAlignedEmail('not-an-email')).toBe(false)
    expect(isBrowserAlignedEmail('operator@example.test')).toBe(true)
    expect(isConnectorCredentialDraftReady({
      email: 'not-an-email',
      password: 'write-only-fixture-password',
    })).toBe(false)
    expect(isConnectorCredentialDraftReady({
      email: 'operator@example.test',
      password: 'write-only-fixture-password',
    })).toBe(true)
    expect(describeConnectorCredentialBlockReason({
      email: 'not-an-email',
      password: 'secret',
    })).toMatch(/valid.*email/i)
  })

  it('surfaces earliest-backfill failure in the save block reason', () => {
    expect(describeConnectorSettingsBlockReason({
      descriptorCompatible: true,
      filterIssues: [],
      configIssues: [],
      presentationCompatible: true,
      providerFiltersCompatible: true,
      earliestValid: false,
      earliestMessage: 'Choose a valid calendar date as YYYY-MM-DD.',
    })).toBe('Choose a valid calendar date as YYYY-MM-DD.')
  })

  it('models pending save and run reasons without a false configuration fallthrough', () => {
    expect(describeConnectorSaveActionReason({
      isSaving: true,
      settingsSaveAllowed: true,
      settingsBlockReason: null,
    })).toBe('Settings are saving.')

    expect(describeConnectorRunActionReason({
      isRunning: true,
      isSavingSettings: false,
      draftDirty: false,
      settingsValid: true,
      earliestValid: true,
      earliestMessage: null,
      authReady: true,
      connectorEnabled: true,
      draftEnabled: true,
      settingsBlockReason: null,
    })).toBe('A run is already in progress.')

    expect(describeConnectorRunActionReason({
      isRunning: false,
      isSavingSettings: true,
      draftDirty: false,
      settingsValid: true,
      earliestValid: true,
      earliestMessage: null,
      authReady: true,
      connectorEnabled: true,
      draftEnabled: true,
      settingsBlockReason: null,
    })).toBe('Run must wait until settings finish saving.')

    expect(describeConnectorRunActionReason({
      isRunning: false,
      isSavingSettings: false,
      draftDirty: true,
      settingsValid: true,
      earliestValid: true,
      earliestMessage: null,
      authReady: true,
      connectorEnabled: true,
      draftEnabled: true,
      settingsBlockReason: null,
    })).toBe('Save or discard unsaved settings before running.')

    expect(describeConnectorRunActionReason({
      isRunning: false,
      isSavingSettings: false,
      draftDirty: true,
      settingsValid: false,
      earliestValid: false,
      earliestMessage: 'Choose a valid calendar date as YYYY-MM-DD.',
      authReady: true,
      connectorEnabled: true,
      draftEnabled: true,
      settingsBlockReason: 'Choose a valid calendar date as YYYY-MM-DD.',
    })).toBe('Choose a valid calendar date as YYYY-MM-DD.')
  })
})
