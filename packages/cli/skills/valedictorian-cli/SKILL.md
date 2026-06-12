---
name: valedictorian-cli
description: Use when an AI coding agent needs to operate the Valedictorian job automation CLI for job applications, queues, workflow runs, sourcing findings, scoring, application attempts, or agent-driven application workflows. Helps agents locate and run the CLI safely, configure API environment variables, request JSON output when needed, and perform requested mutations without bypassing the CLI.
---

# Valedictorian CLI

Use the Valedictorian CLI as the first-choice interface for Valedictorian job automation data. Do not use ad hoc HTTP calls, direct database writes, or reimplemented request logic unless the user explicitly asks and you document why the CLI cannot satisfy the task.

## Prerequisites

Verify the CLI surface before using it in a new environment:

```sh
valedictorian-cli doctor
```

When working from the `valedictorian-cli` repository, use the local build instead:

```sh
pnpm build
node dist/valedictorian.js doctor
```

Commands default to human-readable output. Use `--json` when another tool, script, or agent needs structured diagnostics or record fields. If the API URL is not local, state the sanitized target URL and wait for clear user intent before changing data.

## Core Workflow

1. Locate the CLI:
   - Prefer an installed `valedictorian-cli` binary when available.
   - In the CLI repo, run `pnpm build` if `dist/` may be stale, then use `node dist/valedictorian.js`.
   - Run `valedictorian-cli doctor` or `node dist/valedictorian.js doctor` before the first API operation in a new environment.
   - Run `--help` on the nearest command before unfamiliar commands.
2. Configure the API environment:
   - `VALEDICTORIAN_API_URL` points at the running Valedictorian API.
   - `VALEDICTORIAN_API_TOKEN` is optional only when the target API allows it.
   - Never print, commit, echo, log, or persist token values; avoid token literals in shell history, `env` output, `printenv`, `set -x`, chat, and temp files.
3. Inspect before mutating:
   - Use `valedictorian-cli --json applications list`, `valedictorian-cli --json applications get`, `valedictorian-cli --json queue list`, `valedictorian-cli --json runs list`, or `valedictorian-cli --json sourcing findings list` to identify records for agent work.
   - Treat `create`, `update`, `status`, `archive`, `note`, `workflow`, `link add/update`, `attempts`, `scores record`, `runs start/step/complete`, `sourcing run`, `sourcing run --auto-promote`, and `sourcing findings create/update/promote` as mutations.
   - Before any mutation, identify the sanitized target URL and whether it is local, staging, or production. Require clear user intent before mutating non-local data.
   - Be especially cautious with irreversible or high-impact commands such as `applications archive`, `applications attempts complete --outcome submitted`, `sourcing findings promote`, and `sourcing run --auto-promote`.
4. Run the smallest command that satisfies the user request.
5. For mutations, verify by re-reading the changed record or listing the affected collection.

## Common Workflows

- Investigate a queued application: `valedictorian-cli --json queue list` -> `valedictorian-cli --json applications get` -> `valedictorian-cli --json applications attempts list` and, if needed, `valedictorian-cli --json runs list`.
- Record application work: use `valedictorian-cli --json applications attempts start/step/complete` for the real application attempt lifecycle. Use `valedictorian-cli --json runs start/step/complete --run-type application_attempt` for broader agent workflow audit trails.
- Review sourcing output: use `valedictorian-cli --json sourcing findings list` before `valedictorian-cli --json sourcing findings create/update/promote`; verify promoted findings by reading the resulting application or listing affected findings.
- Score an application: inspect the application first, then use `valedictorian-cli --json scores record`, then re-read the application or score output if available.

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
