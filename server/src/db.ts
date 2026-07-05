import Database from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

// schema.ts is the single source of truth; DDL lives in generated migrations.
// after changing schema.ts run: npm run db:generate -w server
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface Store {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

export function createStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite };
}
