import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConnectorsApiWithJobrightDescriptor, createProfileApi } from '../App.test-helpers'
import { unavailableScheduleApi } from './connector-schedule.test-helpers'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'

afterEach(cleanup)

/**
 * Structural link for the #309 real-layout fix: pins the connector details modal
 * to the scroll composition proven to overflow in a real engine — a column-flex
 * DialogContent whose header stays out of the scroll region and whose body is a
 * single `min-h-0 flex-1 overflow-y-auto` flex-item scroller containing every
 * section. jsdom cannot prove the resulting viewport overflows (that is the
 * Electron layout probe's job), and it is blind to why a Radix ScrollArea's
 * `height:100%` viewport does NOT clamp here — so this test only pins the exact
 * class composition the probe validates.
 */
describe('ConnectorSettingsInstanceCard scroll composition', () => {
  it('wraps the connector sections in a column-flex dialog with a min-h-0 flex-1 overflow-y-auto scroller', async () => {
    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    await connectorsApi.create({
      id: 'jobright-scroll',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.16.0',
      displayName: 'Jobright scroll',
      enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', label: 'Jobright username and password', configured: true }],
      config: { discoveryCount: 20 },
      filters: { country: 'US' },
      earliestBackfillDate: '2026-07-02',
    })

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={unavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'View Jobright scroll details' }))
    const dialog = await screen.findByRole('dialog', { name: 'Jobright scroll details' })

    // DialogContent is a column flex container with a bounded height (not the base grid).
    expect(dialog).toHaveClass('flex', 'flex-col', 'overflow-hidden')

    // The scroll region is a single flex-item scroller: min-h-0 + flex-1 bound its
    // height inside the column and overflow-y-auto turns it into the scroll viewport.
    // (A Radix ScrollArea's height:100% viewport is intentionally NOT used here — it
    // fails to clamp under the dialog's indefinite max-height and never scrolls.)
    const scroller = dialog.querySelector('.min-h-0.flex-1.overflow-y-auto')
    const header = dialog.querySelector('[data-slot="dialog-header"]')
    expect(scroller).not.toBeNull()
    expect(header).not.toBeNull()
    // The header stays outside the scroll region so it remains visible while the body scrolls.
    expect(scroller!.contains(header)).toBe(false)

    // Every section, through the final "Connector management", lives inside the scroller.
    expect(within(scroller as HTMLElement).getByRole('heading', { name: 'Connector management' }))
      .toBeInTheDocument()
    expect(within(scroller as HTMLElement).getByRole('heading', { name: 'Provider filters' }))
      .toBeInTheDocument()
  })
})
