import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  slowTestBoundaryInventory,
  testBoundaryDeletions,
  testBoundaryMoves,
} from './slow-test-boundary-inventory'
import {
  assignDurationBalancedShards,
  CI_TEST_SHARD_CAPACITIES,
  testWeightForPath,
} from './duration-balanced-shards'
import {
  highCostCaseAudit,
  testProofAuditRegistry,
} from './test-proof-audit-registry'

const repositoryRoot = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
}

function countTests(source: string) {
  return [...source.matchAll(/\bit(?:\.each\([^)]*\))?\s*\(/g)].length
}

function listTestFiles() {
  return ['electron', 'scripts', 'src'].flatMap((directory) => {
    const absoluteDirectory = path.join(repositoryRoot, directory)
    if (!fs.existsSync(absoluteDirectory)) return []
    return fs.readdirSync(absoluteDirectory, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
      .map((file) => path.join(directory, file).split(path.sep).join('/'))
  })
}

describe('test pyramid policy', () => {
  it('keeps schedule validation matrices below the full App boundary', () => {
    const appSuite = read('src/App.connectors.schedules.test.tsx')
    const helperSuite = read('src/settings/connector-schedule.helpers.test.ts')

    expect(countTests(appSuite)).toBeLessThanOrEqual(2)
    expect(helperSuite).toContain('validates interval boundaries without rendering React')
    expect(helperSuite).toContain('maps custom daily and weekly drafts to canonical cadence')
    expect(helperSuite).toContain('filters unsupported schedule modes and presets')
    expect(helperSuite).toContain('preserves a valid persisted IANA timezone alias')
    expect(appSuite).toContain(
      'keeps cards manual-only with an unavailable-scheduler explanation and never loads schedules',
    )
    expect(appSuite).toContain(
      'ignores late schedule responses after workspace identity changes',
    )
    expect(appSuite).not.toContain(
      'creates and reloads a preset schedule across two complete App mounts',
    )
    expect(appSuite).not.toContain(
      'pauses and resumes using returned revisions and shows last schedule outcomes',
    )
  })

  it('keeps connector refresh validation below the PGlite boundary', () => {
    const integrationSuite = read(
      'src/modules/connectors/connector.runner.refresh-contract.test.ts',
    )
    const unitSuite = read(
      'src/modules/connectors/connector.runner.refresh-contract.unit.test.ts',
    )
    const validator = read(
      'src/modules/connectors/connector.runner.refresh-contract.ts',
    )

    expect(countTests(integrationSuite)).toBeLessThanOrEqual(4)
    expect(unitSuite).toContain('rejects invalid envelope or operation case')
    expect(unitSuite).toContain('rejects mismatched operation and synchronization evidence')
    expect(validator).not.toMatch(/PGlite|connector\.repository/)
  })

  it('keeps provider lifecycle reconciliation matrices below the PGlite boundary', () => {
    const integrationSuite = read(
      'src/modules/connectors/connector.lifecycle-counts.test.ts',
    )
    const unitSuite = read(
      'src/modules/connectors/connector.lifecycle-counts.provider.unit.test.ts',
    )
    const classifier = read('src/modules/connectors/connector.lifecycle-counts.ts')

    expect(countTests(integrationSuite)).toBeLessThanOrEqual(8)
    expect(unitSuite).toContain('keeps %s returned rows unknown')
    expect(unitSuite).toContain('never reports reconciled for %s')
    expect(classifier).toContain('export function reconcileProviderLifecycleCounts')
  })

  it('keeps deterministic normalization fact matrices below the runtime boundary', () => {
    const runtimeSuite = read(
      'src/runtime/raw-normalization.runtime.projection-resolvers.test.ts',
    )
    const factSuite = read(
      'src/modules/sourcing/normalization.registry.facts.test.ts',
    )

    expect(runtimeSuite).not.toContain('normalizePayload(')
    expect(factSuite).toContain('normalizes postedAt without constructing PGlite')
    expect(factSuite).toContain('normalizes compensation without constructing PGlite')
  })

  it('keeps canonical-field validation matrices below the PGlite runtime boundary', () => {
    const runtimeSuite = read(
      'src/runtime/raw-normalization.runtime.projection-resolvers.test.ts',
    )
    const unitSuite = read(
      'src/modules/sourcing/normalization.canonical-field-contract.unit.test.ts',
    )
    const validator = read('src/modules/sourcing/normalization.orchestrator.ts')

    expect(countTests(runtimeSuite)).toBeLessThanOrEqual(25)
    expect(unitSuite).toContain('rejects out-of-contract canonical field values')
    expect(unitSuite).toContain('accepts bounded canonical field values')
    expect(validator).toContain('export function isValidCanonicalFieldValue')
  })

  it('keeps generic request-body limit matrices below the PGlite HTTP boundary', () => {
    const ledgerSuite = read('src/server/raw-source-ledger.http.test.ts')
    const bodyLimitSuite = read('src/server/local-server.http.unit.test.ts')
    const inputLimitSuite = read('src/modules/sourcing/raw-source.validation.unit.test.ts')
    const routes = read('src/server/local-server.routes.ts')
    const repository = read('src/modules/sourcing/raw-source.repository.ts')

    expect(countTests(ledgerSuite)).toBeLessThanOrEqual(16)
    expect(bodyLimitSuite).toContain('rejects a declared oversized body before parsing')
    expect(bodyLimitSuite).toContain('rejects accumulated bytes with the route-specific message')
    expect(bodyLimitSuite).toContain('rejects a declared 2MiB body before accumulation')
    expect(bodyLimitSuite).toContain('rejects an accumulated 2MiB body with the fixed oversized mapping')
    expect(bodyLimitSuite).toContain(
      'maps the released replay body limit to the fixed HTTP 413 response',
    )
    expect(inputLimitSuite).toContain('accepts a payload at the released JSON-byte limit')
    expect(inputLimitSuite).toContain('rejects %s with the released validation error')
    expect(inputLimitSuite).toContain(
      'rejects credential-bearing HTTP URLs throughout raw envelopes',
    )
    expect(ledgerSuite).toContain(
      'maps one credential-bearing URL rejection without leaking or partial persistence',
    )
    expect(ledgerSuite).not.toContain('const unsafeEnvelopes =')
    expect(repository).toContain('export function validateRawSourceBatchInput')
    expect(routes).toContain('maxBytes: MAX_RAW_SOURCE_BATCH_BODY_BYTES')
    expect(routes).toContain('maxBytes: MAX_RAW_SOURCE_REPLAY_BODY_BYTES')
  })

  it('keeps profile interaction matrices below the full App boundary', () => {
    const appSuite = read('src/App.settings.profile-settings.test.tsx')
    const componentSuite = read(
      'src/modules/profile/ProfileSettingsPanel.test.tsx',
    )
    const component = read('src/modules/profile/ProfileSettingsPanel.tsx')

    expect(countTests(appSuite)).toBeLessThanOrEqual(1)
    expect(countTests(componentSuite)).toBeGreaterThanOrEqual(10)
    expect(component).toContain('export { ProfileSettingsPanel }')
  })

  it('keeps connector-run lookup outcomes below the full App boundary', () => {
    const appSuite = read('src/App.settings.connector-run-deep-links.test.tsx')
    const lookupSuite = read('src/settings/ConnectorRunsPanel.focus.unit.test.ts')

    expect(countTests(appSuite)).toBeLessThanOrEqual(1)
    expect(lookupSuite).toContain('finds a supplied run on a later page')
    expect(lookupSuite).toContain('returns not-found only after available history is exhausted')
    expect(lookupSuite).toContain('reports the search limit while older history remains')
  })

  it('classifies every greater-than-ten-second hosted baseline file', () => {
    expect(slowTestBoundaryInventory).toHaveLength(75)
    expect(new Set(slowTestBoundaryInventory.map(({ path: file }) => file)).size).toBe(75)
    for (const entry of slowTestBoundaryInventory) {
      expect(entry.hostedDurationMs).toBeGreaterThan(10_000)
      expect(entry.proof.length).toBeGreaterThan(3)
      const absolutePath = path.join(repositoryRoot, entry.path)
      if (fs.existsSync(absolutePath)) continue
      const move = testBoundaryMoves.find(({ source }) => source === entry.path)
      expect(entry.disposition, entry.path).toBe('consolidated')
      expect(move, entry.path).toBeDefined()
      expect(move!.maxSourceTests, entry.path).toBe(0)
    }
  })

  it('forbids unresolved consolidate dispositions across the #295 inventory', () => {
    const lingering = slowTestBoundaryInventory.filter(
      ({ disposition }) => disposition === 'consolidate',
    )
    expect(lingering).toEqual([])
  })

  it('maps consolidated integration proofs and enforces their retained budgets', () => {
    expect(testBoundaryMoves.length).toBeGreaterThanOrEqual(4)
    for (const move of testBoundaryMoves) {
      const absoluteSource = path.join(repositoryRoot, move.source)
      if (fs.existsSync(absoluteSource)) {
        expect(countTests(read(move.source))).toBeLessThanOrEqual(move.maxSourceTests)
      } else {
        expect(move.maxSourceTests).toBe(0)
      }
      expect(move.movedProofs.length).toBeGreaterThan(0)
      expect(move.retainedProofs.length).toBeGreaterThan(0)
      for (const target of move.targets) {
        expect(fs.existsSync(path.join(repositoryRoot, target))).toBe(true)
      }
    }
  })

  it('requires verified #295 inventory dispositions for the seven case-audited suites', () => {
    const requiredPaths = [
      'src/server/raw-source-ledger.http.test.ts',
      'src/server/local-server.domain-routes.test.ts',
      'src/modules/sourcing/provider-url-resolution.executor.test.ts',
      'src/modules/connectors/connector.runner.auth-catchup.test.ts',
      'src/modules/connectors/connector.runner.budgets-validate-auth.test.ts',
      'src/modules/source-execution/source-session-executor.test.ts',
      'src/modules/sourcing/sourcing.processor.test.ts',
    ] as const

    for (const requiredPath of requiredPaths) {
      const entry = slowTestBoundaryInventory.find(({ path: file }) => file === requiredPath)
      expect(entry, requiredPath).toBeDefined()
      expect(entry!.disposition, requiredPath).not.toBe('consolidate')
    }
  })

  it('requires verified #295 inventory dispositions for the three React App consolidation suites', () => {
    const requiredPaths = [
      'src/App.applications-views.test.tsx',
      'src/App.sourcing-filters-table.test.tsx',
      'src/App.sourcing-normalization.test.tsx',
    ] as const

    for (const requiredPath of requiredPaths) {
      const entry = slowTestBoundaryInventory.find(({ path: file }) => file === requiredPath)
      expect(entry, requiredPath).toBeDefined()
      expect(entry!.disposition, requiredPath).not.toBe('consolidate')
      expect(entry!.lowestSufficientBoundary, requiredPath).toBe('component')
    }
  })

  it('requires verified #295 inventory dispositions for the four connector settings suites', () => {
    const required = [
      {
        path: 'src/App.settings.connector-run-deep-links.test.tsx',
        disposition: 'consolidated',
        lowestSufficientBoundary: 'component',
      },
      {
        path: 'src/App.settings.connector-instance-applicability.test.tsx',
        disposition: 'consolidated',
        lowestSufficientBoundary: 'component',
      },
      {
        path: 'src/App.settings.jobright-execution.test.tsx',
        disposition: 'consolidated',
        lowestSufficientBoundary: 'component',
      },
      {
        path: 'src/App.settings.jobright-configuration.test.tsx',
        disposition: 'consolidated',
        lowestSufficientBoundary: 'component',
      },
    ] as const

    for (const expected of required) {
      const entry = slowTestBoundaryInventory.find(({ path: file }) => file === expected.path)
      expect(entry, expected.path).toBeDefined()
      expect(entry!.disposition, expected.path).toBe(expected.disposition)
      expect(entry!.lowestSufficientBoundary, expected.path).toBe(
        expected.lowestSufficientBoundary,
      )
    }
  })

  it('keeps connector instance applicability matrices below the full App boundary', () => {
    const appSuite = read('src/App.settings.connector-instance-applicability.test.tsx')
    const componentSuite = read(
      'src/settings/ConnectorSettingsPanel.instance-applicability.test.tsx',
    )

    expect(countTests(appSuite)).toBeLessThanOrEqual(3)
    expect(appSuite).toContain(
      're-enables Add after remove and creates a fresh Jobright without stale already-configured state',
    )
    expect(componentSuite).toContain(
      'adds a Jobright connector instance with released auth and default US filter',
    )
    expect(componentSuite).toContain(
      'does not auto-validate non-Jobright configured connectors on settings load',
    )
    expect(componentSuite).toContain(
      'keeps Jobright target and advanced settings off non-Jobright connector cards',
    )
    expect(componentSuite).toContain(
      'treats legacy Jobright api_key auth as unconfigured API credentials',
    )
  })

  it('keeps Jobright configuration matrices below the full App boundary', () => {
    const appSuite = read('src/App.settings.jobright-configuration.test.tsx')
    const panelSuite = read(
      'src/settings/ConnectorSettingsPanel.jobright-configuration.test.tsx',
    )
    const validationSuite = read('src/settings/ConnectorSettingsValidationActions.test.tsx')

    expect(countTests(appSuite)).toBeLessThanOrEqual(1)
    expect(panelSuite).toContain(
      'saves enabled state without exposing request size or erasing persisted filters',
    )
    expect(validationSuite).toContain(
      'blocks Run while enabled state is unsaved',
    )
    expect(panelSuite).toContain(
      'keeps Run disabled after saving disabled state and restores it after reenabling',
    )
  })

  it('requires verified #295 inventory dispositions for connector-run progress and compact navigation', () => {
    const required = [
      {
        path: 'src/App.settings.connector-run-progress-history.test.tsx',
        disposition: 'consolidated',
        lowestSufficientBoundary: 'component',
      },
      {
        path: 'src/App.settings.compact-navigation.test.tsx',
        disposition: 'consolidated',
        lowestSufficientBoundary: 'component',
      },
    ] as const

    for (const expected of required) {
      const entry = slowTestBoundaryInventory.find(({ path: file }) => file === expected.path)
      expect(entry, expected.path).toBeDefined()
      expect(entry!.disposition, expected.path).toBe(expected.disposition)
      expect(entry!.lowestSufficientBoundary, expected.path).toBe(
        expected.lowestSufficientBoundary,
      )
    }
  })

  it('keeps connector-run progress presentation matrices below the full App boundary', () => {
    const appSuite = read('src/App.settings.connector-run-progress-history.test.tsx')
    const lifecycleSuite = read('src/settings/ConnectorRunSynchronizationDetails.test.tsx')
    const responsiveSuite = read('src/settings/ConnectorRunsPanel.responsive.test.tsx')
    const focusSuite = read('src/settings/ConnectorRunsPanel.focus.test.tsx')

    expect(countTests(appSuite)).toBeLessThanOrEqual(3)
    expect(appSuite).toContain(
      'keeps persisted active progress visible after navigating to Connector Runs',
    )
    expect(appSuite).toContain(
      'stops polling when persisted run state is terminal while trigger transport remains pending',
    )
    expect(appSuite).toContain(
      'renders a sanitized error when a settings connector run rejects',
    )
    expect(appSuite).not.toContain(
      'reconciles released lifecycle counts without opaque carried cycle stats',
    )
    expect(appSuite).not.toContain(
      'omits stale request-budget metrics while preserving provider progress',
    )
    expect(appSuite).not.toContain(
      'omits request budget label when run stats lack budget provenance',
    )
    expect(appSuite).not.toContain(
      'renders sanitized connector run history with retry guidance',
    )
    expect(appSuite).not.toContain(
      'keeps Card composition inside articles while preserving focus and live-region ownership',
    )
    expect(lifecycleSuite).toContain(
      'reconciles released lifecycle counts without opaque carried cycle stats',
    )
    expect(lifecycleSuite).toContain(
      'omits stale request-budget metrics while preserving provider progress',
    )
    expect(lifecycleSuite).toContain(
      'omits request budget label when run stats lack budget provenance',
    )
    expect(responsiveSuite).toContain(
      'sanitizes authentication-expired run history and shows released credential retry guidance',
    )
    expect(focusSuite).toContain(
      'keeps polite live-region ownership on the focused active run article',
    )
    expect(focusSuite).toContain(
      'does not steal focus again when the focused run refreshes',
    )
  })

  it('keeps compact navigation proofs at the retained App integration budget', () => {
    const appSuite = read('src/App.settings.compact-navigation.test.tsx')

    expect(countTests(appSuite)).toBeLessThanOrEqual(8)
    expect(appSuite).toContain('opens a compact settings popover for important runtime controls')
    expect(appSuite).toContain('toggles settings from the compact popover')
    expect(appSuite).toContain('closes the compact settings popover')
    expect(appSuite).toContain(
      'shows a delayed tooltip for close-settings on focus and dismisses it with Escape',
    )
    expect(appSuite).toContain(
      'opens the full settings page from the compact popover and returns to the app',
    )
    expect(appSuite).toContain(
      'opens the full settings page from the native Settings menu event',
    )
    expect(appSuite).toContain(
      'closes the narrow application drawer through its explicit close action',
    )
    expect(appSuite).toContain(
      'filters settings navigation through Search settings',
    )
    expect(appSuite).not.toContain(
      'opens the application navigation as a narrow drawer without stacking it above content',
    )
    expect(appSuite).not.toContain('closes the narrow application drawer after changing views')
    expect(appSuite).not.toContain('uses the same app chrome shell for the settings view')
    expect(appSuite).not.toContain(
      'left-anchors the capped settings content column beside the sidebar',
    )
    expect(appSuite).not.toContain(
      'renders grouped settings navigation and filters the sidebar search',
    )
  })

  it('requires verified #295 inventory dispositions for profile-destructive and show-debug suites', () => {
    const required = [
      {
        path: 'src/App.settings.profile-destructive-confirm.test.tsx',
        disposition: 'consolidated',
        lowestSufficientBoundary: 'component',
      },
      {
        path: 'src/App.settings.show-debug-data.test.tsx',
        disposition: 'consolidated',
        lowestSufficientBoundary: 'component',
      },
    ] as const

    for (const expected of required) {
      const entry = slowTestBoundaryInventory.find(({ path: file }) => file === expected.path)
      expect(entry, expected.path).toBeDefined()
      expect(entry!.disposition, expected.path).toBe(expected.disposition)
      expect(entry!.lowestSufficientBoundary, expected.path).toBe(
        expected.lowestSufficientBoundary,
      )
    }
  })

  it('keeps profile destructive confirmation matrices below the full App boundary', () => {
    const sourcePath = 'src/App.settings.profile-destructive-confirm.test.tsx'
    expect(fs.existsSync(path.join(repositoryRoot, sourcePath))).toBe(false)
    const componentSuite = read('src/modules/profile/ProfileSettingsPanel.test.tsx')
    const retainedAppSuite = read('src/App.settings.profile-settings.test.tsx')

    expect(componentSuite).toContain('removes education only after alert confirmation')
    expect(componentSuite).toContain(
      'removes answers and secure values only after alert confirmation',
    )
    expect(componentSuite).toContain(
      'disables profile removal confirm while pending and keeps the alert open on error',
    )
    expect(componentSuite).toContain(
      'keeps education removal dialog retryable and preserves the item after a failed update',
    )
    expect(componentSuite).toContain(
      'keeps reusable-answer removal dialog retryable and preserves the item after a failed update',
    )
    expect(retainedAppSuite).toContain(
      'navigates to the profile component and exposes its loading status',
    )
  })

  it('keeps show-debug presentation matrices below the full App boundary', () => {
    const appSuite = read('src/App.settings.show-debug-data.test.tsx')
    const sourcingSuite = read('src/modules/sourcing/SourcingPage.test.tsx')
    const connectorSuite = read('src/settings/ConnectorRunSynchronizationDetails.test.tsx')

    expect(countTests(appSuite)).toBeLessThanOrEqual(1)
    expect(appSuite).not.toContain(
      'exposes a labeled Developer settings Switch that persists showDebugData',
    )
    expect(appSuite).toContain(
      'keeps sensitive secret text absent from designated surfaces in both debug modes',
    )
    expect(appSuite).not.toContain(
      'hides sourcing raw diagnostic ids by default and reveals them when enabled',
    )
    expect(appSuite).not.toContain(
      'hides connector run advanced diagnostics by default and reveals them when enabled',
    )
    expect(sourcingSuite).toContain(
      'hides sourcing raw diagnostic ids by default and reveals them when enabled',
    )
    expect(connectorSuite).toContain(
      'hides connector run advanced diagnostics by default and reveals them when enabled',
    )
    expect(read('src/settings/SettingsPage.panels.test.tsx')).toContain(
      'exposes a labeled Developer settings Switch that persists showDebugData',
    )
  })

  it('records audit deletions with retained replacement proofs', () => {
    expect(testBoundaryDeletions.length).toBeGreaterThanOrEqual(1)
    for (const deletion of testBoundaryDeletions) {
      expect(deletion.source.length).toBeGreaterThan(3)
      expect(deletion.removedCase.length).toBeGreaterThan(3)
      expect(deletion.reason.length).toBeGreaterThan(0)

      const hasRetainedProof =
        'retainedProof' in deletion
        && 'retainedCase' in deletion
        && typeof deletion.retainedProof === 'string'
        && typeof deletion.retainedCase === 'string'
      const hasObsoleteEvidence =
        'obsoleteEvidence' in deletion && typeof deletion.obsoleteEvidence === 'string'
      expect(Number(hasRetainedProof) + Number(hasObsoleteEvidence)).toBe(1)

      if (hasRetainedProof) {
        expect(deletion.retainedProof.length).toBeGreaterThan(3)
        expect(deletion.retainedCase.length).toBeGreaterThan(3)
        expect(fs.existsSync(path.join(repositoryRoot, deletion.retainedProof))).toBe(true)
        expect(read(deletion.retainedProof)).toContain(deletion.retainedCase)
      } else {
        expect(deletion.obsoleteEvidence.length).toBeGreaterThan(3)
      }

      if (fs.existsSync(path.join(repositoryRoot, deletion.source))) {
        expect(read(deletion.source)).not.toContain(deletion.removedCase)
      }
    }
  })

  it('forbids regrown class and data-attribute assertions in #295 UI component tests', () => {
    // Scoped strictly to src/components/ui: container-query and layout class assertions
    // elsewhere (e.g. src/settings) remain legitimate product contracts.
    const uiRelativeDir = 'src/components/ui'
    const uiDirectory = path.join(repositoryRoot, uiRelativeDir)
    const uiTestFiles = fs
      .readdirSync(uiDirectory, { encoding: 'utf8' })
      .filter((file) => file.endsWith('.test.tsx'))
      .sort()

    expect(uiTestFiles.length).toBeGreaterThan(0)
    expect(uiTestFiles).not.toContain('command.test.tsx')
    expect(fs.existsSync(path.join(uiDirectory, 'command.test.tsx'))).toBe(false)

    const forbiddenClassAssertion = /toHaveClass\(/
    const forbiddenDataAttributeAssertion =
      /toHaveAttribute\(\s*['"]data-(?:slot|size|variant)['"]/

    for (const file of uiTestFiles) {
      const source = read(path.join(uiRelativeDir, file))
      expect(forbiddenClassAssertion.test(source), `${file}: toHaveClass regrowth`).toBe(false)
      expect(
        forbiddenDataAttributeAssertion.test(source),
        `${file}: data-slot/size/variant attribute assertion regrowth`,
      ).toBe(false)
    }
  })

  it('keeps named unit and domain tests free of heavyweight boundaries', () => {
    const sourceRoot = path.join(repositoryRoot, 'src')
    const testFiles = fs.readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(unit|domain)\.test\.[cm]?[jt]sx?$/.test(file))

    expect(testFiles.length).toBeGreaterThan(0)
    for (const file of testFiles) {
      expect(read(path.join('src', file))).not.toMatch(
        /@electric-sql\/pglite|pglite|http-test-harness|from ['"][^'"]*\/App['"]|from ['"]\.\/App['"]/i,
      )
    }
  })

  it('limits resettable PGlite ownership to sequential data-only suites', () => {
    const suites = [
      ['src/modules/sourcing/raw-source.repository.test.ts', true],
      ['src/modules/sourcing/raw-source-list.repository.test.ts', true],
      ['src/modules/applications/application.repository.test.ts', false],
      ['src/modules/applications/application.fixtures.test.ts', false],
      ['src/modules/applications/application.repository.attempts.test.ts', false],
      ['src/modules/applications/application.repository.links-events.test.ts', false],
      ['src/modules/applications/application.repository.list.test.ts', false],
      ['src/modules/capture/capture.provenance-parity.pglite.test.ts', false],
      ['src/modules/capture/capture.service.pglite.test.ts', false],
      ['src/modules/job/job.capture-lineage.pglite.test.ts', false],
      ['src/modules/connectors/connector-checkpoint.upgrade-copy.test.ts', false],
      ['src/modules/connectors/connector.overview.repository.test.ts', false],
      ['src/modules/connectors/connector.repository.bounded-history.test.ts', false],
      ['src/modules/connectors/connector.repository.earliest-backfill.test.ts', false],
      ['src/modules/connectors/connector.repository.exact-retry-finalize.test.ts', false],
      ['src/modules/connectors/connector.repository.retry-ledger.test.ts', true],
      ['src/modules/sourcing/provider-url-resolution.executor.test.ts', false],
      ['src/modules/connectors/connector.repository.test.ts', false],
      ['src/modules/connectors/connector.runner.auth-catchup.test.ts', false],
      ['src/modules/connectors/connector.runner.budgets-validate-auth.test.ts', false],
      ['src/modules/connectors/connector.runner.refresh-contract.test.ts', false],
      ['src/modules/connectors/connector.runner.sanitized-outcomes.test.ts', false],
      ['src/modules/connectors/connector.runner.source-session.test.ts', false],
      ['src/modules/connectors/connector-schedule.repository.pglite.test.ts', false],
      ['src/modules/source-execution/source-execution-governor.test.ts', true],
      ['src/modules/source-execution/source-session-executor.test.ts', false],
      ['src/modules/action-queue/action-queue.repository.test.ts', false],
      ['src/modules/secrets/secret.service.test.ts', false],
      ['src/modules/secrets/secret.pglite.store.test.ts', false],
      ['src/modules/secrets/secret.identity.test.ts', false],
      ['src/modules/sourcing/normalization.repository.exact-success.test.ts', false],
      ['src/modules/sourcing/normalization.repository.retry-identity.test.ts', true],
      ['src/modules/sourcing/projection-outcome.repository.test.ts', true],
      ['src/modules/sourcing/sourcing.processor.test.ts', false],
      ['src/app/loaders.connector-transport.test.ts', false],
      ['src/runtime/local-connector-schedule-source.test.ts', false],
      ['src/runtime/local-valedictorian-client.connector-auth.test.ts', false],
      ['src/runtime/local-valedictorian-client.connector-overview.test.ts', false],
      ['src/runtime/local-valedictorian-client.connector-retirement.test.ts', false],
      ['src/runtime/local-valedictorian-client.connector-runs.test.ts', false],
      ['src/runtime/local-connector-frontier-decoupling.contract.test.ts', false],
      ['src/runtime/local-valedictorian-client.provider-url-resolution.test.ts', false],
      ['src/runtime/local-valedictorian-client.run-guards.test.ts', false],
      ['src/runtime/local-valedictorian-client.workspace-domain.test.ts', false],
      ['src/runtime/raw-normalization-replay.runtime.test.ts', true],
      ['src/runtime/raw-normalization.runtime.identity-rollback.test.ts', false],
      ['src/runtime/raw-normalization.runtime.projection-resolvers.test.ts', false],
      ['src/server/local-secret-resolution.http.test.ts', false],
      ['src/server/raw-source-ledger.http.test.ts', false],
      ['src/server/raw-source-captured-presentation.http.test.ts', false],
      ['src/server/local-server.domain-routes.test.ts', false],
      ['src/modules/connectors/connector-schedule.dispatch.pglite.test.ts', false],
      ['src/modules/connectors/connector.repository.scope-admission.test.ts', false],
      ['src/modules/connectors/connector.normalization.test.ts', false],
      ['src/modules/policy/policy.repository.test.ts', false],
      ['src/db/pglite.baseline.test.ts', false],
      ['src/modules/workflow-runs/workflow-run.repository.test.ts', false],
      ['src/modules/sourcing/sourcing.repository.test.ts', false],
      ['src/modules/sourcing/canonical-candidate.projection.test.ts', false],
    ] as const
    const intentionalProofSuites = [
      'src/runtime/local-valedictorian-client.test-harness.test.ts',
      'src/test/pglite-resettable-owner.test.ts',
    ]
    const resettableConsumers = listTestFiles()
      .filter((file) => file !== 'src/test/test-pyramid-policy.test.ts')
      .filter((file) => read(file).includes('useResettablePgliteTest'))
      .sort()

    expect(resettableConsumers).toEqual([
      ...suites.map(([file]) => file),
      ...intentionalProofSuites,
    ].sort())

    for (const [file, requiresFreshLifecycleProof] of suites) {
      const source = read(file)
      expect(source).toContain('useResettablePgliteTest')
      expect(source).toContain('describe.sequential(')
      expect(source).not.toMatch(/create\s+(?:or\s+replace\s+)?(?:function|trigger)/i)
      expect(source).not.toMatch(/\b(?:describe|it|test)\.concurrent\s*\(/)
      if (requiresFreshLifecycleProof) {
        expect(source).toContain('createPgliteClient')
        expect(source).toMatch(/restart|reopen/i)
      }
    }

    const owner = read('src/test/pglite-test-owner.ts')
    const proof = read('src/test/pglite-resettable-owner.test.ts')
    expect(owner).toContain('truncate table')
    expect(owner).toContain('restart identity cascade')
    expect(owner).toContain(
      'export async function createPgliteTestOwner(): Promise<PgliteTestOwner>',
    )
    expect(proof).toContain('starts the next test empty without constructing another database')
  })

  it('assigns every current Vitest file once according to CI runner capacity', () => {
    const testFiles = listTestFiles()
    expect(CI_TEST_SHARD_CAPACITIES).toEqual([1, 1])
    const shards = assignDurationBalancedShards(
      testFiles.map((file) => ({ path: file, weight: testWeightForPath(file) })),
      2,
      CI_TEST_SHARD_CAPACITIES,
    )

    expect(shards.flatMap(({ files }) => files).sort()).toEqual(testFiles.sort())
    const normalizedLoads = shards.map(
      ({ totalWeight }, index) => totalWeight / CI_TEST_SHARD_CAPACITIES[index]!,
    )
    expect(Math.max(...normalizedLoads) - Math.min(...normalizedLoads)).toBeLessThanOrEqual(
      Math.max(...testFiles.map(testWeightForPath)) / Math.min(...CI_TEST_SHARD_CAPACITIES),
    )
  })

  it('registers exhaustive #295 proof-audit evidence for every current Vitest file', () => {
    const discovered = listTestFiles().sort()
    const registryPaths = testProofAuditRegistry.map(({ path: file }) => file)
    const uniqueRegistryPaths = new Set(registryPaths)

    expect(registryPaths).toEqual(discovered)
    expect(uniqueRegistryPaths.size).toBe(discovered.length)

    const validBoundaries = new Set([
      'unit',
      'component',
      'full-app',
      'pglite',
      'http',
      'runtime',
      'migration',
      'electron',
      'package',
      'tooling',
    ])
    const validClassifications = new Set([
      'unique-behavior',
      'representative-boundary',
      'redundant-proof',
      'obsolete-contract',
      'implementation-coupled',
      'framework-only',
    ])

    for (const entry of testProofAuditRegistry) {
      expect(entry.path.length).toBeGreaterThan(0)
      expect(validBoundaries.has(entry.boundary)).toBe(true)
      expect(validClassifications.has(entry.classification)).toBe(true)
      expect(entry.proof.trim().length).toBeGreaterThan(3)
    }
  })

  it('keeps the #295 proof-audit registry free of deletion-class entries', () => {
    const disallowed = new Set([
      'redundant-proof',
      'obsolete-contract',
      'implementation-coupled',
      'framework-only',
    ])
    const disallowedEntries = testProofAuditRegistry.filter((entry) =>
      disallowed.has(entry.classification),
    )
    expect(disallowedEntries).toEqual([])
  })

  it('registers every hosted individual case at or above five seconds', () => {
    // Independently declared from exact hosted logs:
    // gh run view 29665693985 --repo KennyKeni/valedictorian-app --log (19 cases >=5000ms)
    // gh run view 29661337162 --repo KennyKeni/valedictorian-app --log (65 cases >=5000ms)
    // Deduplicated by path+title across both runs (union = 66).
    const auditedHighCostCaseKeys = [
      'electron/profile-runtime-composition.test.ts::keeps legacy operational sqlite byte-for-byte untouched while creating independent PGlite capabilities',
      'src/App.connectors.schedules.test.tsx::creates and reloads a preset schedule across two complete App mounts',
      'src/App.connectors.schedules.test.tsx::disables schedule removal confirm while pending and keeps the alert open on error',
      'src/App.connectors.schedules.test.tsx::edits with the current revision, discards drafts, and deletes manual-only schedules',
      'src/App.connectors.schedules.test.tsx::keeps a persisted IANA timezone alias selected and saves it unchanged',
      'src/App.connectors.schedules.test.tsx::keeps cards manual-only with an unavailable-scheduler explanation and never loads schedules',
      'src/App.connectors.schedules.test.tsx::pauses and resumes using returned revisions and shows last schedule outcomes',
      'src/App.connectors.schedules.test.tsx::saves custom daily and weekly schedules with structured cadence and timezone payloads',
      'src/App.connectors.schedules.test.tsx::validates custom interval bounds and preserves draft after typed server errors',
      'src/App.settings.connector-instance-applicability.test.tsx::creates, configures, and runs the current Jobright connector through Settings',
      'src/App.settings.connector-run-deep-links.test.tsx::focuses a supplied connector run only once across polling updates',
      'src/App.settings.connector-run-deep-links.test.tsx::navigates run-specific actions to Connector Runs and focuses the supplied run',
      'src/App.settings.earliest-backfill.test.tsx::shows the persisted date, saves calendar changes, discards drafts, and gates Run',
      'src/App.settings.jobright-execution.test.tsx::runs an authenticated Jobright connector from settings',
      'src/App.settings.jobright-execution.test.tsx::shows two persisted non-terminal progress snapshots before terminal connector counts',
      'src/App.settings.jobright-public-trigger.http.test.tsx::persists a connector run when Run Jobright now uses the real Sparxie HTTP client',
      'src/App.settings.jobright-readd.http.test.tsx::adds a fresh connector-instance id after remove without resurrecting the retired tombstone',
      'src/App.settings.profile-settings.test.tsx::renders and persists structured profile sections with compact reusable answers and secure values',
      'src/App.sourcing-normalization.migrated.http.test.tsx::renders facts, lineage, normalization, gate, and projection from a legacy connector record',
      'src/db/pglite.baseline.test.ts::applies the baseline a second time idempotently',
      'src/db/pglite.baseline.test.ts::applies the one PostgreSQL baseline to a fresh database',
      'src/db/pglite.baseline.test.ts::characterizes temporary #283 lifecycle parity shapes as cutover parity only',
      'src/db/pglite.baseline.test.ts::enforces append-only job identities and projection outcomes plus source-bound identity limits',
      'src/db/pglite.baseline.test.ts::enforces connector scope-owner invariants',
      'src/db/pglite.baseline.test.ts::enforces foreign keys, checks, uniqueness, and partial unique indexes',
      'src/db/pglite.baseline.test.ts::persists workspace secrets with encrypted text and boolean/timestamp/json mappings',
      'src/db/pglite.runtime.test.ts::initializes using explicitly loaded local runtime assets',
      'src/modules/action-queue/action-queue.repository.test.ts::reads the same action queue across on-disk close and reopen',
      'src/modules/applications/application.fixtures.test.ts::keeps fixture rows visible after an on-disk close and reopen',
      'src/modules/applications/application.repository.transactions.test.ts::rolls back remaining multi-row mutations when audit event writes fail',
      'src/modules/connectors/connector-schedule.repository.pglite.test.ts::keeps schedules and revision history visible after an on-disk close and reopen',
      'src/modules/connectors/connector.overview.repository.test.ts::reads one default-sized connector page and its latest synchronized runs in one query',
      'src/modules/connectors/connector.repository.bounded-history.test.ts::returns page, live lifecycle counts, and total from one concurrent snapshot',
      "src/modules/connectors/connector.repository.exact-retry-finalize.test.ts::lets only one shared-owner caller own the 'completed' terminal transition",
      "src/modules/connectors/connector.repository.exact-retry-finalize.test.ts::lets only one shared-owner caller own the 'failed' terminal transition",
      'src/modules/connectors/connector.repository.retry-ledger.test.ts::reuses one exact-due outcome after a worker process owner closes',
      'src/modules/connectors/connector.repository.retry-ledger.test.ts::selects due work independently of large terminal retry history',
      'src/modules/policy/policy.repository.test.ts::persists policy config across on-disk close and reopen',
      'src/modules/profile/ProfileSettingsPanel.test.tsx::renders and persists structured profile sections with compact reusable answers and secure values',
      'src/modules/profile/profile.composition.test.ts::observes external edits, fails closed on invalid JSON, restores, restarts, and keeps profile tables absent',
      'src/modules/profile/profile.composition.test.ts::prepares one JSON profile and scoped secret capability before use and disposes it',
      'src/modules/source-execution/source-execution-governor.test.ts::preserves action-required fencing after an on-disk PGlite restart',
      'src/modules/sourcing/canonical-candidate.projection.test.ts::keeps a projected finding visible after an on-disk close and reopen',
      'src/modules/sourcing/normalization.repository.retry-identity.test.ts::converges identical writes, orders timestamp ties by id, and survives close and reopen',
      'src/modules/sourcing/projection-outcome.repository.test.ts::keeps pending outcomes visible after an on-disk PGlite restart',
      'src/modules/sourcing/provider-url-resolution.repository.test.ts::resumes a pending operation after reopen and atomically claims it once',
      'src/modules/sourcing/raw-source-list.repository.test.ts::preserves deterministic pages after the workspace database reopens',
      'src/modules/sourcing/raw-source.repository.test.ts::keeps raw captures visible after an on-disk PGlite restart',
      'src/modules/sourcing/sourcing.repository.test.ts::keeps findings visible after an on-disk close and reopen',
      'src/modules/workflow-runs/workflow-run.repository.test.ts::persists runs across on-disk close and reopen',
      'src/runtime/raw-normalization-replay.runtime.test.ts::keeps prior normalization runs internally queryable while GET returns the latest replay',
      'src/runtime/raw-normalization.runtime.projection-resolvers.test.ts::converges different provider identities on one canonical employer destination',
      'src/server/local-secret-resolution.http.test.ts::resolves same-named secrets only within each workspace through the manager',
      'src/server/local-server.connector-upgrade.test.ts::reconciles a trusted newer package and resumes its durable provider checkpoint through HTTP',
      'src/server/local-server.domain-routes.test.ts::exposes write-only workspace secrets without a legacy sensitive profile route',
      'src/server/local-server.domain-routes.test.ts::records and clears a workspace latest error around backend load attempts',
      'src/server/local-server.workspace-routing.test.ts::auto-loads registered workspace data for workspace-scoped domain routes',
      'src/server/local-server.workspace-routing.test.ts::reopens a canonical workspace through its real path after closing a symlink-owned runtime',
      'src/server/local-server.workspace-routing.test.ts::returns 404 for another workspace projection revision through the workspace manager',
      'src/server/local-server.workspace-routing.test.ts::returns the IPC active connector run when the workspace HTTP surface attaches late',
      'src/server/local-workspaces.pglite-lifecycle.test.ts::coalesces first resolution, isolates workspaces, and persists across a closed owner',
      'src/server/raw-source-captured-presentation.http.test.ts::aligns list and detail captured facts for a legacy-version nested Jobright revision',
      'src/server/raw-source-captured-presentation.http.test.ts::aligns list and detail captured title/company for nested Jobright evidence',
      'src/server/raw-source-ledger.http.test.ts::rejects a declared raw batch body above 128 MiB before accumulation',
      'src/test/pglite-template.test.ts::clones a closed migrated database without sharing mutations between clients',
      'src/test/pglite-template.test.ts::refuses to clone over a non-empty directory',
    ] as const

    const highCostKeys = highCostCaseAudit.map(
      ({ path: file, title }) => `${file}::${title}`,
    )
    expect(new Set(highCostKeys).size).toBe(highCostCaseAudit.length)
    expect(auditedHighCostCaseKeys).toHaveLength(66)
    expect(highCostKeys.sort()).toEqual([...auditedHighCostCaseKeys].sort())

    const deletionClassifications = new Set([
      'redundant-proof',
      'obsolete-contract',
      'implementation-coupled',
      'framework-only',
    ])

    for (const entry of highCostCaseAudit) {
      expect(entry.maxDurationMs).toBeGreaterThanOrEqual(5_000)
      expect(entry.proof.trim().length).toBeGreaterThan(3)
      expect([
        'unique-behavior',
        'representative-boundary',
        'redundant-proof',
        'obsolete-contract',
        'implementation-coupled',
        'framework-only',
      ]).toContain(entry.classification)

      const absolutePath = path.join(repositoryRoot, entry.path)
      const pathExists = fs.existsSync(absolutePath)
      const source = pathExists ? read(entry.path) : ''
      const titlePresent = pathExists && (
        source.includes(entry.title)
        || [...source.matchAll(/['`]([^'`]*\$[A-Za-z_][A-Za-z0-9_]*[^'`]*)['`]/g)]
          .map((match) => match[1]!)
          .some((template) => {
            const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const pattern = escaped.replace(/\\\$[A-Za-z_][A-Za-z0-9_]*/g, "'[^']+'")
            return new RegExp(`^${pattern}$`).test(entry.title)
          })
      )

      if (deletionClassifications.has(entry.classification)) {
        if (!titlePresent) {
          const deletion = testBoundaryDeletions.find((candidate) => (
            candidate.source === entry.path
            && candidate.removedCase === entry.title
          ))
          expect(deletion, `${entry.path}::${entry.title}`).toBeDefined()
          expect(
            'retainedProof' in deletion!
            && 'retainedCase' in deletion!
            && typeof deletion!.retainedProof === 'string'
            && typeof deletion!.retainedCase === 'string',
            `${entry.path}::${entry.title}`,
          ).toBe(true)
          expect(fs.existsSync(path.join(repositoryRoot, deletion!.retainedProof))).toBe(true)
          expect(read(deletion!.retainedProof)).toContain(deletion!.retainedCase)
        }
        continue
      }

      expect(pathExists, entry.path).toBe(true)
      expect(titlePresent, `${entry.path}::${entry.title}`).toBe(true)
    }
  })
})
