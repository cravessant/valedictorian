# Valedictorian 0.1.0-alpha.50

This release restores the desktop application chrome around the canonical job
lifecycle. Captures, Jobs, Opportunities, and Applications are again directly
reachable from the persistent sidebar, with the active sidebar destination kept
in sync with the lifecycle rail inside the workbench. Connector Runs remains a
first-class navigation destination and continues to round-trip into run-filtered
Captures and exact provenance targets.

Desktop sidebar collapse/expand is persisted through workspace settings, narrow
windows use the responsive drawer, and the temporary centered contract
placeholder has been removed. The underlying lifecycle, Jobright country
evidence, and clean PGlite cutover behavior from alpha.49 are unchanged.

## Human-gated dependency order

The app intentionally remains on the hosted-installable `sparxie@0.27.1` so a
frozen install succeeds today; the adopted connector core `0.18.0` carries its
exact `sparxie@0.27.0` ABI nested beneath it. A human must publish Sparxie
`0.28.0` before any later Valedictorian change raises that dependency.
