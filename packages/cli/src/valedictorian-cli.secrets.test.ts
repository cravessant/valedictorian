import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { jsonResponse, runCli } from './valedictorian-cli.test-helpers.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('top-level secrets administration', () => {
  it('removes profile secrets from routing and help', async () => {
    const help = await runCli(['profile', '--help'])
    expect(help.exitCode).toBe(0)
    expect(help.stdout).not.toContain('secrets')

    const obsolete = await runCli(['profile', 'secrets', 'list', '--workspace', 'workspace-1'])
    expect(obsolete.exitCode).toBe(2)
    expect(obsolete.stderr.toLowerCase()).toMatch(/secrets|no command|unknown|not found|unrecognized/)
  })

  it('manages credential secret summaries over workspace-scoped HTTP', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-cli-secrets-'))
    const secretValuePath = path.join(tempDirectory, 'secret-value.txt')
    const secretSummary = {
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse password',
      updatedAt: '2026-07-03T12:00:00.000Z',
    }

    fs.writeFileSync(secretValuePath, 'super-secret-password')

    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(secretSummary))
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [secretSummary] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const secretUpsert = await runCli([
      'secrets',
      'upsert',
      'greenhouse_password',
      '--workspace',
      'workspace-1',
      '--kind',
      'password',
      '--label',
      'Greenhouse password',
      '--value-file',
      secretValuePath,
      '--json',
    ])
    const secretList = await runCli([
      'secrets',
      'list',
      '--workspace',
      'workspace-1',
      '--json',
    ])
    const secretDelete = await runCli([
      'secrets',
      'delete',
      'greenhouse_password',
      '--workspace',
      'workspace-1',
      '--json',
    ])

    expect(secretUpsert.exitCode).toBe(0)
    expect(secretList.exitCode).toBe(0)
    expect(secretDelete.exitCode).toBe(0)
    expect(JSON.parse(secretUpsert.stdout)).toEqual(secretSummary)
    expect(JSON.parse(secretList.stdout)).toEqual({ items: [secretSummary] })
    expect(JSON.parse(secretDelete.stdout)).toEqual({ ok: true })
    expect(`${secretUpsert.stdout}${secretList.stdout}${secretDelete.stdout}`).not.toContain(
      'super-secret-password',
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/workspace-1/secrets/greenhouse_password',
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'password',
          label: 'Greenhouse password',
          value: 'super-secret-password',
        }),
        method: 'PUT',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/secrets',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/workspaces/workspace-1/secrets/greenhouse_password',
      expect.objectContaining({ method: 'DELETE' }),
    )

    const help = await runCli(['secrets', '--help'])
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain('list')
    expect(help.stdout).toContain('upsert')
    expect(help.stdout).toContain('delete')
    expect(help.stdout).toContain('run')
  })
})
