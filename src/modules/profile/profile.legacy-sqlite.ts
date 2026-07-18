import type Database from 'better-sqlite3'

/**
 * better-sqlite3 handle for one-time legacy profile source reads and verified
 * backups only. Not an operational SQLite database or migration surface.
 */
export type LegacySqliteDatabase = Database.Database
