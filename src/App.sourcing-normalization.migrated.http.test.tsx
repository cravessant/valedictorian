import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHttpValedictorianClient } from 'sparxie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createApplication, createListResult, createSettingsApi } from './App.test-helpers'
import { createFileDatabase, migrateDatabase } from './db/sqlite'
import { createLocalValedictorianClient } from './runtime/local-valedictorian-client'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from './server/local-server'
import {
  createLegacyRawSourceFixture,
  LEGACY_MIXED_RAW_RECORD_ID,
  LEGACY_VALID_CONNECTOR_RECORD_ID,
} from './test-fixtures/legacy-raw-source.fixture'

const WORKSPACE_ID = 'workspace-legacy-raw-source'
let server: StartedValedictorianHttpServer | null = null

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(async () => {
  cleanup()
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
  await server?.close()
  server = null
})

describe('migrated raw-source inspection through renderer HTTP', () => {
  it('renders facts, lineage, normalization, gate, and projection from a legacy connector record', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'raw-source-inspect-')),
      'valedictorian.sqlite',
    )
    createLegacyRawSourceFixture(sqlitePath)
    const legacySqlite = createFileDatabase(sqlitePath)
    migrateDatabase(legacySqlite)
    legacySqlite.close()

    const client = createLocalValedictorianClient({
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: WORKSPACE_ID,
    })
    server = await createValedictorianHttpServer({ client, host: '127.0.0.1', port: 0 })
    ;(window as Window & { valedictorianHttp?: unknown }).valedictorianHttp = {
      apiBaseUrl: server.url,
      getBackendState: () => ({ origin: server!.url, status: 'available' }),
      onBackendStateChanged: () => () => undefined,
      workspaceId: WORKSPACE_ID,
    }
    const workspace = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace(WORKSPACE_ID)
    await expect(workspace.sourcing.rawRecords.list({ limit: 50 })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: LEGACY_VALID_CONNECTOR_RECORD_ID })]),
    })
    await expect(workspace.sourcing.rawRecords.get(LEGACY_MIXED_RAW_RECORD_ID)).rejects.toMatchObject({
      status: 404,
    })
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalization' }))
    const table = await screen.findByRole('table', { name: 'Capture-to-Job normalization' })
    const listed = await workspace.sourcing.rawRecords.list({ limit: 50 })
    const validIndex = listed.items.findIndex(({ id }) => id === LEGACY_VALID_CONNECTOR_RECORD_ID)
    if (validIndex < 0) throw new Error('Migrated valid connector fixture is missing')
    fireEvent.click(within(within(table).getAllByRole('row')[validIndex + 1])
      .getByRole('button', { name: 'Inspect Capture lineage' }))

    const dialog = await screen.findByRole('dialog', {
      name: `Capture lineage ${LEGACY_VALID_CONNECTOR_RECORD_ID}`,
    })
    expect(await within(dialog).findAllByText('Platform Engineer')).not.toHaveLength(0)
    expect(dialog).toHaveTextContent('Fixture Robotics')
    expect(within(dialog).getByRole('table', { name: 'Captures and evidence versions' }))
      .toHaveTextContent('legacy-connector-run')
    expect(within(dialog).getByRole('region', { name: 'Job normalization resolver outcomes' }))
      .toHaveTextContent('fixture.raw@1.0.0')
    expect(within(dialog).getByRole('region', { name: 'Opportunity admission gate' }))
      .toHaveTextContent('Destination URL is missing.')
    expect(dialog).toHaveTextContent('Not eligible for Opportunity projection')
    expect(dialog).not.toHaveTextContent('Capture lineage detail could not be loaded.')
  })
})
