# Database baseline

`0000_pglite_operational_baseline.sql` is the only journal entry, and
`src/db/schema.ts` is its only source of truth. Regenerate it with:

```sh
pnpm db:generate
```

That command deletes the previous SQL and `meta/`, runs `drizzle-kit generate`, and
appends `src/db/baseline-triggers.sql` to the generated file. It fails if the result
is not exactly one entry.

## Regeneration is not an upgrade

This is a pre-release schema with no installed databases, so the baseline is
regenerated in place rather than extended with a second entry. **An existing local
development database cannot be carried across a regeneration and must be deleted
and recreated** — remove `.data/pglite` (or the workspace's
`.valedictorian/pglite` directory) and let the app or `pnpm db:migrate` create it
again.

## Triggers

Drizzle Kit 0.31 has no trigger or function primitive, so the retained PostgreSQL
safeguards live in `src/db/baseline-triggers.sql` and are appended verbatim. They
cover append-only history, lineage and workspace-ownership integrity, connector
instance execution-scope immutability, and connector run instance/scope ownership —
invariants no column, check, or foreign key can state. Anything Drizzle can express
belongs in `src/db/schema.ts` instead. `src/db/pglite.baseline.test.ts` proves the
generated portion declares none of them, that every declared safeguard is installed
on a fresh database, and that each rejects the writes it exists to reject.
