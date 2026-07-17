import { describe, expect, it } from 'vitest'
import { requiresRestart } from './requiresRestart'

describe('requiresRestart for API token mutations', () => {
  it('requires restart when the write-only apiToken patch is present', () => {
    expect(requiresRestart({ apiToken: 'new-token' })).toBe(true)
    expect(requiresRestart({ apiToken: '' })).toBe(true)
    expect(requiresRestart({ sidebarCollapsed: true })).toBe(false)
  })
})
