import path from 'node:path'

import { findModuleGraphViolations } from './architecture-module-graph-rules.mjs'
import { findPublicSurfaceViolations } from './architecture-public-surface-rules.mjs'
import { findStateOwnershipViolations } from './architecture-state-ownership-rules.mjs'
import { scanMaintainedSource } from './architecture-state-resolution.mjs'

/**
 * Mechanical architecture enforcement (issues #326 and #327).
 *
 * `module-public-surface-bypass` (issue #327) holds the other half of the
 * boundary: production server and runtime composition reaches a capability only
 * through its exact `packages/local-runtime/src/modules/<module>/public.ts` surface; that surface's whole
 * dependency closure reaches no runtime, server, IPC, or Electron edge; it
 * publishes its own module and no other; and it names every export explicitly. Its
 * scope, spellings, and refusals are described in
 * architecture-public-surface-rules.mjs. It needs no manifest — the convention is
 * the contract, so there is nothing to keep in step.
 *
 * `architecture/state-ownership.json` names one owner for every `pgTable` export.
 * `architecture/module-graph.json` records the exact directed capability edges and,
 * for every reach into state a maintained file makes, exactly one entry:
 *
 *   - `exceptions` are transitional. Each relaxes a named rule and names an issue
 *     that will actually remove the access. The issue must be one the manifest
 *     declares, so an invented retirement claim is refused.
 *   - `permissions` are stable architectural facts and carry no retiring issue:
 *     the canonical Drizzle aggregate composing owned tables, the registrar handing
 *     that aggregate to the client, a schema file naming a foreign-key target, the
 *     platform ownership root, a cross-capability state access, and a maintained
 *     test state access. Each purpose is bound to a mechanical predicate on the
 *     path, and each claims no more than #326 can prove: no read-only or
 *     arrangement semantics are asserted. A retiring issue may only be named where
 *     its own contract reaches.
 *
 * Both sets are exact source, target, and table; both are shape-checked, stamped,
 * de-globbed, and rejected when stale. Neither is an ignore list: an access no
 * entry covers fails, and an entry no access supports fails.
 *
 * Reading is syntax aware. `oxc-parser` reduces each TypeScript or TSX file to its
 * module declarations without touching a specifier, `es-module-lexer` is the
 * authoritative inventory of those declarations, and the two are cross-checked.
 * Attribution is by physical table identity through aliases, destructuring, member
 * access, spreads, computed keys, nested aggregates, and barrels of any depth. The
 * Drizzle table constructor is resolved from `drizzle-orm/pg-core` through named
 * aliases, namespace members, and local alias chains.
 *
 * Everything unresolvable fails closed and by name: `unlexable-module-source` for a
 * file that will not read whole, `computed-module-import` for a dynamic specifier
 * that cannot be read, `opaque-table-declaration` for a constructor that is
 * transported, wrapped, or invoked indirectly rather than called directly with a
 * literal name or bound to a named export, `duplicate-state-declaration` for a
 * physical name or export identity declared twice, and `opaque-state-import` for a
 * namespace, star, default, bare, or dynamic reach into a state-providing module.
 *
 * The enforced boundary is deliberately the one #326 names: table declarations,
 * the directed module graph, and foreign table imports. Once an exact import or
 * re-export has been observed and recorded, the check stops. It does not follow a
 * table through function returns, classes, calls, containers, mutations, or
 * third-party APIs; a value produced at runtime is not a module import, and
 * modelling it would be neither sound nor bounded.
 *
 * State ownership is checked across every maintained file under `src`. There is no
 * test, fixture, helper, or harness exemption, no ignore glob, no threshold, and no
 * configurable exclusion; only the directed capability edge inventory is scoped to
 * production module source, which is what that inventory describes.
 *
 * Every violation names its rule in leading brackets, and the report is sorted, so
 * the same tree always produces the same output.
 */

/** @returns {string} */
function readRootArgument() {
  const index = process.argv.indexOf('--root')
  if (index === -1) return process.cwd()
  const root = process.argv[index + 1]
  if (!root) throw new Error('--root requires a path')
  return path.resolve(root)
}

const root = readRootArgument()
const scan = scanMaintainedSource(root)
const violations = [
  ...scan.failures,
  ...findStateOwnershipViolations(root, scan),
  ...findModuleGraphViolations(root, scan),
  ...findPublicSurfaceViolations(root, scan),
].sort()
for (const violation of violations) process.stderr.write(`${violation}\n`)
if (violations.length > 0) process.exitCode = 1
