import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultApplicationLoader } from './loaders'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}

describe('renderer HTTP loaders', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
  })

  it('loads applications through the workspace-scoped HTTP client when configured', async () => {
    const payload = { hasMore: false, items: [], limit: 1, offset: 0, total: 0 }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)
    ;(window as Window & {
      valedictorianHttp?: { apiBaseUrl: string; workspaceId: string }
    }).valedictorianHttp = {
      apiBaseUrl: 'https://valedictorian.test',
      workspaceId: 'workspace-1',
    }

    await expect(defaultApplicationLoader({ limit: 1 })).resolves.toEqual(payload)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?limit=1',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
