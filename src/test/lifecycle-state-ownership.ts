import { lifecyclePhysicalTableOwnership, lifecycleTableOwnership } from '../db/table-ownership'

/**
 * Mechanical state-ownership enforcement for the journaled lifecycle schema
 * (issue #298, acceptance criterion 8).
 *
 * A lifecycle aggregate's state may only be mutated by its owning module. This
 * scanner flags a write when the writer module is not the owner, across every
 * evasion path:
 *   - Drizzle query builder: `x.insert/update/delete(table)`, with `as` aliases
 *     (`import { jobs as x }`) and namespace access (`schema.jobs`) resolved;
 *   - dynamic table access inside a write call (`schema['jobs']`, `schema[expr]`),
 *     which cannot be statically resolved and is therefore flagged conservatively;
 *   - raw SQL DML (`insert into <t>`, `update <t> set`, `delete from <t>`) in a
 *     sql-template or execute string, matched against the physical table names
 *     (legacy and canonical).
 *
 * Known limit: a computed/interpolated physical table name in raw SQL (a
 * string-concatenated or template-substituted table name) is not detected, since
 * the literal name never appears in source. Evading the rule that way requires
 * deliberate obfuscation, which code review catches; this is an accepted gap.
 *
 * A direct table write is ALWAYS a cross-module violation when the writer is not
 * the owner — there is no orchestrator exemption. The transaction-owning lifecycle
 * orchestration composes the aggregates' public repositories (method calls, which
 * this scanner does not flag); it never writes another module's tables directly.
 */
export interface OwnershipSourceFile {
  readonly path: string
  readonly module: string | null
  readonly source: string
}

/**
 * Test-infrastructure helpers exempted from the write rule ONLY because nothing
 * in production imports them. If a production module imports one, remove it here
 * and route the write through the owning module's repository instead.
 */
export const testInfrastructureAllowlist: ReadonlySet<string> = new Set([
  'src/modules/sourcing/canonical-candidate.projection.pglite-test-helpers.ts',
])

const writeCallPattern = /\.(?:insert|update|delete)\(\s*([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\s*\)/g
const dynamicWritePattern = /\.(?:insert|update|delete)\(\s*[A-Za-z_$][\w$]*\s*\[/g
const rawInsertPattern = /\binsert\s+into\s+"?([a-z_][a-z0-9_]*)"?/gi
const rawUpdatePattern = /\bupdate\s+"?([a-z_][a-z0-9_]*)"?\s+set\b/gi
const rawDeletePattern = /\bdelete\s+from\s+"?([a-z_][a-z0-9_]*)"?/gi
const namedImportPattern = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"][^'"]+['"]/g

export function moduleForPath(filePath: string): string | null {
  const normalized = filePath.split('\\').join('/')
  const match = normalized.match(/(?:^|\/)src\/modules\/([^/]+)\//)
  return match?.[1] ?? null
}

/** Map local binding name -> lifecycle table identifier, resolving `as` aliases. */
function lifecycleImportBindings(source: string): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const match of source.matchAll(namedImportPattern)) {
    for (const raw of (match[1] ?? '').split(',')) {
      const parts = raw.trim().split(/\s+as\s+/)
      const original = parts[0]?.trim()
      const local = (parts[1] ?? parts[0])?.trim()
      if (original && local && original in lifecycleTableOwnership) {
        bindings.set(local, original)
      }
    }
  }
  return bindings
}

export function findLifecycleStateOwnershipViolations(
  files: readonly OwnershipSourceFile[],
): string[] {
  const ownership = lifecycleTableOwnership as Record<string, string>
  const physicalOwnership = lifecyclePhysicalTableOwnership as Record<string, string>
  const violations: string[] = []

  for (const file of files) {
    if (testInfrastructureAllowlist.has(file.path)) continue
    const writerModule = file.module ?? moduleForPath(file.path)
    const bindings = lifecycleImportBindings(file.source)
    const report = (table: string, owner: string, kind: string) => {
      if (owner === writerModule) return
      violations.push(
        `${file.path}: ${kind} '${table}' owned by module '${owner}' `
          + `from writer module '${writerModule ?? 'none'}'`,
      )
    }

    // Drizzle query-builder writes: `x.insert(table)` / `x.insert(schema.table)`.
    for (const match of file.source.matchAll(writeCallPattern)) {
      const head = match[1]
      const property = match[2]
      const table = property && property in ownership
        ? property
        : head && (bindings.get(head) ?? (head in ownership ? head : undefined))
      if (table) report(table, ownership[table]!, 'writes lifecycle table')
    }

    // Dynamic table access inside a write call cannot be resolved; flag it.
    if (dynamicWritePattern.test(file.source)) {
      violations.push(
        `${file.path}: dynamic table access inside a write call cannot be statically `
          + `resolved and is forbidden (writer module '${writerModule ?? 'none'}')`,
      )
    }

    // Raw-SQL DML against a physical lifecycle table name.
    for (const [pattern, verb] of [
      [rawInsertPattern, 'raw-SQL insert into'],
      [rawUpdatePattern, 'raw-SQL update of'],
      [rawDeletePattern, 'raw-SQL delete from'],
    ] as const) {
      for (const match of file.source.matchAll(pattern)) {
        const physical = match[1]
        if (physical && physical in physicalOwnership) {
          report(physical, physicalOwnership[physical]!, verb)
        }
      }
    }
  }

  return [...new Set(violations)].sort()
}
