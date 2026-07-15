import { cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { openConnectorsOverview } from './App.connectors.schedules.test.helpers'

afterEach(cleanup)

describe('connector schedule test navigation', () => {
  it('opens Overview after the sidebar defers rendering its nested destination', async () => {
    render(<DeferredConnectorSidebar />)

    await expect(Promise.resolve().then(() => openConnectorsOverview())).resolves.toBeDefined()
    expect(await screen.findByText('Connector overview opened')).toBeInTheDocument()
  })
})

function DeferredConnectorSidebar() {
  const [showOverview, setShowOverview] = useState(false)
  const [opened, setOpened] = useState(false)

  return (
    <aside aria-label="Application navigation">
      <nav aria-label="Application views">
        <button
          type="button"
          onClick={() => {
            void Promise.resolve().then(() => setShowOverview(true))
          }}
        >
          Connectors
        </button>
        {showOverview ? (
          <button type="button" onClick={() => setOpened(true)}>Overview</button>
        ) : null}
      </nav>
      {opened ? <p>Connector overview opened</p> : null}
    </aside>
  )
}
