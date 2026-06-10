import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('CLI entrypoint', () => {
  it('uses a node executable entrypoint for npm global installs', () => {
    const source = fs.readFileSync(path.resolve('src/valedictorian.ts'), 'utf8')

    expect(source).toContain('#!/usr/bin/env node')
    expect(source).toContain('runValedictorianCli')
    expect(source).toContain('process.argv.slice(2)')
  })
})
