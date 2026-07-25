export type TestBoundary =
  | 'component'
  | 'full-app'
  | 'http'
  | 'migration'
  | 'pglite'
  | 'runtime'
  | 'unit'

export type TestBoundaryDisposition = 'consolidate' | 'consolidated' | 'retain'

type InventoryTuple = readonly [
  path: string,
  hostedDurationMs: number,
  proof: string,
  currentBoundary: TestBoundary,
  lowestSufficientBoundary: TestBoundary,
  disposition: TestBoundaryDisposition,
]

const inventory: InventoryTuple[] = [
  ['src/App.connectors.schedules.test.tsx', 88184, 'connector schedule UI and App wiring', 'full-app', 'component', 'consolidated'],
  ['src/runtime/raw-normalization.runtime.projection-resolvers.test.ts', 84078, 'normalization resolver, persistence, and projection behavior', 'runtime', 'unit', 'consolidated'],
  ['src/App.settings.profile-settings.test.tsx', 53266, 'profile settings interaction and App wiring', 'full-app', 'component', 'consolidated'],
  ['src/server/local-server.workspace-routing.test.ts', 52142, 'workspace routing, auto-load, isolation, and reopen behavior', 'http', 'http', 'retain'],
  ['src/modules/connectors/connector.repository.retry-ledger.test.ts', 50926, 'retry ledger acquisition, restart, and persistence', 'pglite', 'pglite', 'retain'],
  ['src/db/pglite.baseline.test.ts', 48707, 'baseline migration, idempotency, and constraints', 'migration', 'migration', 'retain'],
  ['src/server/raw-source-ledger.http.test.ts', 44312, 'raw-source HTTP ledger and atomic persistence', 'http', 'http', 'consolidated'],
  ['src/server/local-secret-resolution.http.test.ts', 33617, 'write-only secrets and multi-workspace secret resolution over HTTP', 'http', 'http', 'retain'],
  ['src/modules/sourcing/raw-source-list.repository.test.ts', 33445, 'raw-source list query semantics', 'pglite', 'pglite', 'retain'],
  ['src/modules/sourcing/sourcing.repository.test.ts', 32860, 'sourcing repository constraints and transactions', 'pglite', 'pglite', 'retain'],
  ['src/modules/connectors/connector.runner.refresh-contract.test.ts', 32529, 'refresh result validation and persistence boundary', 'pglite', 'unit', 'consolidated'],
  ['src/server/local-server.connector-capabilities.edge-contracts.test.ts', 29926, 'connector capability HTTP edge contracts', 'http', 'unit', 'consolidated'],
  ['src/modules/source-execution/source-execution-governor.test.ts', 29367, 'execution governor fencing and restart behavior', 'pglite', 'pglite', 'retain'],
  ['src/server/local-server.domain-routes.test.ts', 28948, 'domain route status and serialization', 'http', 'http', 'retain'],
  ['src/App.settings.connector-run-deep-links.test.tsx', 28565, 'connector run deep-link navigation', 'full-app', 'component', 'consolidated'],
  ['src/modules/connectors/connector.lifecycle-counts.test.ts', 28238, 'connector lifecycle count persistence', 'pglite', 'pglite', 'consolidated'],
  ['src/modules/action-queue/action-queue.repository.test.ts', 27933, 'action queue repository behavior', 'pglite', 'pglite', 'retain'],
  ['src/modules/sourcing/raw-source.repository.test.ts', 27865, 'raw-source validation and repository behavior', 'pglite', 'unit', 'consolidated'],
  ['src/runtime/raw-normalization-replay.runtime.test.ts', 27695, 'normalization replay runtime behavior', 'runtime', 'runtime', 'retain'],
  ['src/runtime/raw-normalization.runtime.identity-rollback.test.ts', 26482, 'normalization identity rollback behavior', 'runtime', 'runtime', 'retain'],
  ['src/modules/source-execution/source-session-executor.test.ts', 26330, 'source session execution and persistence', 'pglite', 'runtime', 'consolidated'],
  ['src/App.settings.jobright-credential-secrecy.test.tsx', 24692, 'credential secrecy through settings UI', 'full-app', 'component', 'consolidated'],
  ['src/modules/connectors/connector.repository.exact-retry-finalize.test.ts', 22757, 'exact retry finalization transaction', 'pglite', 'pglite', 'retain'],
  ['src/server/raw-source-captured-presentation.http.test.ts', 22479, 'captured raw-source HTTP presentation on resettable owner', 'http', 'http', 'consolidated'],
  ['src/App.applications-views.test.tsx', 22220, 'application view interactions and App wiring', 'full-app', 'component', 'consolidated'],
  ['src/modules/applications/application.repository.test.ts', 21343, 'application repository invariants', 'pglite', 'pglite', 'retain'],
  ['src/test/pglite-template.test.ts', 21289, 'template clone independence and cleanup', 'migration', 'migration', 'retain'],
  ['src/server/local-server.connector-schedules.management.test.ts', 20582, 'schedule management HTTP contracts', 'http', 'http', 'retain'],
  ['src/modules/workflow-runs/workflow-run.repository.test.ts', 20122, 'workflow run repository invariants', 'pglite', 'pglite', 'retain'],
  ['src/modules/sourcing/projection-outcome.repository.test.ts', 19699, 'projection outcome transactions and restart', 'pglite', 'pglite', 'retain'],
  ['src/modules/sourcing/canonical-candidate.projection.test.ts', 19406, 'canonical candidate projection concurrency', 'pglite', 'pglite', 'retain'],
  ['src/modules/sourcing/provider-url-resolution.executor.test.ts', 19202, 'provider URL resolution execution on resettable PGlite', 'pglite', 'pglite', 'retain'],
  ['src/App.settings.connector-instance-applicability.test.tsx', 18671, 'connector instance applicability UI', 'full-app', 'component', 'consolidated'],
  ['src/modules/applications/application.fixtures.test.ts', 18590, 'application fixture persistence', 'pglite', 'pglite', 'retain'],
  ['src/modules/profile/profile.composition.test.ts', 18468, 'profile composition prepare/dispose merged into restart case', 'pglite', 'runtime', 'consolidated'],
  ['src/server/local-workspaces.pglite-lifecycle.test.ts', 18443, 'workspace PGlite lifecycle and shutdown', 'runtime', 'runtime', 'retain'],
  ['src/modules/connectors/connector-schedule.repository.pglite.test.ts', 18441, 'schedule repository persistence', 'pglite', 'pglite', 'retain'],
  ['src/modules/connectors/connector.repository.test.ts', 18389, 'connector repository invariants', 'pglite', 'pglite', 'retain'],
  ['src/modules/sourcing/normalization.repository.retry-identity.test.ts', 18201, 'normalization retry identity transactions', 'pglite', 'pglite', 'retain'],
  ['src/modules/applications/application.repository.attempts.test.ts', 17952, 'application attempt persistence', 'pglite', 'pglite', 'retain'],
  ['src/modules/policy/policy.repository.test.ts', 17658, 'policy repository persistence', 'pglite', 'pglite', 'retain'],
  ['src/runtime/local-valedictorian-client.run-guards.test.ts', 17192, 'local client run guard behavior', 'runtime', 'runtime', 'retain'],
  ['src/settings/ConnectorProviderFilters.test.tsx', 17093, 'connector provider filter component behavior', 'component', 'component', 'retain'],
  ['src/runtime/local-valedictorian-client.workspace-domain.test.ts', 16683, 'workspace domain client integration', 'runtime', 'runtime', 'retain'],
  ['src/App.sourcing-filters-table.test.tsx', 16481, 'sourcing filter table and App wiring', 'full-app', 'component', 'consolidated'],
  ['src/server/local-server.connector-schedules.dispatch.test.ts', 16427, 'schedule dispatch HTTP admitted-due execution', 'http', 'http', 'consolidated'],
  ['src/App.settings.jobright-execution.test.tsx', 16239, 'Jobright progress/terminal execution settings UI', 'full-app', 'component', 'consolidated'],
  ['src/server/raw-source-projection.http.test.ts', 15617, 'raw-source projection HTTP boundary', 'http', 'http', 'retain'],
  ['src/App.settings.connector-run-progress-history.test.tsx', 14921, 'connector run progress history UI', 'full-app', 'component', 'consolidated'],
  ['src/modules/sourcing/normalization.repository.exact-success.test.ts', 14837, 'normalization exact-success persistence', 'pglite', 'pglite', 'retain'],
  ['src/modules/connectors/connector.repository.bounded-history.test.ts', 14700, 'bounded connector history persistence', 'pglite', 'pglite', 'retain'],
  ['src/runtime/local-valedictorian-client.connector-settings-edge.test.ts', 14490, 'connector settings client edge behavior', 'runtime', 'runtime', 'retain'],
  ['src/modules/applications/application.repository.links-events.test.ts', 13948, 'application links and events persistence', 'pglite', 'pglite', 'retain'],
  ['src/App.settings.jobright-public-trigger.http.test.tsx', 13922, 'Jobright public trigger App and HTTP wiring', 'full-app', 'http', 'retain'],
  ['src/modules/connectors/connector.runner.auth-catchup.test.ts', 13803, 'connector auth and catch-up runtime', 'pglite', 'pglite', 'retain'],
  ['src/App.settings.jobright-configuration.test.tsx', 13505, 'Jobright configuration UI', 'full-app', 'component', 'consolidated'],
  ['src/App.sourcing-normalization.migrated.http.test.tsx', 13412, 'migrated normalization App and HTTP path', 'full-app', 'http', 'consolidated'],
  ['src/modules/sourcing/provider-url-resolution.repository.test.ts', 13279, 'provider URL resolution persistence', 'pglite', 'pglite', 'retain'],
  ['src/server/local-server.connector-schedules.delayed-recovery.test.ts', 12749, 'delayed schedule recovery', 'http', 'runtime', 'retain'],
  ['src/runtime/local-valedictorian-client.provider-url-resolution.test.ts', 12636, 'provider URL resolution client integration', 'runtime', 'runtime', 'retain'],
  ['src/server/raw-source-list.http.test.ts', 12172, 'raw-source list HTTP contract', 'http', 'http', 'retain'],
  ['src/runtime/local-valedictorian-client.connector-runs.test.ts', 11480, 'connector run client integration', 'runtime', 'runtime', 'retain'],
  ['src/App.settings.compact-navigation.test.tsx', 11446, 'compact settings navigation', 'full-app', 'component', 'consolidated'],
  ['src/modules/applications/application.repository.list.test.ts', 11434, 'application repository list queries', 'pglite', 'pglite', 'retain'],
  ['src/modules/secrets/secret.pglite.store.test.ts', 11376, 'PGlite secret store behavior', 'pglite', 'pglite', 'retain'],
  ['src/App.sourcing-normalization.test.tsx', 11284, 'normalization UI behavior', 'full-app', 'component', 'consolidated'],
  ['src/server/local-server.connector-schedules.reopen.test.ts', 11212, 'schedule reopen persistence', 'http', 'runtime', 'retain'],
  ['src/modules/connectors/connector.runner.budgets-validate-auth.test.ts', 11025, 'runner budgets and auth validation', 'pglite', 'runtime', 'consolidated'],
  ['src/runtime/local-valedictorian-client.connector-retirement.test.ts', 10993, 'connector retirement client integration', 'runtime', 'runtime', 'retain'],
  ['src/App.settings.profile-destructive-confirm.test.tsx', 10879, 'profile destructive confirmation UI', 'full-app', 'component', 'consolidated'],
  ['src/server/local-server.connector-upgrade.test.ts', 10872, 'connector upgrade HTTP behavior', 'http', 'http', 'retain'],
  ['src/App.settings.show-debug-data.test.tsx', 10658, 'debug data settings UI', 'full-app', 'component', 'consolidated'],
  ['src/modules/sourcing/sourcing.processor.test.ts', 10540, 'sourcing processor integration', 'pglite', 'runtime', 'consolidated'],
  ['src/server/local-server.application-mutations.test.ts', 10477, 'application mutation HTTP boundary', 'http', 'http', 'retain'],
  ['src/runtime/local-connector-schedule-source.test.ts', 10047, 'connector schedule source runtime', 'runtime', 'runtime', 'retain'],
]

export const slowTestBoundaryInventory = inventory.map(([
  path,
  hostedDurationMs,
  proof,
  currentBoundary,
  lowestSufficientBoundary,
  disposition,
]) => ({
  currentBoundary,
  disposition,
  hostedDurationMs,
  lowestSufficientBoundary,
  path,
  proof,
}))

export const testBoundaryMoves = [
  {
    source: 'src/modules/connectors/connector-schedule.repository.pglite.test.ts',
    maxSourceTests: 7,
    targets: [
      'src/modules/connectors/connector-schedule.repository.schema-failure.test.ts',
    ],
    movedProofs: [
      'schedule create rollback under an injected schema trigger failure',
    ],
    retainedProofs: [
      'schedule constraints, revisions, and persistence on resettable PGlite',
    ],
  },
  {
    source: 'src/modules/sourcing/sourcing.repository.test.ts',
    maxSourceTests: 15,
    targets: ['src/modules/sourcing/sourcing.repository.schema-failure.test.ts'],
    movedProofs: [
      'finding create and update rollback under injected schema trigger failures',
    ],
    retainedProofs: [
      'finding constraints, query behavior, and classification on resettable PGlite',
    ],
  },
  {
    source: 'src/modules/workflow-runs/workflow-run.repository.test.ts',
    maxSourceTests: 6,
    targets: [
      'src/modules/workflow-runs/workflow-run.repository.schema-failure.test.ts',
    ],
    movedProofs: [
      'start and completion rollback under injected schema trigger failures',
    ],
    retainedProofs: [
      'workflow start, completion, step ordering, and constraints on resettable PGlite',
    ],
  },
  {
    source: 'src/modules/sourcing/canonical-candidate.projection.test.ts',
    maxSourceTests: 7,
    targets: [
      'src/modules/sourcing/canonical-candidate.projection.schema-failure.test.ts',
    ],
    movedProofs: [
      'canonical projection rollback under an injected schema trigger failure',
    ],
    retainedProofs: [
      'projection identity, idempotency, and concurrency on resettable PGlite',
    ],
  },
  {
    source: 'src/modules/connectors/connector-schedule.dispatch.pglite.test.ts',
    maxSourceTests: 8,
    targets: [
      'src/modules/connectors/connector-schedule.dispatch.schema-failure.test.ts',
    ],
    movedProofs: [
      'schedule admission rollback under an injected occurrence schema trigger failure',
    ],
    retainedProofs: [
      'instance-first lock order and concurrent duplicate admission convergence',
      'paused, connector_disabled, deferred_active, and active-paused dispatch outcomes',
      'expired-horizon not_due persistence without occurrence or run admission',
    ],
  },
  {
    source: 'src/modules/connectors/connector.repository.scope-admission.test.ts',
    maxSourceTests: 3,
    targets: [
      'src/modules/connectors/connector.repository.scope-admission.schema-failure.test.ts',
    ],
    movedProofs: [
      'scope creation rollback under an injected connector-instance schema trigger failure',
    ],
    retainedProofs: [
      'instance FOR UPDATE admission locking and blocked-scope skip behavior',
    ],
  },
  {
    source: 'src/modules/connectors/connector.normalization.test.ts',
    maxSourceTests: 2,
    targets: [
      'src/modules/connectors/connector.normalization.schema-failure.test.ts',
    ],
    movedProofs: [
      'normalization run rollback under an injected retry-work schema trigger failure',
    ],
    retainedProofs: [
      'blocked capability attempts and typed multi-field retry unit persistence',
    ],
  },
  {
    source: 'src/server/raw-source-captured-presentation.http.test.ts',
    maxSourceTests: 3,
    targets: [
      'src/server/raw-source-captured-presentation.http.test.ts',
    ],
    movedProofs: [
      'modern, legacy, and sparse captured presentation cases onto one resettable owner/server',
    ],
    retainedProofs: [
      'list/detail captured title and company alignment for nested Jobright payloads',
    ],
  },
  {
    source: 'src/modules/profile/profile.composition.test.ts',
    maxSourceTests: 2,
    targets: [
      'src/modules/profile/profile.composition.test.ts',
    ],
    movedProofs: [
      'ordinary prepare/dispose assertions into the restart composition case',
    ],
    retainedProofs: [
      'external edit observation, invalid JSON fail-closed restore, restart, and dispose',
    ],
  },
  {
    source: 'src/App.settings.jobright-readd.http.test.tsx',
    maxSourceTests: 0,
    targets: [
      'src/App.settings.connector-instance-applicability.test.tsx',
      'src/app/loaders.connector-readd-lifecycle.test.ts',
    ],
    movedProofs: [
      'full-App remove/re-add UI transition with Add re-enabled and no stale already-configured state',
      'HTTP/PGlite remove/re-add, tombstone, uniqueness, and restart lifecycle',
    ],
    retainedProofs: [
      'fake-API App remove then re-add transition on Connectors overview',
      'HTTP/PGlite remove/re-add, tombstone immutability, uniqueness, and restart lifecycle',
    ],
  },
  {
    source: 'src/modules/action-queue/action-queue.repository.test.ts',
    maxSourceTests: 13,
    targets: [
      'src/test/pglite-cross-repository-reopen.smoke.test.ts',
    ],
    movedProofs: [
      'generic on-disk close/reopen visibility for action-queue rows',
    ],
    retainedProofs: [
      'action-queue bucket derivation on resettable PGlite',
      'cross-repository close/reopen smoke covering action-queue visibility',
    ],
  },
  {
    source: 'src/modules/connectors/connector.lifecycle-counts.test.ts',
    maxSourceTests: 8,
    targets: [
      'src/modules/connectors/connector.lifecycle-counts.provider.unit.test.ts',
    ],
    movedProofs: [
      'missing and invalid provider-stat field matrices',
      'provider equation, duplicate, shortfall, and unclassified-row reconciliation',
    ],
    retainedProofs: [
      'capture lineage deduplication and occurrence counting',
      'destination and sourcing persistence, restart, and frozen terminal snapshots',
    ],
  },
  {
    source: 'src/App.connectors.schedules.test.tsx',
    maxSourceTests: 2,
    targets: [
      'src/settings/connector-schedule.helpers.test.ts',
      'src/settings/useConnectorInstanceSchedules.test.tsx',
      'src/settings/ConnectorScheduleControls.form-failure.test.tsx',
    ],
    movedProofs: [
      'interval validation and cadence mapping',
      'preset filtering and timezone aliases',
      'stale load and mutation ownership',
      'pending/error Manual-only removal confirmation',
      'capability-load failure without unavailable explanation',
      'preset save and remount reload',
      'pause/resume revisions and last schedule outcomes',
      'connector-disabled schedule state without dispatch helpers',
    ],
    retainedProofs: [
      'unavailable-scheduler manual-only cards and manual run wiring',
      'workspaceApi A→B late capability propagation through Settings',
    ],
  },
  {
    source: 'src/modules/connectors/connector.runner.refresh-contract.test.ts',
    maxSourceTests: 4,
    targets: [
      'src/modules/connectors/connector.refresh-result-sanitizer.unit.test.ts',
      'src/modules/connectors/connector.runner.refresh-contract.unit.test.ts',
    ],
    movedProofs: [
      'refresh envelope, retry advice, and operation consistency matrices',
      'refresh synchronization sanitization projections',
    ],
    retainedProofs: ['governor non-mutation, empty ledger and checkpoint, terminal persistence'],
  },
  {
    source: 'src/runtime/raw-normalization.runtime.projection-resolvers.test.ts',
    maxSourceTests: 25,
    targets: [
      'src/modules/sourcing/normalization.canonical-field-contract.unit.test.ts',
      'src/modules/sourcing/normalization.registry.facts.test.ts',
      'src/runtime/raw-normalization.runtime.schema-failure.test.ts',
    ],
    movedProofs: [
      'canonical-field value and exact-object-shape validation matrices',
      'postedAt and compensation normalization matrices',
      'projection failure behavior under an injected schema trigger failure',
    ],
    retainedProofs: [
      'invalid resolved and valid locked outcome wiring',
      'durable attempts, findings, projection, and identity convergence',
    ],
  },
  {
    source: 'src/App.settings.profile-settings.test.tsx',
    maxSourceTests: 1,
    targets: ['src/modules/profile/ProfileSettingsPanel.test.tsx'],
    movedProofs: ['profile field, modal, secret, and save interaction matrices'],
    retainedProofs: ['App navigation and profile component wiring'],
  },
  {
    source: 'src/server/local-server.connector-capabilities.edge-contracts.test.ts',
    maxSourceTests: 4,
    targets: [
      'src/modules/connectors/connector.option-query.contract.unit.test.ts',
    ],
    movedProofs: [
      'request validation, stale identity, and provider-result sanitization matrices',
    ],
    retainedProofs: [
      'HTTP parsing, canonical error mapping, exception secrecy, and workspace isolation',
    ],
  },
  {
    source: 'src/server/raw-source-ledger.http.test.ts',
    maxSourceTests: 16,
    targets: [
      'src/modules/sourcing/raw-source.validation.unit.test.ts',
      'src/server/local-server.http.unit.test.ts',
    ],
    movedProofs: [
      'credential-bearing URL validation across raw envelope locations',
      'declared and accumulated request-body limit handling',
      'payload, evidence, and batch contract-limit matrices',
      'typed body-too-large error contract',
    ],
    retainedProofs: [
      'credential rejection HTTP mapping, secrecy, and atomic persistence',
      'released HTTP ingestion, atomic persistence, restart, and workspace isolation',
    ],
  },
  {
    source: 'src/App.settings.connector-run-deep-links.test.tsx',
    maxSourceTests: 1,
    targets: [
      'src/settings/ConnectorRunsPanel.focus.unit.test.ts',
      'src/settings/ConnectorRunsPanel.focus.test.tsx',
    ],
    movedProofs: [
      'later-page, missing, and search-limit focused-run lookup outcomes',
      'one-time component focus ownership across refreshed run data',
    ],
    retainedProofs: [
      'App navigation, focus application, and stale-focus clearing wiring',
    ],
  },
  {
    source: 'src/App.settings.jobright-credential-secrecy.test.tsx',
    maxSourceTests: 1,
    targets: [
      'src/settings/ConnectorSettingsPanel.jobright-credential-secrecy.test.tsx',
    ],
    movedProofs: [
      'cancel without secret or validation calls',
      'verified auth status preserved on credential-edit cancel',
      'invalid empty credentials kept in editor without secret calls',
      'sanitized secure-storage upsert failure without secret content',
      'saved-but-validation-unavailable feedback without secret content',
      'auto-validation of configured credentials on settings load',
      'stale older ready validation ignored after newer failure settles',
      'stale auto-validation ignored after credential editing begins',
    ],
    retainedProofs: [
      'saves and validates Jobright credentials without revealing saved secrets',
    ],
  },
  {
    source: 'src/modules/sourcing/raw-source.repository.test.ts',
    maxSourceTests: 14,
    targets: [
      'src/modules/sourcing/raw-source.validation.unit.test.ts',
    ],
    movedProofs: [
      'exact credential header alias rejection throughout fixed envelopes',
      'unknown key rejection on every fixed transport envelope',
    ],
    retainedProofs: [
      'schema, query, transaction, persistence, restart, and cleanup behavior',
    ],
  },
  {
    source: 'src/App.applications-views.test.tsx',
    maxSourceTests: 18,
    targets: [
      'src/modules/applications/ApplicationEditorModal.test.tsx',
      'src/modules/applications/ApplicationDetailModal.test.tsx',
      'src/modules/action-queue/ActionQueuePage.test.tsx',
    ],
    movedProofs: [
      'sanitized save-failure feedback while keeping the editor open',
      'verification receipt attempt presentation',
      'empty links, events, and attempts detail sections',
      'action queue labeled pagination enabled and disabled controls',
    ],
    retainedProofs: [
      'application list loading, refresh, and detail-open App wiring',
      'injected applicationLinkCreator and scoreRecorder App wiring with exact score payload',
      'action queue row and connector status App wiring',
    ],
  },
  {
    source: 'src/App.sourcing-filters-table.test.tsx',
    maxSourceTests: 14,
    targets: ['src/modules/sourcing/SourcingPage.test.tsx'],
    movedProofs: [
      'employer, third-party, and unresolved destination presentation without Review only',
      'promoted and blocked finding presentation',
    ],
    retainedProofs: [
      'destination class and usability filter App wiring',
      'modal, pagination, sort, column, and virtualization App wiring',
    ],
  },
  {
    source: 'src/App.sourcing-normalization.test.tsx',
    maxSourceTests: 3,
    targets: [
      'src/modules/sourcing/RawNormalizationPage.test.tsx',
      'src/modules/sourcing/RawNormalizationDetail.test.tsx',
      'src/modules/sourcing/RawNormalizationOutcomes.test.tsx',
    ],
    movedProofs: [
      'public list filter query contract',
      'opaque cursor pagination',
      'empty result with filters preserved',
      'lifecycle column presentation',
      'capture provenance presentation',
      'resolver provenance, conflicts, abstentions, and admission reason',
    ],
    retainedProofs: [
      'Normalization navigation and sparse Capture App wiring',
      'connector-run inspect navigation App wiring',
      'open projected finding App wiring',
    ],
  },
  {
    source: 'src/App.settings.connector-instance-applicability.test.tsx',
    maxSourceTests: 3,
    targets: [
      'src/settings/ConnectorSettingsPanel.instance-applicability.test.tsx',
    ],
    movedProofs: [
      'adds a Jobright connector instance with released auth and default US filter',
      'does not auto-validate non-Jobright configured connectors on settings load',
      'keeps Jobright target and advanced settings off non-Jobright connector cards',
      'treats legacy Jobright api_key auth as unconfigured API credentials',
    ],
    retainedProofs: [
      'operates Jobright from the main Connectors page with responsive write-only controls',
      'creates, configures, and runs the current Jobright connector through Settings',
    ],
  },
  {
    source: 'src/App.settings.jobright-configuration.test.tsx',
    maxSourceTests: 1,
    targets: [
      'src/settings/ConnectorSettingsPanel.jobright-configuration.test.tsx',
      'src/settings/ConnectorSettingsValidationActions.test.tsx',
    ],
    movedProofs: [
      'saves enabled state without exposing request size or erasing persisted filters',
      'blocks Run while enabled state is unsaved',
      'keeps Run disabled after saving disabled state and restores it after reenabling',
    ],
    retainedProofs: [
      'persists enabled changes and retains earliest backfill and schedule controls after reload',
    ],
  },
  {
    source: 'src/App.settings.connector-run-progress-history.test.tsx',
    maxSourceTests: 3,
    targets: [
      'src/settings/ConnectorRunSynchronizationDetails.test.tsx',
    ],
    movedProofs: [
      'reconciles released lifecycle counts without opaque carried cycle stats',
      'omits stale request-budget metrics while preserving provider progress',
      'omits request budget label when run stats lack budget provenance',
    ],
    retainedProofs: [
      'keeps persisted active progress visible after navigating to Connector Runs',
      'stops polling when persisted run state is terminal while trigger transport remains pending',
      'renders a sanitized error when a settings connector run rejects',
    ],
  },
  {
    source: 'src/App.settings.profile-destructive-confirm.test.tsx',
    maxSourceTests: 0,
    targets: [
      'src/modules/profile/ProfileSettingsPanel.test.tsx',
      'src/App.settings.profile-settings.test.tsx',
    ],
    movedProofs: [
      'removes education only after alert confirmation',
      'removes answers and secure values only after alert confirmation',
      'disables profile removal confirm while pending and keeps the alert open on error',
      'keeps education removal dialog retryable and preserves the item after a failed update',
      'keeps reusable-answer removal dialog retryable and preserves the item after a failed update',
    ],
    retainedProofs: [
      'navigates to the profile component and exposes its loading status',
    ],
  },
  {
    source: 'src/App.settings.show-debug-data.test.tsx',
    maxSourceTests: 1,
    targets: [
      'src/modules/sourcing/SourcingPage.test.tsx',
      'src/settings/ConnectorRunSynchronizationDetails.test.tsx',
      'src/settings/SettingsPage.panels.test.tsx',
    ],
    movedProofs: [
      'hides sourcing raw diagnostic ids by default and reveals them when enabled',
      'hides connector run advanced diagnostics by default and reveals them when enabled',
      'exposes a labeled Developer settings Switch that persists showDebugData',
    ],
    retainedProofs: [
      'keeps sensitive secret text absent from designated surfaces in both debug modes',
    ],
  },
  {
    source: 'src/App.settings.jobright-execution.test.tsx',
    maxSourceTests: 0,
    targets: [
      'src/settings/ConnectorSettingsPanel.jobright-execution.test.tsx',
    ],
    movedProofs: [
      'two persisted non-terminal progress snapshots before terminal connector counts',
    ],
    retainedProofs: [
      'ConnectorSettingsPanel progress polling and terminal lifecycle presentation',
    ],
  },
  {
    source: 'src/App.settings.panel-navigation.test.tsx',
    maxSourceTests: 1,
    targets: [
      'src/settings/SettingsPage.panels.test.tsx',
      'src/App.settings.navigation-hierarchy.test.tsx',
      'src/App.settings.panel-navigation.test.tsx',
    ],
    movedProofs: [
      'functional settings panels and coming-later sidebar items',
      'full-page settings patch persistence and restart marking folded into the retained AppShell proof',
    ],
    retainedProofs: [
      'narrow settings drawer closes after panel changes through AppShell',
    ],
  },
  {
    source: 'src/modules/applications/application.repository.attempts.test.ts',
    maxSourceTests: 13,
    targets: [
      'src/modules/applications/application.repository.attempts.schema-failure.test.ts',
    ],
    movedProofs: [
      'attempt start and completion rollback under injected schema trigger failures',
    ],
    retainedProofs: [
      'attempt lifecycle, verification receipts, listing, and concurrency constraints',
    ],
  },
  {
    source: 'src/modules/sourcing/sourcing.processor.test.ts',
    maxSourceTests: 5,
    targets: [
      'src/modules/sourcing/sourcing.processor.schema-failure.test.ts',
    ],
    movedProofs: [
      'post-promotion rollback under an injected processing-step schema trigger failure',
    ],
    retainedProofs: [
      'candidate promotion, scoring, duplicate linking, and blocked processing',
    ],
  },
  {
    source: 'src/modules/sourcing/projection-outcome.repository.test.ts',
    maxSourceTests: 6,
    targets: [
      'src/modules/sourcing/projection-outcome.repository.schema-failure.test.ts',
    ],
    movedProofs: [
      'pending outcome staging rollback under an injected schema trigger failure',
    ],
    retainedProofs: [
      'pending staging, projection transitions, concurrency convergence, and restart persistence',
    ],
  },
  {
    source: 'src/App.sourcing-normalization.migrated.http.test.tsx',
    maxSourceTests: 0,
    targets: [
      'src/server/raw-source-projection.http.test.ts',
      'src/server/raw-source-captured-presentation.http.test.ts',
      'src/modules/sourcing/RawNormalizationDetail.test.tsx',
      'src/modules/sourcing/RawNormalizationOutcomes.test.tsx',
      'src/App.sourcing-normalization.test.tsx',
    ],
    movedProofs: [
      'legacy connector facts, normalization, gate, and not-eligible projection over HTTP',
      'needs-enrichment admission reason and not-eligible projection presentation',
    ],
    retainedProofs: [
      'legacy HTTP persistence of facts/normalization/gate/projection',
      'captured presentation alignment and Normalization App route wiring',
    ],
  },
  {
    source: 'src/server/local-server.connector-schedules.calendar-dst.test.ts',
    maxSourceTests: 0,
    targets: [
      'src/modules/connectors/connector-schedule.eligibility.test.ts',
    ],
    movedProofs: [
      'daily spring-forward gap and weekly fall-back overlap eligibility',
      'daily and weekly DST coalescing through resolveMissedNominals',
    ],
    retainedProofs: [
      'IANA spring-gap and fall-overlap eligibility and coalescing at the domain seam',
    ],
  },
  {
    source: 'src/server/local-server.connector-schedules.dispatch.test.ts',
    maxSourceTests: 1,
    targets: [
      'src/modules/connectors/connector-schedule.eligibility.test.ts',
      'src/modules/connectors/connector-schedule.dispatch.pglite.test.ts',
    ],
    movedProofs: [
      'interval coalescing and catch-up horizon advancement',
      'paused, connector_disabled, deferred_active, and active-paused dispatch outcomes',
    ],
    retainedProofs: [
      'HTTP admitted-due execution through the shared connector path to a terminal result',
    ],
  },
  {
    source: 'src/server/local-server.connector-public-trigger.test.ts',
    maxSourceTests: 3,
    targets: [
      'src/modules/connectors/connector.runner.sanitized-outcomes.test.ts',
      'src/server/local-server.connector-execution.http.test.ts',
      'src/server/local-server.connector-disabled.test.ts',
    ],
    movedProofs: [
      'secret-bearing and hostile refresh nominal sanitization',
      'fixed connector-execution HTTP 500 serialization and request-error logging',
      'disabled-connector local and HTTP admission rejection',
    ],
    retainedProofs: [
      'raw coverageEndedAt rejection, HTTP/IPC success parity, and concurrent active-run convergence',
    ],
  },
  {
    source: 'src/server/local-server.error-boundary.http.test.ts',
    maxSourceTests: 27,
    targets: [
      'src/server/local-server.http.unit.test.ts',
    ],
    movedProofs: [
      'declared and accumulated 2MiB limits plus fixed HTTP 413 boundary mapping',
    ],
    retainedProofs: [
      'malformed JSON over real HTTP with fixed validation mapping',
    ],
  },
  {
    source: 'src/modules/sourcing/normalization.repository.exact-success.test.ts',
    maxSourceTests: 4,
    targets: [
      'src/modules/sourcing/normalization.repository.exact-success.test.ts',
    ],
    movedProofs: [
      'seven non-success destinationUrl statuses into one multi-row resettable case',
      'resolved and locked positive statuses into one multi-row resettable case',
    ],
    retainedProofs: [
      'non-success and positive exact-success matrices plus retry-window boundary cases',
    ],
  },
  {
    source: 'src/runtime/raw-normalization-replay.runtime.test.ts',
    maxSourceTests: 14,
    targets: [
      'src/runtime/raw-normalization-replay.runtime.schema-failure.test.ts',
    ],
    movedProofs: [
      'replay request initialization rollback under an injected item persistence trigger failure',
    ],
    retainedProofs: [
      'replay selection, directives, concurrency claims, and close/reopen history visibility',
    ],
  },
  {
    source: 'src/runtime/raw-normalization.runtime.identity-rollback.test.ts',
    maxSourceTests: 11,
    targets: [
      'src/runtime/raw-normalization.runtime.identity-rollback.schema-failure.test.ts',
    ],
    movedProofs: [
      'identity reconciliation and gate rollback under injected schema trigger failures',
    ],
    retainedProofs: [
      'identity association, conflict persistence across reopen, and bound exhaustion',
    ],
  },
] as const
