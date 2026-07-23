import { describe, expect, it } from 'vitest'
import config, { maintainedTestIncludes } from '../../vite.config'

describe('test discovery configuration', () => {
  it('limits discovery to maintained test roots', () => {
    expect(config.test?.include).toEqual(maintainedTestIncludes)
    expect(maintainedTestIncludes).toEqual([
      'electron/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{ts,mjs}',
      'src/**/*.test.{ts,tsx}',
    ])
  })
})
