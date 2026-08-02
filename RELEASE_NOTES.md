# Valedictorian 0.1.0-alpha.55

This release completes the clean pre-release cutover. The incremental PGlite
migration history has been replaced by one generated baseline, and obsolete
profile, connector-upgrade, Company coverage, lifecycle cursor, and cutover
scaffolding has been removed. Existing alpha workspaces must be recreated
rather than upgraded.

The lifecycle workbench now owns server state through TanStack React Query and
shares the proven controller mechanics across Jobs, Opportunities, and
Applications. Capture completion exits are state-aware, destinations use their
canonical URL representation, and Jobright destination outcomes are presented
with precise next actions.

The app consumes `@sparxie/sdk@0.36.0` and composes
`@sparxie/valedictorian-cli@0.1.0-alpha.20` from its imported workspace source,
including the current lifecycle pagination contract. Connector requests and
definitions are admitted through their canonical schemas without retired
aliases or compatibility paths.

Release confidence now includes deterministic isolated validation, a CLI/UI
development proof, Electron-native geometry coverage, packaged PGlite restart
smoke, and the packaged manual-workflow proof.
