# Valedictorian 0.1.0-alpha.48

This release completes the local lifecycle cutover to one Capture, Job,
Opportunity, and Application schema. Existing valid user Applications are
preserved, stale in-flight retry claims are safely rescheduled after restart,
and the Action Queue remains a server-derived Applications view with its current
policy buckets, timing rules, reasons, and ordering.

## Human-gated dependency order

The app intentionally remains on the hosted-installable `sparxie@0.27.1` so a
frozen install succeeds today. A human must publish Sparxie `0.28.0` before any
later Valedictorian change raises that dependency. Do not tag or publish this
release as part of the source preparation step.

