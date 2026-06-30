---
name: valedictorian-cli
description: Use when an AI coding agent needs to operate the Valedictorian job automation CLI for job applications, the Action Queue worklist, workflow runs, sourcing findings, scoring, application attempts, or agent-driven application workflows. Helps agents locate and run the CLI safely, configure API environment variables, request JSON output when needed, and perform requested mutations without bypassing the CLI.
---

# Valedictorian CLI

Use the Valedictorian CLI as the first-choice interface for Valedictorian job automation data. Do not use ad hoc HTTP calls, direct database writes, or reimplemented request logic unless the user explicitly asks and you document why the CLI cannot satisfy the task.

## Prerequisites

Verify the CLI surface before using it in a new environment:

```sh
valedictorian-cli doctor
valedictorian-cli context
```

If installing the npm package while Valedictorian is still in alpha, install the alpha dist-tag:

```sh
pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g valedictorian-cli@alpha
```

When working from the `valedictorian-cli` repository, use the local build instead:

```sh
pnpm build
node dist/valedictorian.js doctor
```

Commands default to human-readable output. Use `--json` when another tool, script, or agent needs structured diagnostics or record fields. Workspace-scoped commands require `--workspace <id-or-name>`; the flag may be placed before the command or on the command itself. Only root commands such as `doctor`, `context`, `workspaces list`, and `workspaces open/create` are workspace-neutral. If the API URL is not local, state the sanitized target URL and wait for clear user intent before changing data.

## Core Workflow

1. Locate the CLI:
   - Prefer an installed `valedictorian-cli` binary when available.
   - In the CLI repo, run `pnpm build` if `dist/` may be stale, then use `node dist/valedictorian.js`.
   - Run `valedictorian-cli doctor --workspace <id-or-name>` or `node dist/valedictorian.js doctor --workspace <id-or-name>` before the first API operation in a new environment when a workspace is known.
   - Run `valedictorian-cli context` to print the API target and workspace discovery state without mutating anything.
   - Run `--help` on the nearest command before unfamiliar commands.
2. Configure the API environment:
   - `VALEDICTORIAN_API_URL` points at the running Valedictorian API.
   - `VALEDICTORIAN_API_TOKEN` is optional only when the target API allows it.
   - Keep a shell variable such as `VALEDICTORIAN_WORKSPACE=workspace-id-or-name` for examples, but pass it explicitly as `--workspace "$VALEDICTORIAN_WORKSPACE"`.
   - Never print, commit, echo, log, or persist token values; avoid token literals in shell history, `env` output, `printenv`, `set -x`, chat, and temp files.
3. Inspect before mutating:
   - Use `valedictorian-cli --json context` and `valedictorian-cli --json workspaces list` to find workspace ids/names. For local targets, these commands can fall back to the desktop `workspaces.json` registry if the API workspace endpoint is unavailable.
   - Use `valedictorian-cli --json applications list --workspace "$VALEDICTORIAN_WORKSPACE"`, `valedictorian-cli --json applications get <id> --workspace "$VALEDICTORIAN_WORKSPACE"`, `valedictorian-cli --json action-queue list --workspace "$VALEDICTORIAN_WORKSPACE"`, `valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE"`, or `valedictorian-cli --json sourcing findings list --workspace "$VALEDICTORIAN_WORKSPACE"` to identify records for agent work.
   - Treat `create`, `update`, `status`, `archive`, `note`, `workflow`, `link add/update`, `attempts`, `scores record`, `runs start/step/complete`, `sourcing run`, `sourcing run --auto-promote`, and `sourcing findings create/decide/import/update/promote` as mutations.
   - Before any mutation, identify the sanitized target URL and whether it is local, staging, or production. Require clear user intent before mutating non-local data.
   - Be especially cautious with irreversible or high-impact commands such as `applications archive`, `applications attempts complete --outcome submitted`, `sourcing findings promote`, and `sourcing run --auto-promote`.
4. Run the smallest command that satisfies the user request.
5. For mutations, verify by re-reading the changed record or listing the affected collection.

## Common Workflows

- Investigate an Action Queue item: `valedictorian-cli --json action-queue list --workspace "$VALEDICTORIAN_WORKSPACE"` -> `valedictorian-cli --json applications get <id> --workspace "$VALEDICTORIAN_WORKSPACE"` -> `valedictorian-cli --json applications attempts list <id> --workspace "$VALEDICTORIAN_WORKSPACE"` and, if needed, `valedictorian-cli --json runs list --workspace "$VALEDICTORIAN_WORKSPACE"`.
- Record application work: use `valedictorian-cli --json applications attempts start/step/complete --workspace "$VALEDICTORIAN_WORKSPACE"` for the real application attempt lifecycle. Use `valedictorian-cli --json runs start/step/complete --run-type application_attempt --workspace "$VALEDICTORIAN_WORKSPACE"` for broader agent workflow audit trails.
- Before completing an attempt as submitted, use `valedictorian-cli examples attempts complete --outcome submitted` to see the required `verification_receipt` step shape.
- Review sourcing output: use `valedictorian-cli --json sourcing findings list --workspace "$VALEDICTORIAN_WORKSPACE"` before `valedictorian-cli --json sourcing findings create/decide/import/update/promote --workspace "$VALEDICTORIAN_WORKSPACE"`; verify promoted findings by reading the resulting application or listing affected findings. Use `sourcing findings import --input-json findings.json` for batches. Use `--fit-notes` for historical/import context. Use `sourcing findings decide --merge-status blocked|not_fit|not_pursued|archived --disposition-reason ...` for manual dispositions; classifier-owned `blocker` and `duplicateNotes` are generated by policy and duplicate detection.
- Score an application: inspect the application first, then use `valedictorian-cli --json scores record <application-id> --workspace "$VALEDICTORIAN_WORKSPACE"`, then re-read the application or score output if available.

## Command Reference

Read `references/commands.md` before any mutation, first use in a session, structured JSON flag, local repository invocation, or unfamiliar command family.

## Output Handling

Commands write human-readable output by default. Use leading `--json` (for example `valedictorian-cli --json applications list`) or command-level `--json` when the output must be parsed, compared, or passed to another tool. Use `jq` or save JSON stdout to a `mktemp` file outside the repo when comparing records, then delete the temp file after use. If a value begins with `-`, pass `--` before positional arguments so the scanner treats it as data.

## Troubleshooting

- Unknown command or option: run the nearest `--help`, then read `references/commands.md`.
- API unreachable: check the sanitized `VALEDICTORIAN_API_URL`, confirm the service is running, and do not retry mutations blindly.
- Unauthorized: set or refresh `VALEDICTORIAN_API_TOKEN` without printing the value.
- Ambiguous record: re-list or search by company, role, URL, or ID; ask the user if the target is still unclear.
- Local command behaves unexpectedly: rebuild with `pnpm build`, then retry the smallest read-only command before resuming mutations.
