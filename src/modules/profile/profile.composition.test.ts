import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createJsonProfileService, createSqliteProfileService } from './profile.composition'

describe('profile composition', () => {
  it('exports an inactive JSON profile service factory beside the active SQLite factory', () => {
    expect(createJsonProfileService).toEqual(expect.any(Function))
    expect(createSqliteProfileService).toEqual(expect.any(Function))
  })

  it('keeps the local runtime composition on SQLite', () => {
    const source = fs.readFileSync(
      new URL('../../runtime/local-valedictorian-client.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain('createSqliteProfileService')
    expect(source).not.toContain('createJsonProfileService')
  })
})
