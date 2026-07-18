import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('theme cascade contract', () => {
  it('keeps the global border reset below utility classes', () => {
    const stylesheet = fs.readFileSync(path.resolve('src/index.css'), 'utf8')

    expect(stylesheet).toMatch(
      /@layer base\s*{\s*\*\s*{[^}]*border-color:\s*var\(--border\);[^}]*}/,
    )
  })
})
