---
name: valedictorian-cli
description: Operate the Valedictorian CLI across the canonical Capture → Job → Opportunity → Application lifecycle, Action Queue, workflow runs, profiles, secrets, and scoring. Use when an agent must inspect lifecycle state, promote records safely, resolve warnings or duplicates, update pursuit state, or automate Valedictorian through its supported command surface without direct database or ad hoc HTTP access.
---

# Valedictorian CLI

Use the Valedictorian CLI as the first-choice interface for Valedictorian job automation data. Do not use ad hoc HTTP calls, direct database writes, or reimplemented request logic unless the user explicitly asks and you document why the CLI cannot satisfy the task.

## Prerequisites

Verify the CLI surface before using it in a new environment:

```sh
valedictorian-cli --version
valedictorian-cli doctor
valedictorian-cli context
valedictorian-cli captures --help
```

If installing the npm package while Valedictorian is still in alpha, install the alpha dist-tag:

```sh
pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g @sparxie/valedictorian-cli@alpha
```

When working from a `cravessant/valedictorian` product checkout, use the local
build instead:

```sh
pnpm build
node dist/valedictorian.js doctor
```

Commands default to human-readable output. Use `--json` when another tool, script, or agent needs structured diagnostics or record fields. Workspace-scoped commands require `--workspace <id-or-name>`; the flag may be placed before the command or on the command itself. Only root commands such as `doctor`, `context`, `workspaces list`, and `workspaces open/create` are workspace-neutral. If the API URL is not local, state the sanitized target URL and wait for clear user intent before changing data.

The lifecycle commands require the `0.1.0-alpha.21` command surface. If
`captures`, `jobs`, and `opportunities` are absent from root help, stop and
report that the installed CLI predates lifecycle parity; do not substitute
legacy sourcing commands.

## Lifecycle Model

- **Capture** preserves an attributable observation: provenance, Evidence mode, payload, and evidence. Correct it by revision; never reinterpret it as canonical state.
- **Job** owns canonical facts, availability, external identities, and exact Capture revision/evidence references. Provider ids and URLs never replace its internal Job id.
- **Opportunity** records this workspace's evaluation and disposition for one Job. It does not copy Job facts.
- **Application** records the decision to pursue one Opportunity and Job. It owns pursuit status, mutable links/display edits, and an intentionally frozen Job snapshot.

The normal progression is `captures promote-to-job` → `jobs promote-to-opportunity` → `opportunities promote-to-application`. Do not skip a boundary merely to save commands. Direct downstream `create` commands are for an explicitly requested manual/import/repair path.

## Core Workflow

1. Locate the CLI:
   - Prefer an installed `valedictorian-cli` binary when available.
   - In a source checkout, run the CLI package build if `dist/` may be stale, then use `node packages/cli/dist/valedictorian.js`.
   - Run `valedictorian-cli doctor --workspace <id-or-name>` or `node packages/cli/dist/valedictorian.js doctor --workspace <id-or-name>` before the first API operation in a new environment when a workspace is known.
   - Run `valedictorian-cli context` to print the API target and workspace discovery state without mutating anything.
   - Run `--help` on the nearest command before unfamiliar commands.
2. Configure the API environment:
   - `VALEDICTORIAN_API_URL` points at the running Valedictorian API.
   - `VALEDICTORIAN_API_TOKEN` is optional only when the target API allows it.
   - Keep a shell variable such as `VALEDICTORIAN_WORKSPACE=workspace-id-or-name` for examples, but pass it explicitly as `--workspace "$VALEDICTORIAN_WORKSPACE"`.
   - Never print, commit, echo, log, or persist token values; avoid token literals in shell history, `env` output, `printenv`, `set -x`, chat, and temp files.
3. Inspect before mutating:
   - Use `valedictorian-cli --json context` and `valedictorian-cli --json workspaces list` to find workspace ids/names. For local targets, these commands can fall back to the desktop `workspaces.json` registry if the API workspace endpoint is unavailable.
   - Use the `captures`, `jobs`, `opportunities`, and `applications` `list|get|history` commands to identify lifecycle records. Use `action-queue list`, `runs list`, `profile get|agent-context|validate`, and `secrets list` for the supporting surfaces.
   - Treat lifecycle `create`, `correct-*`, `update-*`, `remove`, `restore`, link mutations, and promotions as mutations. `scores record`, `runs start|step|complete`, `profile update|format|restore`, and `secrets upsert|delete` are also mutations.
   - Before any mutation, identify the sanitized target URL and whether it is local, staging, or production. Require clear user intent before mutating non-local data.
   - Read the source record and its history before a promotion. Record the current revision and linked ids needed by optimistic guards.
   - Be especially cautious with lifecycle promotions and remove commands using `unlink_dependents` or `cascade_tombstone`.
4. Run the smallest command that satisfies the user request.
5. For mutations, verify by re-reading the target, its history, and its upstream lineage.

## Common Workflows

- Investigate an Action Queue item: list the queue, then read the referenced application with `applications get`, its immutable history with `applications history`, and technical records with `applications attempts list` or `applications events list`.
- Record broader application work with `runs start|step|complete --run-type application_attempt`; application attempt and event lifecycle records are read-only in this client contract.
- Create a Capture with explicit `--evidence-mode`, `--adapter-id`, `--adapter-kind`, `--adapter-version`, and `--observed-at`. `reported` may allow Capture → Job retrieval; `ats_details_provided` prohibits that fallback. Later boundaries never retrieve the posting again.
- Promote one boundary at a time with a stable idempotency key. A warning is nonterminal but must be reported; never invent an override. A blocker stops the workflow. For `deterministic_duplicate`, inspect the conflicting resource and obtain an exact `attach` or `merge` decision instead of guessing.
- Supply complete contract-owned mutation payloads through strict `--input-json`. Omit the positional source id from the JSON. Remove commands require an actor, rationale, and deterministic dependent-resource choice.
- Score an application: inspect the application first, then use `valedictorian-cli --json scores record <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"`, then re-read the application or score output if available.
- Migrate profile data: write the unified public profile document with `valedictorian-cli --json profile update --workspace "$VALEDICTORIAN_WORKSPACE" --input-json profile.json --expected-revision <revision>`, validate with `profile validate`, normalize with `profile format`, and use `profile restore` only with explicit confirmation. Write credential values with `valedictorian-cli --json secrets upsert <key> --workspace "$VALEDICTORIAN_WORKSPACE" --kind password --label "Label" --value-file "$SECRET_VALUE_FILE"`. Verify using `profile get`, `profile agent-context`, and `secrets list`; do not invent missing DOB or self-identification facts; keep SSN and credentials on the secret path; never print password values in chat or logs. Prefer `secrets run --workspace "$VALEDICTORIAN_WORKSPACE" --env NAME=secret://key -- <command>` (or `--stdin-secret` / `--fd`) for trusted local child commands instead of temp files or argv substitution.

## Command Reference

- Read `references/lifecycle.md` before creating, correcting, promoting, removing, restoring, or refreshing lifecycle records.
- Read `references/promotion-payloads.md` when constructing strict JSON for any of the three promotion commands.
- Read `references/commands.md` before any mutation, first use in a session, structured JSON flag, local repository invocation, or unfamiliar command family.

## Output Handling

Commands write human-readable output by default. Use leading `--json` (for example `valedictorian-cli --json applications list`) or command-level `--json` when the output must be parsed, compared, or passed to another tool. Use `jq` or save JSON stdout to a `mktemp` file outside the repo when comparing records, then delete the temp file after use. If a value begins with `-`, pass `--` before positional arguments so the scanner treats it as data.

## Troubleshooting

- Unknown command or option: run the nearest `--help`, then read `references/commands.md`.
- Structured blocker or exit 4: inspect its code, conflict id, allowed resolutions, supported choices, and dependent ids. Do not retry blindly.
- Revision conflict or HTTP 409: re-read the record and history, rebuild the decision against the current revision, and use a new operation only if the intended mutation changed.
- API unreachable: check the sanitized `VALEDICTORIAN_API_URL`, confirm the service is running, and do not retry mutations blindly.
- Unauthorized: set or refresh `VALEDICTORIAN_API_TOKEN` without printing the value.
- Ambiguous record: re-list or search by company, role, URL, or ID; ask the user if the target is still unclear.
- Local command behaves unexpectedly: rebuild with `pnpm build`, then retry the smallest read-only command before resuming mutations.
