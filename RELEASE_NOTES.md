# Valedictorian 0.1.0-alpha.49

This release adopts the corrected Jobright provider-country resolver in the
first-class Capture lifecycle. Explicit, unambiguous United States or Canada
location evidence captured by the Jobright connector is now persisted as
bounded Capture-owned field outcomes and made available to explicit Capture →
Job promotion: a promotion fills a null caller-selected location from a resolved
country, while conflicting, ambiguous, country-free, and remote-only evidence
stays unknown. Provider-field processing is scheduled independently of the
connector frontier on the canonical `normalization_work` identity, resumes after
restart without duplicate execution, and replays eligible stored Capture
revisions when the resolver version advances — without restoring any legacy
automatic intake pipeline or per-run normalization path.

## Human-gated dependency order

The app intentionally remains on the hosted-installable `sparxie@0.27.1` so a
frozen install succeeds today; the adopted connector core `0.18.0` carries its
exact `sparxie@0.27.0` ABI nested beneath it. A human must publish Sparxie
`0.28.0` before any later Valedictorian change raises that dependency. Do not tag
or publish this release as part of the source preparation step.
