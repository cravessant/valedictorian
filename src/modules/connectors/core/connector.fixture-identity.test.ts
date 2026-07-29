import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const staleConnectorFixturePatterns = [
  ['Intern', 'List'].join(''),
  ['intern', 'list'].join(''),
  ['intern', 'list'].join('-'),
]

describe('connector fixture identity', () => {
  it('does not present the public discovery probe as an app connector fixture', () => {
    const matches = readSourceFiles(path.resolve('src')).flatMap(({ filePath, text }) =>
      staleConnectorFixturePatterns
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path.relative(process.cwd(), filePath)}:${pattern}`),
    )

    expect(matches).toEqual([])
  })
})

function readSourceFiles(directory: string): Array<{ filePath: string; text: string }> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        return readSourceFiles(entryPath)
      }

      if (
        !entry.isFile() ||
        !/\.(ts|tsx)$/.test(entry.name) ||
        entry.name === 'connector.fixture-identity.test.ts'
      ) {
        return []
      }

      return {
        filePath: entryPath,
        text: fs.readFileSync(entryPath, 'utf8'),
      }
    })
}
