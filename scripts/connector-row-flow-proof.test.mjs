import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const proofScript = path.join(repositoryRoot, 'scripts/connector-row-flow-proof.mjs')
const surfacePath = path.join(repositoryRoot, 'src/modules/connectors/public.ts')
const original = fs.readFileSync(surfacePath, 'utf8')

/** @returns {{ status: number, stdout: string, stderr: string }} */
function runProof() {
  const result = execFileSync(process.execPath, [proofScript], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  return { status: 0, stdout: result, stderr: '' }
}

/** @param {string} line @returns {{ status: number, stderr: string }} */
function runWithSurfaceLine(line) {
  fs.writeFileSync(surfacePath, `${original}${line}\n`)
  try {
    runProof()
    return { status: 0, stderr: '' }
  } catch (error) {
    const failure = /** @type {{ status: number, stderr: string, stdout: string }} */ (error)
    return { status: failure.status, stderr: failure.stderr || failure.stdout }
  }
}

afterEach(() => {
  fs.writeFileSync(surfacePath, original)
})

describe('connector persistence row flow', () => {
  it('accepts the checked-in connectors public surface', () => {
    const result = runProof()

    expect(result.stdout).toContain('0 persistence-row violation(s)')
  })

  it('rejects re-exporting the repository factory', () => {
    const result = runWithSurfaceLine(
      "export { createPgliteConnectorRepository } from './adapters/persistence/connector.repository'",
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[connector-persistence-row-flow] public:createPgliteConnectorRepository reaches createPgliteConnectorRepository; the connectors public surface hands out no repository and no persistence row\n',
    )
  })

  it.each([
    ['an instance projection', 'mapConnectorInstanceSummary', './core/connector.instance-projection', 'ConnectorInstanceRecord'],
    ['a run projection', 'mapConnectorRunSummary', './core/connector.run-record.projection', 'ConnectorRunRecord'],
    ['a checkpoint projection', 'mapConnectorCheckpoint', './core/connector.run-record.projection', 'ConnectorCheckpointRecord'],
    ['an observation projection', 'mapConnectorObservation', './core/connector.run-record.projection', 'ConnectorObservationRecord'],
    ['an overview projection', 'mapLocalConnectorOverviewRecord', './core/connector.overview-projection', 'ConnectorStatusSummaryRecord'],
  ])('rejects %s that accepts a row without naming its type', (_label, name, specifier, row) => {
    const result = runWithSurfaceLine(`export { ${name} } from '${specifier}'`)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[connector-persistence-row-flow]')
    expect(result.stderr).toContain(`reaches ports/connector.repository.port.${row}`)
  })

  it('rejects a renamed repository factory', () => {
    const result = runWithSurfaceLine(
      "export { createPgliteConnectorRepository as createConnectorStore } from './adapters/persistence/connector.repository'",
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[connector-persistence-row-flow]')
  })

  it('rejects a facade whose row parameter is only inferred', () => {
    const result = runWithSurfaceLine(
      "export { createConnectorRunner } from './adapters/connector.runner'",
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[connector-persistence-row-flow]')
  })
})
