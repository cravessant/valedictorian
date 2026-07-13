import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const obsoleteTerms = [
  ['useful', 'Target'].join(''),
  ['requested', 'JobCount'].join(''),
  ['max', 'Links'].join(''),
  ['remaining', 'Target'].join(''),
  ['max', 'ResolutionCount'].join(''),
  ['max', 'RequestsPerRun'].join(''),
  ['role', 'Terms'].join(''),
  ['partial', '_success'].join(''),
  ['browser', '_session'].join(''),
  ['browser', '_session_action_required'].join(''),
  ['uses', 'BrowserSession'].join(''),
  ['browser', 'Sessions'].join(''),
  ['createRun', 'BrowserSessionRuntime'].join(''),
  ['createUnavailable', 'BrowserSessionRuntime'].join(''),
  ['preflight', 'BrowserSessionAuth'].join(''),
  ['legacy', 'BrowserSessionReferences'].join(''),
  ['session', 'Key'].join(''),
  ['politeness', ':'].join(''),
  ['AppConnectorRun', 'Budget'].join(''),
  ['AppConnectorRun', 'Policy'].join(''),
  ['budgetFrom', 'Politeness'].join(''),
  ['budget?', ':'].join(''),
] as const

describe('released connector contract fixtures', () => {
  it('keeps obsolete vocabulary only in migration inputs and explicit negative-boundary tests', () => {
    const violations: string[] = []
    for (const root of ['src', 'electron']) {
      for (const file of sourceFiles(path.resolve(root))) {
        const relative = root === 'src'
          ? path.relative(path.resolve(root), file)
          : `${root}/${path.relative(path.resolve(root), file)}`
        const source = fs.readFileSync(file, 'utf8')
        for (const term of obsoleteTerms) {
          if (source.includes(term)) violations.push(`${relative}: ${term}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(target)
    return /\.tsx?$/.test(entry.name) && entry.name !== path.basename(import.meta.filename) ? [target] : []
  })
}
