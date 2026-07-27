# Changelog

## 0.1.0-alpha.55

- Replace the incremental pre-release migration history with one generated PGlite baseline; existing
  alpha workspaces must be recreated rather than upgraded.
- Move lifecycle renderer state to TanStack React Query and share the proven controller mechanics
  across Jobs, Opportunities, and Applications.
- Adopt the current Sparxie SDK and vendored Valedictorian CLI contracts, including current
  lifecycle pagination and canonical connector admission.
- Make Capture completion exits state-aware, adopt URL-only destinations, and present precise
  Jobright destination outcomes in the desktop workflow.
- Remove retired compatibility readers, Company coverage migration, obsolete cutover scaffolding,
  unreachable source, and redundant test arrangements while preserving the canonical behavior.
- Add deterministic isolated validation, CLI/UI development proof, and Electron-native geometry and
  packaging coverage.

## 0.1.0-alpha.54

- Add addressable workspace resources and complete workspace Company management, including
  reassignment, duplicate proposals, and irreversible manual merges.
- Materialize Capture revisions, resolve provider destinations through durable host work, and
  complete Captures into Jobs atomically with truthful next-action state.
- Consume the organization-scoped Sparxie SDK and connector packages.
- Add a packaged manual-workflow proof covering the release build's critical lifecycle path.

## 0.1.0-alpha.53

- Restore connector settings controls and dynamic provider option editing.

## 0.1.0-alpha.52

- Unify connector validation, settings, and schedule persistence behind a single save action.

## 0.1.0-alpha.51

- Restore desktop navigation and release controls around the lifecycle workbench.

## 0.1.0-alpha.50

- Restore the desktop application chrome and persistent navigation sidebar around the canonical
  Capture → Job → Opportunity → Application lifecycle workbench.
- Keep sidebar and lifecycle-rail selection synchronized, retain Connector Run → filtered Capture
  provenance navigation, and persist desktop collapse state through workspace settings.
- Restore the responsive narrow-window drawer and remove the temporary centered placeholder shell.

## 0.1.0-alpha.49

- Adopt the Jobright `0.18.0` connector (core + test-harness `0.18.0`) and expose its pure
  `jobright.provider-fields@2` provider-field resolver through the connector registry.
- Persist connector Capture acknowledgement before provider-field work; schedule that work on the
  canonical `normalization_work` identity (Capture id/revision + resolver id/version + input hash),
  independently of the connector frontier, with restart recovery and idempotent outcome persistence.
- Add a Capture-owned `capture_field_outcomes` relation and immutable per-revision connector input
  (`capture_revisions.payload_json`) so resolver-version advances replay eligible revisions without
  rewriting Capture evidence.
- Prefill an explicit, unambiguous United States or Canada country into a null Capture → Job location
  from the completed current-version outcome; conflicting, ambiguous, country-free, and remote-only
  evidence stays unknown, and promotion and correction remain user-controlled.

## 0.1.0-alpha.48

- Finalize the journaled Capture → Job → Opportunity → Application schema cutover.
- Preserve Action Queue as an Applications-owned, policy- and time-derived projection.
- Move connector retry ownership to `connector_capture_work` and recover restart-stale claims.
- Expand lifecycle migration, restart, ownership, and packaged PGlite proof.
