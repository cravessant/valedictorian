# Changelog

## 0.1.0-alpha.18 - Unreleased

- Expose the complete Capture to Job to Opportunity to Application lifecycle
  through the typed `sparxie` client contract, including direct creation,
  promotions, warning overrides, duplicate attach or merge choices,
  removal/restore, link mutation, re-promotion inputs, and history reads.
- Remove the former raw-record, canonical-candidate, and sourcing-finding CLI
  command vocabulary and runtime compatibility paths.
- Preserve complete structured lifecycle results while keeping secret values
  out of ordinary CLI output.
- Upgrade the frozen dependency to the newest installable compatible release,
  `@sparxie/sdk@0.29.0`.
- Publish the package as `@sparxie/valedictorian-cli` while preserving the
  `valedictorian-cli` executable name.
