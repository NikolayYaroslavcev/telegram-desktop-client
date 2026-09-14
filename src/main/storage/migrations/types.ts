import type Database from 'better-sqlite3'

/**
 * One forward-only schema change. `id` must be a stable, never-reused
 * integer (migration order), since it is both the sort key and the
 * dedupe key recorded in `schema_migrations`.
 */
export interface Migration {
  id: number
  name: string
  up(db: Database.Database): void
}
