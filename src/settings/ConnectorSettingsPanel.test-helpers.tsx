import { fireEvent, screen, within } from '@testing-library/react'
import type { ConnectorSettingsInstance } from './connector-settings.types'

export const JOBRIGHT_DISPLAY_NAME = 'Jobright internslist'

/** Idempotent: returns the already-open details dialog instead of re-triggering it. */
export async function openConnectorDetails(displayName: string = JOBRIGHT_DISPLAY_NAME) {
  const existing = screen.queryByRole('dialog', { name: `${displayName} details` })
  if (existing) return existing
  fireEvent.click(await screen.findByRole('button', {
    name: `View ${displayName} details`,
  }))
  return screen.findByRole('dialog', { name: `${displayName} details` })
}

export async function openConnectorEditor(displayName: string = JOBRIGHT_DISPLAY_NAME) {
  const dialog = await openConnectorDetails(displayName)
  const edit = within(dialog).queryByRole('button', { name: 'Edit connector' })
  if (edit) fireEvent.click(edit)
  // Proves editing mode: the group renders only under `editing`, and unlike the Save and
  // Close buttons it names itself the same way whether the draft is dirty or a save is busy.
  await within(dialog).findByRole('group', { name: `${displayName} edit actions` })
  return dialog
}

export async function openConnectorInstanceCard(displayName: string, instanceId: string) {
  await openConnectorEditor(displayName)
  return screen.findByTestId(`connector-instance-card-${instanceId}`)
}

export function jobrightAuth(configured = true) {
  return [{
    id: 'jobright',
    mode: 'username_password' as const,
    label: 'Jobright username and password',
    configured,
  }]
}

export function jobrightInstance(
  overrides: Partial<ConnectorSettingsInstance> = {},
): ConnectorSettingsInstance {
  const instance: ConnectorSettingsInstance = {
    id: 'jobright-default',
    connectorId: 'jobright.resolver',
    connectorVersion: '0.11.0',
    displayName: JOBRIGHT_DISPLAY_NAME,
    enabled: true,
    lifecycle: 'enabled',
    auth: jobrightAuth(),
    config: {},
    filters: {},
    earliestBackfillDate: '2026-07-02',
    createdAt: '2026-07-09T15:00:00.000Z',
    updatedAt: '2026-07-09T15:00:00.000Z',
    ...overrides,
  }
  // Mirrors the server derivation so an `enabled` override cannot leave the pair incoherent.
  return { ...instance, lifecycle: overrides.lifecycle ?? (instance.enabled ? 'enabled' : 'disabled') }
}
