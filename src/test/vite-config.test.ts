// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { nativeMainExternals } from '../../vite.config'

describe('Vite Electron config', () => {
  it('keeps native SQLite modules external to the Electron main bundle', () => {
    expect(nativeMainExternals).toContain('better-sqlite3')
  })
})
