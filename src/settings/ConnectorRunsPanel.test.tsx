import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConnectorsApi } from '../App.test-helpers'
import { ConnectorRunsPanel } from './ConnectorRunsPanel'

afterEach(cleanup)

describe('ConnectorRunsPanel', () => {
  it('renders Empty when there are no connector runs yet', async () => {
    const connectorsApi = createConnectorsApi()

    render(<ConnectorRunsPanel connectorsApi={connectorsApi} />)

    const empty = await screen.findByLabelText('Empty connector runs')
    expect(empty).toHaveAttribute('data-slot', 'empty')
    expect(within(empty).getByRole('heading', { name: 'No connector runs yet' })).toBeInTheDocument()
    expect(
      within(empty).getByText('Start a connector run to see progress and results here.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('No connector runs recorded yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps load failures as Alert instead of Empty', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockRejectedValueOnce(new Error('boom'))

    render(<ConnectorRunsPanel connectorsApi={connectorsApi} />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByText('Run history unavailable')).toBeInTheDocument()
    expect(screen.queryByLabelText('Empty connector runs')).not.toBeInTheDocument()
  })
})
