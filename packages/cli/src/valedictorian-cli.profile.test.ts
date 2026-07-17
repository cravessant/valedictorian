import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultUserProfile,
  profileDocumentErrorBodies,
  profileDocumentErrorStatusByCode,
  profileDocumentSchemaVersion,
} from 'sparxie'

import { jsonResponse, runCli } from './valedictorian-cli.test-helpers'

function profileDocument(overrides: {
  revision?: string
  profile?: Partial<typeof defaultUserProfile>
} = {}) {
  return {
    schemaVersion: profileDocumentSchemaVersion,
    revision: overrides.revision ?? 'rev-1',
    profile: {
      ...defaultUserProfile,
      ...overrides.profile,
    },
  }
}

function documentErrorResponse(
  code: keyof typeof profileDocumentErrorBodies,
  extras: Record<string, unknown> = {},
) {
  const body =
    code === 'invalid_profile_document'
      ? {
          ...profileDocumentErrorBodies.invalid_profile_document,
          path: extras.path ?? ['profile', 'email'],
          ...(extras.line !== undefined ? { line: extras.line } : {}),
          ...(extras.column !== undefined ? { column: extras.column } : {}),
        }
      : profileDocumentErrorBodies[code]

  return jsonResponse(body, { status: profileDocumentErrorStatusByCode[code] })
}

describe('profile document commands', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('gets the versioned profile document over workspace-scoped HTTP', async () => {
    const document = profileDocument({
      profile: {
        fullName: 'Sparxie Example',
        email: 'alex@example.com',
        dateOfBirth: '2000-01-15',
      },
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(document))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['profile', 'get', '--workspace', 'workspace-1', '--json'])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(document)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/profile/document',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('prints a dedicated human profile-document representation', async () => {
    const document = profileDocument({
      revision: 'rev-human',
      profile: {
        fullName: 'Sparxie Example',
        email: 'alex@example.com',
        dateOfBirth: '2000-01-15',
        gender: 'Man',
      },
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(document))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['profile', 'get', '--workspace', 'workspace-1'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('schemaVersion=1')
    expect(result.stdout).toContain('revision=rev-human')
    expect(result.stdout).toContain('fullName="Sparxie Example"')
    expect(result.stdout).toContain('dateOfBirth="2000-01-15"')
    expect(result.stdout).toContain('gender="Man"')
  })

  it('escapes control characters in human profile fact values', async () => {
    const canary = 'safe\n  forgedField=spoofed\u001b[31mRED'
    const document = profileDocument({
      revision: 'rev-escape',
      profile: {
        fullName: canary,
        email: 'alex@example.com',
      },
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(document))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['profile', 'get', '--workspace', 'workspace-1'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`fullName=${JSON.stringify(canary)}`)
    expect(result.stdout).not.toMatch(/(?:^|\n) {2}forgedField=/)
    expect(result.stdout.includes(String.fromCharCode(0x1b))).toBe(false)
    const factLines = result.stdout
      .split('\n')
      .filter((line) => line.startsWith('  ') && line.includes('='))
    expect(factLines).toHaveLength(2)
    for (const line of factLines) {
      expect(line.includes('\n') || line.includes('\r') || line.includes('\t')).toBe(false)
      expect(line.includes(String.fromCharCode(0x1b))).toBe(false)
    }
  })

  it('updates the profile document with required expected revision and unified fields', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-cli-profile-update-'))
    const profilePath = path.join(tempDirectory, 'profile.json')
    const profileInput = {
      fullName: 'Sparxie Example',
      email: 'alex@example.com',
      dateOfBirth: '2000-01-15',
      gender: 'Man',
      hispanicLatino: 'No',
      raceEthnicity: 'Asian',
      disabilityStatus: 'No',
      veteranStatus: 'Not a protected veteran',
    }
    const updated = profileDocument({
      revision: 'rev-2',
      profile: profileInput,
    })
    fs.writeFileSync(profilePath, JSON.stringify(profileInput))

    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'profile',
      'update',
      '--workspace',
      'workspace-1',
      '--input-json',
      profilePath,
      '--expected-revision',
      'rev-1',
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(updated)
    expect(JSON.parse(result.stdout).revision).toBe('rev-2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://valedictorian.test/v1/workspaces/workspace-1/profile/document',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'PUT',
      }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      expectedRevision: 'rev-1',
      profile: profileInput,
    })
  })

  it('requires expected-revision for profile update', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-cli-profile-required-'))
    const profilePath = path.join(tempDirectory, 'profile.json')
    fs.writeFileSync(profilePath, JSON.stringify({ fullName: 'Sparxie' }))

    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'profile',
      'update',
      '--workspace',
      'workspace-1',
      '--input-json',
      profilePath,
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/expected-revision/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes agent-context DOB and every self-identification field through', async () => {
    const agentContext = {
      answers: [],
      basics: {
        fullName: 'Sparxie Example',
        dateOfBirth: '2000-01-15',
        gender: 'Man',
        hispanicLatino: 'No',
        raceEthnicity: 'Asian',
        disabilityStatus: 'No',
        veteranStatus: 'Not a protected veteran',
      },
      education: [],
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(agentContext))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['profile', 'agent-context', '--workspace', 'workspace-1', '--json'])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(agentContext)
    expect(JSON.parse(result.stdout).basics).toMatchObject({
      dateOfBirth: '2000-01-15',
      gender: 'Man',
      hispanicLatino: 'No',
      raceEthnicity: 'Asian',
      disabilityStatus: 'No',
      veteranStatus: 'Not a protected veteran',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/profile/agent-context',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('preserves canonical invalid_profile_document fields from agent-context --json', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      documentErrorResponse('invalid_profile_document', {
        path: ['profile', 'dateOfBirth'],
        line: 12,
        column: 5,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['profile', 'agent-context', '--workspace', 'workspace-1', '--json'])

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toEqual({
      code: 'invalid_profile_document',
      message: profileDocumentErrorBodies.invalid_profile_document.message,
      path: ['profile', 'dateOfBirth'],
      line: 12,
      column: 5,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/profile/agent-context')
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/profile'))).toBe(false)
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/profile/document'))).toBe(
      false,
    )
  })

  it('maps a simple canonical document error from agent-context without fallback', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(documentErrorResponse('profile_document_unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['profile', 'agent-context', '--workspace', 'workspace-1', '--json'])

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toEqual({
      code: 'profile_document_unavailable',
      message: profileDocumentErrorBodies.profile_document_unavailable.message,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/profile/agent-context')
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/profile/document'))).toBe(
      false,
    )
  })

  it('fail-closes agent-context on wrong-status or malformed document-shaped bodies', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    vi.stubGlobal('fetch', fetchMock)

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          ...profileDocumentErrorBodies.invalid_profile_document,
          path: ['profile', 'email'],
          line: 3,
          column: 8,
        },
        { status: 500 },
      ),
    )
    const wrongStatus = await runCli([
      'profile',
      'agent-context',
      '--workspace',
      'workspace-1',
      '--json',
    ])
    expect(wrongStatus.exitCode).toBe(1)
    expect(() => JSON.parse(wrongStatus.stderr)).toThrow()
    expect(wrongStatus.stderr).not.toContain('"path"')
    expect(wrongStatus.stderr).not.toContain('profile.email')
    expect(wrongStatus.stderr).not.toContain('"line": 3')
    expect(wrongStatus.stderr).not.toContain('"column": 8')

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          code: 'invalid_profile_document',
          message: 'hostile non-canonical message',
          path: ['profile', 'email'],
          line: 9,
          column: 1,
        },
        { status: profileDocumentErrorStatusByCode.invalid_profile_document },
      ),
    )
    const malformed = await runCli([
      'profile',
      'agent-context',
      '--workspace',
      'workspace-1',
      '--json',
    ])
    expect(malformed.exitCode).toBe(1)
    expect(() => JSON.parse(malformed.stderr)).toThrow()
    expect(malformed.stderr).not.toContain('"code": "invalid_profile_document"')
    expect(malformed.stderr).not.toContain('"path"')
    expect(malformed.stderr).not.toContain('"line": 9')
    expect(malformed.stderr).not.toContain('"column": 1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      fetchMock.mock.calls.every((call) => String(call[0]).includes('/profile/agent-context')),
    ).toBe(true)
  })

  it('validates the profile document and returns schema/revision', async () => {
    const payload = { schemaVersion: profileDocumentSchemaVersion, revision: 'rev-3' }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const jsonResult = await runCli(['profile', 'validate', '--workspace', 'workspace-1', '--json'])
    expect(jsonResult.exitCode).toBe(0)
    expect(JSON.parse(jsonResult.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/workspace-1/profile/document/validate',
      expect.objectContaining({ method: 'POST' }),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse(payload))
    const humanResult = await runCli(['profile', 'validate', '--workspace', 'workspace-1'])
    expect(humanResult.exitCode).toBe(0)
    expect(humanResult.stdout).toContain('valid')
    expect(humanResult.stdout).toContain('schemaVersion=1')
    expect(humanResult.stdout).toContain('revision=rev-3')
  })

  it('formats the profile document with expected revision', async () => {
    const formatted = profileDocument({ revision: 'rev-4', profile: { fullName: 'Sparxie Example' } })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(formatted))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'profile',
      'format',
      '--workspace',
      'workspace-1',
      '--expected-revision',
      'rev-3',
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(formatted)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/profile/document/format',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedRevision: 'rev-3' }),
      }),
    )
  })

  it('restores only with --confirm and supports the null revision sentinel', async () => {
    const restored = profileDocument({
      revision: 'rev-backup',
      profile: { fullName: 'SECRET-NAME-CANARY', email: 'secret@example.com' },
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    vi.stubGlobal('fetch', fetchMock)

    const withoutConfirm = await runCli([
      'profile',
      'restore',
      '--workspace',
      'workspace-1',
      '--expected-revision',
      'null',
      '--json',
    ])
    expect(withoutConfirm.exitCode).toBe(1)
    expect(withoutConfirm.stderr).toContain('--confirm')
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(jsonResponse(restored))
    const withConfirm = await runCli([
      'profile',
      'restore',
      '--workspace',
      'workspace-1',
      '--expected-revision',
      'null',
      '--confirm',
      '--json',
    ])
    expect(withConfirm.exitCode).toBe(0)
    expect(JSON.parse(withConfirm.stdout)).toEqual({
      restored: true,
      schemaVersion: profileDocumentSchemaVersion,
      revision: 'rev-backup',
    })
    expect(withConfirm.stdout).not.toContain('SECRET-NAME-CANARY')
    expect(withConfirm.stdout).not.toContain('secret@example.com')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/profile/document/restore',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedRevision: null }),
      }),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse(restored))
    const humanRestore = await runCli([
      'profile',
      'restore',
      '--workspace',
      'workspace-1',
      '--expected-revision',
      'rev-1',
      '--confirm',
    ])
    expect(humanRestore.exitCode).toBe(0)
    expect(humanRestore.stdout).toContain('schemaVersion=1')
    expect(humanRestore.stdout).toContain('revision=rev-backup')
    expect(humanRestore.stdout).not.toContain('SECRET-NAME-CANARY')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      expectedRevision: 'rev-1',
    })
  })

  it('escapes hostile string path segments in human invalid_profile_document diagnostics', async () => {
    const hostileSegment = 'hostile\n  forged=line\u001b[31mRED[".`]'
    const path = ['profile', 0, hostileSegment] as const
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      documentErrorResponse('invalid_profile_document', {
        path: [...path],
        line: 4,
        column: 2,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['profile', 'get', '--workspace', 'workspace-1'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('invalid_profile_document')
    expect(result.stderr).toContain(
      `path=["profile"][0][${JSON.stringify(hostileSegment)}]`,
    )
    expect(result.stderr).not.toMatch(/(?:^|\n) {2}forged=line/)
    expect(result.stderr.includes('\n  forged=line')).toBe(false)
    expect(result.stderr.includes(String.fromCharCode(0x1b))).toBe(false)
    expect(result.stderr.includes('\r')).toBe(false)
    expect(result.stderr.includes('\t')).toBe(false)
    const diagnosticLines = result.stderr.trimEnd().split('\n')
    expect(diagnosticLines).toHaveLength(1)
    expect(diagnosticLines[0]).toContain('line=4')
    expect(diagnosticLines[0]).toContain('column=2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('formats invalid_profile_document with path and line/column in human and JSON modes', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      documentErrorResponse('invalid_profile_document', {
        path: ['profile', 'dateOfBirth'],
        line: 12,
        column: 5,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const human = await runCli(['profile', 'get', '--workspace', 'workspace-1'])
    expect(human.exitCode).toBe(1)
    expect(human.stderr).toContain('invalid_profile_document')
    expect(human.stderr).toContain('path=["profile"]["dateOfBirth"]')
    expect(human.stderr).toContain('line=12')
    expect(human.stderr).toContain('column=5')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce(
      documentErrorResponse('invalid_profile_document', {
        path: ['profile', 'email'],
        line: 3,
        column: 8,
      }),
    )
    const json = await runCli(['profile', 'get', '--workspace', 'workspace-1', '--json'])
    expect(json.exitCode).toBe(1)
    const payload = JSON.parse(json.stderr)
    expect(payload).toEqual({
      code: 'invalid_profile_document',
      message: profileDocumentErrorBodies.invalid_profile_document.message,
      path: ['profile', 'email'],
      line: 3,
      column: 8,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps each typed profile document error code without fallback requests', async () => {
    const cases = [
      'unsupported_profile_schema_version',
      'profile_revision_conflict',
      'profile_document_unavailable',
      'profile_backup_unavailable',
    ] as const

    for (const code of cases) {
      const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      fetchMock.mockResolvedValueOnce(documentErrorResponse(code))
      vi.stubGlobal('fetch', fetchMock)

      const command =
        code === 'profile_backup_unavailable'
          ? ([
              'profile',
              'restore',
              '--workspace',
              'workspace-1',
              '--expected-revision',
              'rev-1',
              '--confirm',
              '--json',
            ] as string[])
          : (['profile', 'get', '--workspace', 'workspace-1', '--json'] as string[])

      const result = await runCli(command)
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stderr)).toEqual({
        code,
        message: profileDocumentErrorBodies[code].message,
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/profile'))).toBe(false)
    }
  })

  it('sends a stale update exactly once and returns profile_revision_conflict', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-cli-profile-conflict-'))
    const profilePath = path.join(tempDirectory, 'profile.json')
    fs.writeFileSync(profilePath, JSON.stringify({ fullName: 'Sparxie' }))

    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(documentErrorResponse('profile_revision_conflict'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'profile',
      'update',
      '--workspace',
      'workspace-1',
      '--input-json',
      profilePath,
      '--expected-revision',
      'stale-rev',
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toEqual({
      code: 'profile_revision_conflict',
      message: profileDocumentErrorBodies.profile_revision_conflict.message,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not fall back to legacy profile reads after invalid or unavailable document errors', async () => {
    for (const code of ['invalid_profile_document', 'profile_document_unavailable'] as const) {
      const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      fetchMock.mockResolvedValueOnce(
        code === 'invalid_profile_document'
          ? documentErrorResponse(code, { path: ['profile'], line: 1, column: 1 })
          : documentErrorResponse(code),
      )
      vi.stubGlobal('fetch', fetchMock)

      const result = await runCli(['profile', 'get', '--workspace', 'workspace-1', '--json'])
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stderr).code).toBe(code)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/profile/document')
      expect(String(fetchMock.mock.calls[0]?.[0])).not.toMatch(/\/profile$/)
    }
  })

  it('removes profile sensitive from routing and help', async () => {
    const help = await runCli(['profile', '--help'])
    expect(help.exitCode).toBe(0)
    expect(help.stdout).not.toContain('sensitive')
    expect(help.stdout).toContain('validate')
    expect(help.stdout).toContain('format')
    expect(help.stdout).toContain('restore')
    expect(help.stdout).toContain('secrets')

    const obsolete = await runCli(['profile', 'sensitive', 'summary', '--workspace', 'workspace-1'])
    expect(obsolete.exitCode).toBe(1)
    expect(obsolete.stderr.toLowerCase()).toMatch(/sensitive|no command|unknown|not found|unrecognized/)
  })
})
