import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {
  createHttpValedictorianClient,
  InvalidPersistedRawDetailHttpError,
  invalidPersistedRawDetailErrorBody,
  rawSourceRecordSchema,
} from 'sparxie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createApplication, createListResult, createSettingsApi } from './App.test-helpers'
import { createDrizzleDatabase, createFileDatabase } from './db/sqlite'
import { createSqliteRawSourceRepository } from './modules/sourcing/raw-source.repository'
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
    const legacyRepository = createSqliteRawSourceRepository(createDrizzleDatabase(legacySqlite))
    const legacyServer = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      response.setHeader('content-type', 'application/json')
      if (requestUrl.pathname.endsWith(`/raw-records/${LEGACY_MIXED_RAW_RECORD_ID}`)) {
        const detail = rawSourceRecordSchema.safeParse(
          await legacyRepository.get(LEGACY_MIXED_RAW_RECORD_ID),
        )
        if (!detail.success) {
          response.statusCode = 500
          response.end(JSON.stringify(invalidPersistedRawDetailErrorBody))
          return
        }
        response.end(JSON.stringify(detail.data))
        return
      }
      if (requestUrl.pathname.endsWith('/raw-records')) {
        const listed = await legacyRepository.list({ limit: 50 })
        response.end(JSON.stringify({
          ...listed,
          items: listed.items.filter(({ id }) => id === LEGACY_MIXED_RAW_RECORD_ID),
        }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }))
    })
    await new Promise<void>((resolve) => legacyServer.listen(0, '127.0.0.1', resolve))
    const legacyAddress = legacyServer.address() as AddressInfo
    const legacyUrl = `http://127.0.0.1:${legacyAddress.port}`
    const legacyWorkspace = createHttpValedictorianClient({ baseUrl: legacyUrl })
      .forWorkspace(WORKSPACE_ID)
    const legacyError = await legacyWorkspace.sourcing.rawRecords
      .get(LEGACY_MIXED_RAW_RECORD_ID)
      .catch((caught: unknown) => caught)
    expect(legacyError).toBeInstanceOf(InvalidPersistedRawDetailHttpError)
    expect(legacyError).toMatchObject({ status: 500, body: invalidPersistedRawDetailErrorBody })
    ;(window as Window & { valedictorianHttp?: unknown }).valedictorianHttp = {
      apiBaseUrl: legacyUrl,
      getBackendState: () => ({ origin: legacyUrl, status: 'available' }),
      onBackendStateChanged: () => () => undefined,
      workspaceId: WORKSPACE_ID,
    }
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalization' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect raw record' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Raw record detail is invalid and cannot be displayed.',
    )
    cleanup()
    await new Promise<void>((resolve, reject) => legacyServer.close((error) => {
      if (error) reject(error)
      else resolve()
    }))
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
    const table = await screen.findByRole('table', { name: 'Raw sourcing normalization' })
    const listed = await workspace.sourcing.rawRecords.list({ limit: 50 })
    const validIndex = listed.items.findIndex(({ id }) => id === LEGACY_VALID_CONNECTOR_RECORD_ID)
    if (validIndex < 0) throw new Error('Migrated valid connector fixture is missing')
    fireEvent.click(within(within(table).getAllByRole('row')[validIndex + 1])
      .getByRole('button', { name: 'Inspect raw record' }))

    const dialog = await screen.findByRole('dialog', {
      name: `Raw record ${LEGACY_VALID_CONNECTOR_RECORD_ID}`,
    })
    expect(await within(dialog).findAllByText('Platform Engineer')).not.toHaveLength(0)
    expect(dialog).toHaveTextContent('Fixture Robotics')
    expect(within(dialog).getByRole('table', { name: 'Occurrence and revision lineage' }))
      .toHaveTextContent('legacy-connector-run')
    expect(within(dialog).getByRole('region', { name: 'Normalization resolver outcomes' }))
      .toHaveTextContent('fixture.raw@1.0.0')
    expect(within(dialog).getByRole('region', { name: 'Sourcing admission gate' }))
      .toHaveTextContent('Destination URL is missing.')
    expect(dialog).toHaveTextContent('Not eligible for projection')
    expect(dialog).not.toHaveTextContent('Raw record detail could not be loaded.')
  })
})
