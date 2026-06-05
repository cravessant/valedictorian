import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('SDK contract boundary', () => {
  it('re-exports application DTOs from job-app-sdk instead of redefining public contracts', () => {
    const source = fs.readFileSync(
      path.resolve('src/modules/applications/application.types.ts'),
      'utf8',
    )

    expect(source).toContain("from 'job-app-sdk'")
    expect(source).not.toContain('export const applicationStatuses = [')
    expect(source).not.toContain('export interface ApplicationListQuery')
  })

  it('uses the SDK score input type for local scoring repositories', () => {
    const source = fs.readFileSync(path.resolve('src/modules/scoring/scoring.repository.ts'), 'utf8')

    expect(source).toContain("import type { ScoreInput } from 'job-app-sdk'")
    expect(source).not.toContain('export interface ScoreInput')
  })
})
