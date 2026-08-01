# Changelog

## 0.1.0-alpha.20 - Unreleased

- Breaking: adopt the current lifecycle pagination contract for Capture, Job,
  Opportunity, and Application list/history and for Application attempts and
  events. Page requests take mutually exclusive `after`/`before` cursors
  instead of the retired `cursor` field, and page results carry `pageInfo`
  instead of `limit` and `nextCursor`. Omitting both cursors requests the first
  page and the request honors the contract default limit of 50.
- Breaking: human list output prints `Previous cursor: <startCursor>` and
  `Next cursor: <endCursor>` for the directions that have another page, and
  `End of results.` when neither does. JSON output passes `pageInfo` through
  unchanged.
- Upgrade the frozen dependency to `@sparxie/sdk@0.36.0`.

## 0.1.0-alpha.19 - Unreleased

- Breaking: remove the `companies capability` command and its
  `client.companies.capability.get()` call. The Company capability endpoint is
  retired; no alias or fallback replaces the command.

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
