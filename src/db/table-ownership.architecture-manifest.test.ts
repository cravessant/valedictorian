import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { lifecyclePhysicalTableOwnership, lifecycleTableOwnership } from './table-ownership'

interface StateOwnershipManifest {
  readonly owners: Record<string, { readonly kind: string, readonly module: string | null }>
  readonly tables: Record<
    string,
    { readonly owner: string, readonly schemaExport: string, readonly schemaModule: string }
  >
}

const manifest: StateOwnershipManifest = JSON.parse(
  fs.readFileSync(
    fileURLToPath(new URL('../../architecture/state-ownership.json', import.meta.url)),
    'utf8',
  ),
)

/**
 * `architecture/state-ownership.json` covers every table in the schema; the
 * lifecycle write-ownership manifest covers the journaled lifecycle aggregates and
 * is what `src/test/lifecycle-state-ownership.ts` enforces against writes. The
 * broader manifest must agree with the narrower one, or the two would name
 * different owners for the same table.
 */
describe('state-ownership manifest against lifecycle write ownership', () => {
  it('names the same owner as the lifecycle write manifest for every lifecycle table', () => {
    const byExport = new Map(
      Object.values(manifest.tables).map((entry) => [entry.schemaExport, entry.owner]),
    )
    const disagreements = Object.entries(lifecycleTableOwnership).filter(
      ([schemaExport, owner]) => byExport.get(schemaExport) !== owner,
    )

    expect(disagreements).toEqual([])
  })

  it('names the same owner as the lifecycle physical-table manifest', () => {
    const disagreements = Object.entries(lifecyclePhysicalTableOwnership).filter(
      ([table, owner]) => manifest.tables[table]?.owner !== owner,
    )

    expect(disagreements).toEqual([])
  })

  it('resolves every lifecycle owner to a declared capability owner', () => {
    const owners = [...new Set(Object.values(lifecycleTableOwnership))]

    expect(owners.filter((owner) => manifest.owners[owner]?.kind !== 'capability')).toEqual([])
  })
})
