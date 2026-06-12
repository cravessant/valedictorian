---
name: valedictorian-cli
description: Use when Codex needs to operate the Valedictorian job automation CLI for job applications, queues, workflow runs, sourcing findings, scoring, application attempts, or agent-driven application workflows. Helps agents locate and run the CLI safely, configure API environment variables, inspect JSON output, and perform requested mutations without bypassing the CLI.
---

# Valedictorian CLI

Use the Valedictorian CLI as the first-choice interface for Valedictorian job automation data. Prefer it over ad hoc HTTP calls, direct database writes, or reimplementing request logic.

## Workflow

1. Locate the CLI:
   - Prefer an installed `valedictorian-cli` binary when available.
   - In the CLI repo, run `pnpm build` if `dist/` may be stale, then use `node dist/valedictorian.js`.
   - Run `valedictorian-cli --help` or `node dist/valedictorian.js --help` before unfamiliar commands.
2. Configure the API environment:
   - `VALEDICTORIAN_API_URL` points at the running Valedictorian API.
   - `VALEDICTORIAN_API_TOKEN` is optional only when the target API allows it.
   - Never print, commit, or echo token values.
3. Inspect before mutating:
   - Use `applications list`, `applications get`, `queue list`, `runs list`, or `sourcing findings list` to identify records.
   - Treat `create`, `update`, `status`, `archive`, `note`, `link`, `attempts`, `scores record`, `runs start/step/complete`, `sourcing run`, and `sourcing findings promote` as mutations.
4. Run the smallest command that satisfies the user request.
5. For mutations, verify by re-reading the changed record or listing the affected collection.

## Command Reference

Read `references/commands.md` when you need exact command examples, required flags, or local development invocation details.

## Output Handling

The CLI writes JSON by default. Use `jq` or save stdout to a temporary file when comparing records. If a value begins with `-`, pass `--` before positional arguments so the scanner treats it as data.
