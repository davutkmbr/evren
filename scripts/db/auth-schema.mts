/**
 * Prints the SQL of Better Auth's tables for the options worker/auth.ts uses (plugins decide the columns), from an
 * empty in-memory SQLite. Run after a Better Auth upgrade or a plugin change and turn the difference into a new file
 * under migrations/:
 *
 *   npx tsx scripts/db/auth-schema.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { anonymous } from 'better-auth/plugins';

const { compileMigrations } = await getMigrations({
  database: new DatabaseSync(':memory:'),
  plugins: [anonymous()],
  user: { deleteUser: { enabled: true } },
} as Parameters<typeof getMigrations>[0]);
console.log(await compileMigrations());
