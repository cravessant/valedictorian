import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = process.cwd()

const sharedLifecycleTableDir = 'src/modules/lifecycle-table'
const aggregateModuleDirs = [
  'src/modules/capture',
  'src/modules/job',
  'src/modules/opportunity',
  'src/modules/applications',
] as const

const maintainedSourcePattern = /\.[cm]?tsx?$/
const testSourcePattern = /\.test\.[cm]?tsx?$/

function listFiles(dir: string): string[] {
  const abs = path.join(repositoryRoot, dir)
  if (!fs.existsSync(abs)) return []
  return fs
    .readdirSync(abs, { recursive: true, encoding: 'utf8' })
    .map((entry) => `${dir}/${String(entry).split(path.sep).join('/')}`)
    .filter((relativePath) => maintainedSourcePattern.test(relativePath) && !testSourcePattern.test(relativePath))
    .filter((relativePath) => fs.statSync(path.join(repositoryRoot, relativePath)).isFile())
}

describe('lifecycle-table source boundary', () => {
  it('owns the shared lifecycle table shell in one module', () => {
    const shared = listFiles(sharedLifecycleTableDir)
    const hasShell = shared.some((p) => p.endsWith('lifecycle-table.tsx'))
    expect(hasShell).toBe(true)
  })

  it('aggregate modules do not regrow standalone table shells (LifecycleTable export is forbidden there)', () => {
    const forbiddenExportPattern = /export\s+(?:const|function)\s+LifecycleTable\b/
    const forbiddenTableShellPattern = /<(?:table\b|Table(?:\b|Header|Body|Row|Head|Cell))/
    for (const dir of aggregateModuleDirs) {
      for (const file of listFiles(dir)) {
        const source = fs.readFileSync(path.join(repositoryRoot, file), 'utf8')
        if (forbiddenTableShellPattern.test(source)) {
          throw new Error(
            `${file}: aggregate module must not regrow a standalone table shell. Render through the shared LifecycleTable family instead.`,
          )
        }
        if (forbiddenExportPattern.test(source)) {
          throw new Error(
            `${file}: aggregate module must not export a LifecycleTable shell.`,
          )
        }
      }
    }
  })

  it('forbids aggregate-named table shells anywhere outside the shared family', () => {
    const aggregateTableDeclaration = /(?:const|function|class)\s+(?:Capture|Job|Opportunity|Application)\w*Table\b/
    const aggregateTableFile = /(?:capture|job|opportunity|application)[^/]*table\.[cm]?tsx?$/i
    for (const file of listFiles('src')) {
      if (file.startsWith(`${sharedLifecycleTableDir}/`)) continue
      const source = fs.readFileSync(path.join(repositoryRoot, file), 'utf8')
      if (aggregateTableFile.test(file) || aggregateTableDeclaration.test(source)) {
        throw new Error(
          `${file}: aggregate table shells must live in the shared LifecycleTable family.`,
        )
      }
    }
  })

  it('aggregate-owned columns and forms remain permitted inside the shared module configs', () => {
    const configsDir = path.join(repositoryRoot, sharedLifecycleTableDir, 'configs')
    expect(fs.existsSync(configsDir)).toBe(true)
    const configs = listFiles(`${sharedLifecycleTableDir}/configs`)
    expect(configs.length).toBeGreaterThanOrEqual(4)
    const names = configs.map((c) => path.basename(c))
    for (const expected of ['capture-config.tsx', 'job-config.ts', 'opportunity-config.ts', 'application-config.ts']) {
      expect(names).toContain(expected)
    }
  })
})
