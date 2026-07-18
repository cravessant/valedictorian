# Upgrading Valedictorian workspaces

## Profile migration floor

Valedictorian `0.1.0-alpha.43` introduced the one-time migration from the
workspace SQLite profile to `.valedictorian/profile.json`. Before installing a
PGlite-only release, open every workspace once with any release from
`0.1.0-alpha.43` through `0.1.0-alpha.46` and confirm that `profile.json` was
created.

A PGlite-only release refuses to open a workspace when
`.valedictorian/valedictorian.sqlite` exists but `profile.json` does not. This
fail-closed check prevents a supported pre-JSON installation from silently
starting with an empty profile. Install `0.1.0-alpha.46`, open the workspace to
complete the migration, close it cleanly, and then install the newer release.

After `profile.json` exists, the PGlite-only runtime never reads, moves, converts, or deletes
the old SQLite file. Existing files under
`.valedictorian/profile-migration/`, including the verified source backup and
completion marker, remain immutable user evidence and may be archived by the
user after separately verifying their profile.

Operational application data is not imported from SQLite. The PGlite cutover
starts a fresh operational database while leaving the old operational file
untouched.
