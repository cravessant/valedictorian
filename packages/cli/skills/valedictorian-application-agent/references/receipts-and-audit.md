# Runs, Receipts, And Audit

Read this before starting, resuming, stepping, or completing browser application work.

## Contents

- State boundary and preflight
- Start or resume
- Blockers and holds
- Verification receipt
- Confirmed submission
- Final verification

## State Boundary

- Load `valedictorian-cli` before commands.
- Treat `applications attempts list` and `applications events list` as read-only diagnostics.
- Use `runs --run-type application_attempt` for every agent-owned milestone and outcome.
- Use `applications update-status` only when the canonical pursuit status truly changes.
- Do not use direct database writes or ad hoc HTTP to fill missing CLI capabilities.

## Preflight Reads

```sh
valedictorian-cli --json context
valedictorian-cli --json doctor --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json action-queue list --workspace "$VALEDICTORIAN_WORKSPACE" --action-bucket apply_now --limit 25
valedictorian-cli --json applications get <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json applications history <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json applications attempts list <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json applications events list <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt --subject-application-id <application-id>
valedictorian-cli --json profile agent-context --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json secrets list --workspace "$VALEDICTORIAN_WORKSPACE"
```

Use attempts/events to understand existing technical activity, not as records the agent can mutate.

## Start Or Resume

Resume a matching in-progress run. Otherwise:

```sh
valedictorian-cli --json runs start \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --run-type application_attempt \
  --actor-type agent \
  --actor-name <agent-name> \
  --subject-application-id <application-id> \
  --summary "Started browser application work."
```

Record milestones with bounded, non-secret data:

```sh
valedictorian-cli --json runs step <run-id> \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --type page_verified \
  --message "Verified contact and education page."
```

Useful run step types include `resume_uploaded`, `page_verified`, `blocked`, `verification_receipt`, `submitted`, `confirmation_verified`, and `note`.

## Blockers And Holds

For a CAPTCHA, missing fact, review hold, login/security gate, closed posting, or platform failure:

1. Add a precise `blocked` or `note` run step without secret values.
2. Complete the run with `--status completed`.
3. Put the operational classification in `--blocker` and optionally bounded `--metadata-json`.
4. Omit `--outcome`.
5. Tell the user that the current CLI could not update the Action Queue operational hold.

```sh
valedictorian-cli --json runs complete <run-id> \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --status completed \
  --blocker needs_user_info \
  --summary "A required sponsorship answer is missing." \
  --metadata-json '{"classification":"needs_user_info"}'
```

## Verification Receipt

After final review passes and before clicking Submit:

```sh
valedictorian-cli --json runs step <run-id> \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --type verification_receipt \
  --message "Final review verification passed." \
  --payload-json '{"version":1,"scope":"final_review","status":"passed","verified":["identity","contact_info","resume_attachment","work_authorization"],"unresolved":[],"evidence":"Final review matched the intended application payload before submit."}'
```

The receipt proves review, not submission. Keep sensitive values out of its payload.

## Confirmed Submission

After a confirmation page, portal state, or receipt proves submission:

```sh
valedictorian-cli --json runs step <run-id> --workspace "$VALEDICTORIAN_WORKSPACE" --type submitted --message "Submitted the application."
valedictorian-cli --json runs step <run-id> --workspace "$VALEDICTORIAN_WORKSPACE" --type confirmation_verified --message "Verified confirmation page and final URL."
```

Re-read the Application to obtain its current revision, then:

```sh
valedictorian-cli --json applications update-status <application-id> \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '{"expectedRevision":<revision>,"actor":{"id":"<agent-id>","type":"agent"},"status":"submitted","rationale":"Submission confirmation verified."}'

valedictorian-cli --json runs complete <run-id> \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --status completed \
  --outcome submitted \
  --summary "Application submission confirmed."
```

## Final Verification

```sh
valedictorian-cli --json applications get <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json applications history <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"
valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE" --run-type application_attempt --subject-application-id <application-id>
```

If readback disagrees with the mutation response, stop. Do not retry blindly.
