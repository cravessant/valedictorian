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

  it('uses Node ESM-compatible relative import specifiers in packaged source files', () => {
    const sourceDirectory = path.resolve('src')
    const sourceFiles = fs
      .readdirSync(sourceDirectory)
      .filter((fileName) => fileName.endsWith('.ts'))
      .filter((fileName) => !fileName.endsWith('.test.ts'))
      .filter((fileName) => !fileName.endsWith('.test-helpers.ts'))

    const extensionlessImports = sourceFiles.flatMap((fileName) => {
      const source = fs.readFileSync(path.join(sourceDirectory, fileName), 'utf8')

      return [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)]
        .map((match) => match[1])
        .filter((specifier) => !specifier.endsWith('.js'))
        .map((specifier) => `${fileName}: ${specifier}`)
    })

    expect(extensionlessImports).toEqual([])
  })
})
