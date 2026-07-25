import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createConnectorsApi,
  createProfileApi,
} from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'

afterEach(cleanup)

function unavailableScheduleApi(): ConnectorScheduleUiApi {
  return {
    deleteSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    getCapabilities: vi.fn(async () => ({
      connectorScheduling: { available: false as const },
    })),
    getSchedule: vi.fn(async () => null),
    pauseSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    resumeSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    upsertSchedule: vi.fn(async () => { throw new Error('unavailable') }),
  }
}

async function renderDetails(instanceId = 'dismissal-fixture') {
  const connectorsApi = createConnectorsApi()
  const instance = await connectorsApi.create({
    auth: [],
    config: {},
    connectorId: 'fixture.jobs',
    connectorVersion: '1.0.0',
    displayName: 'Fixture jobs',
    enabled: true,
    filters: {},
    id: instanceId,
  })
  render(
    <ConnectorSettingsPanel
      connectorsApi={connectorsApi}
      connectorScheduleApi={unavailableScheduleApi()}
      onRunSettled={vi.fn()}
      profileApi={createProfileApi()}
      workspaceId="workspace-dismissal"
    />,
  )
  const trigger = await screen.findByRole('button', { name: 'View Fixture jobs details' })
  return { connectorsApi, instance, trigger }
}

async function openEditingDetails(user: ReturnType<typeof userEvent.setup>) {
  const fixture = await renderDetails()
  await user.click(fixture.trigger)
  const dialog = await screen.findByRole('dialog', { name: 'Fixture jobs details' })
  await user.click(within(dialog).getByRole('button', { name: 'Edit connector' }))
  const card = await screen.findByTestId('connector-instance-card-dismissal-fixture')
  return { ...fixture, card, dialog }
}

function topRightClose(dialog: HTMLElement) {
  const close = dialog.querySelector<HTMLElement>('[data-slot="dialog-close"]')
  if (!close) throw new Error('Connector details is missing its top-right close control.')
  return close
}

describe('ConnectorSettingsInstanceCard dismissal', () => {
  it('keeps read-only Escape and backdrop dismissal with trigger focus return', async () => {
    const user = userEvent.setup()
    const { trigger } = await renderDetails('read-only-dismissal')

    trigger.focus()
    await user.click(trigger)
    const readOnlyDialog = await screen.findByRole('dialog', { name: 'Fixture jobs details' })
    expect(topRightClose(readOnlyDialog)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Fixture jobs details' })).toBeInTheDocument()
    await user.click(document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('keeps the accessible top-right close control while editing', async () => {
    const user = userEvent.setup()
    const { dialog } = await openEditingDetails(user)

    expect(topRightClose(dialog)).toBeInTheDocument()
    expect(topRightClose(dialog)).toBeEnabled()
  })

  it('uses the same discard confirmation for dirty close, backdrop, Escape, and footer exits', async () => {
    const exits = [
      async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, _card: HTMLElement) => {
        await user.click(topRightClose(dialog))
      },
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!)
      },
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.keyboard('{Escape}')
      },
      async (user: ReturnType<typeof userEvent.setup>, _dialog: HTMLElement, card: HTMLElement) => {
        await user.click(within(card).getByRole('button', { name: 'Discard changes' }))
      },
    ]

    for (const exit of exits) {
      cleanup()
      const user = userEvent.setup()
      const { card, dialog } = await openEditingDetails(user)
      await user.click(within(card).getByRole('switch', { name: 'Fixture jobs connector enabled' }))

      await exit(user, dialog, card)

      const confirmation = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })
      expect(within(confirmation).getByRole('button', { name: 'Keep editing' })).toBeInTheDocument()
      expect(dialog).toBeInTheDocument()
    }
  })

  it('returns successful unified saves to a clean, normally dismissible details view', async () => {
    const user = userEvent.setup()
    const { card, dialog, trigger } = await openEditingDetails(user)
    await user.click(within(card).getByRole('switch', { name: 'Fixture jobs connector enabled' }))
    await user.click(within(card).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(within(dialog).getByRole('button', {
      name: 'Edit connector',
    })).toBeInTheDocument())
    expect(within(dialog).queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument()

    await user.click(topRightClose(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('blocks close during a connector settings mutation without prompting to discard', async () => {
    const user = userEvent.setup()
    const { card, connectorsApi, dialog, instance } = await openEditingDetails(user)
    let resolveUpdate: ((value: typeof instance) => void) | undefined
    vi.mocked(connectorsApi.update).mockImplementationOnce(() => new Promise((resolve) => {
      resolveUpdate = resolve
    }))

    await user.click(within(card).getByRole('switch', { name: 'Fixture jobs connector enabled' }))
    await user.click(within(card).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(within(card).getByRole('button', {
      name: 'Saving changes...',
    })).toBeInTheDocument())

    await user.click(topRightClose(dialog))
    expect(screen.getByRole('dialog', { name: 'Fixture jobs details' })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument()

    resolveUpdate?.({ ...instance, enabled: false })
    await waitFor(() => expect(within(dialog).getByRole('button', {
      name: 'Edit connector',
    })).toBeInTheDocument())
  })
})
