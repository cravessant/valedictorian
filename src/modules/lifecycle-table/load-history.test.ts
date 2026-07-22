import { describe, expect, it, vi } from 'vitest'

import { loadHistory } from './load-history'

describe('loadHistory', () => {
  it('follows every cursor and preserves entry order', async () => {
    const loadPage = vi.fn()
      .mockResolvedValueOnce({ items: ['first'], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ items: ['second'], nextCursor: null })

    await expect(loadHistory(loadPage)).resolves.toEqual(['first', 'second'])
    expect(loadPage).toHaveBeenNthCalledWith(1, undefined)
    expect(loadPage).toHaveBeenNthCalledWith(2, 'page-2')
  })

  it('rejects a repeated cursor instead of looping forever', async () => {
    const loadPage = vi.fn(async () => ({ items: [], nextCursor: 'same' }))
    await expect(loadHistory(loadPage)).rejects.toThrow('repeated cursor')
  })
})
