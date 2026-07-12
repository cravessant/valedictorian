import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, runCli } from './valedictorian-cli.test-helpers'

describe('sourcing queue commands', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps list, decide, update, and promote workspace-scoped', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, limit: 25, offset: 0, hasMore: false }))
    fetchMock.mockResolvedValueOnce(jsonResponse(finding('blocked')))
    fetchMock.mockResolvedValueOnce(jsonResponse(finding('not_fit')))
    fetchMock.mockResolvedValueOnce(jsonResponse(finding('merged')))
    vi.stubGlobal('fetch', fetchMock)

    expect((await runCli(['sourcing', 'findings', 'list', '--workspace', 'workspace-1', '--json'])).exitCode).toBe(0)
    expect((await runCli(['sourcing', 'findings', 'decide', 'finding-1', '--merge-status', 'blocked', '--workspace', 'workspace-1', '--json'])).exitCode).toBe(0)
    expect((await runCli(['sourcing', 'findings', 'update', 'finding-1', '--merge-status', 'not_fit', '--workspace', 'workspace-1', '--json'])).exitCode).toBe(0)
    expect((await runCli(['sourcing', 'findings', 'promote', 'finding-1', '--workspace', 'workspace-1', '--json'])).exitCode).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings',
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings/finding-1/decide',
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings/finding-1',
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings/finding-1/promote',
    ])
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ mergeStatus: 'blocked' })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ mergeStatus: 'not_fit' })
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({})
  })

  it.each([
    ['run', '--candidates-json', '[]'],
    ['findings', 'create'],
    ['findings', 'import', '--input-json', 'findings.json'],
  ])('removes the old producer path: sourcing %s', async (...args) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await runCli(['sourcing', ...args, '--workspace', 'workspace-1'])
    expect(result.exitCode).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function finding(mergeStatus: string) {
  return {
    id: 'finding-1', workflowRunId: 'run-1', sourceId: 'source-1', sourceName: 'Source',
    companyName: 'Example', roleTitle: 'Engineer', roleKind: 'full_time', term: null, terms: [],
    timingMode: 'unknown', startDate: null, endDate: null, city: null, region: null, country: null,
    workMode: 'unclear', locationRaw: null, officialUrl: null, sourceUrl: null, postedAge: null,
    priorityScore: null, priorityBand: null, fitNotes: null, duplicateNotes: null, blocker: null,
    policyBlocker: null, dispositionReason: null, mergeStatus, mergedApplicationId: null,
    mergedApplicationCompanyName: null, mergedApplicationRoleTitle: null, mergeNotes: null,
    discoveredAt: '2026-07-12T12:00:00.000Z', createdAt: '2026-07-12T12:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z',
  }
}
