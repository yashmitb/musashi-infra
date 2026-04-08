import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import postgres from 'postgres';

const host = process.env.SUPABASE_DB_HOST;
const port = Number(process.env.SUPABASE_DB_PORT ?? '5432');
const database = process.env.SUPABASE_DB_NAME;
const username = process.env.SUPABASE_DB_USER;
const password = process.env.SUPABASE_DB_PASSWORD;

if (!host || !database || !username || !password) {
  throw new Error('Missing one or more required database environment variables');
}

const sql = postgres({
  host,
  port,
  database,
  username,
  password,
  ssl: 'require',
  max: 1,
});

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
  const entries = (await readdir(migrationsDir)).filter((entry) => entry.endsWith('.sql')).sort();
  const applied = await sql<{ version: string }[]>`SELECT version FROM schema_migrations`;
  const appliedSet = new Set(applied.map((row) => row.version));
  const executed: string[] = [];

  for (const entry of entries) {
    if (appliedSet.has(entry)) {
      continue;
    }

    if (entry === '001_layer1_foundation.sql') {
      const existing = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'markets'
        ) AS exists
      `;

      if (existing[0]?.exists) {
        await sql`INSERT INTO schema_migrations (version) VALUES (${entry}) ON CONFLICT (version) DO NOTHING`;
        executed.push(`${entry}:marked`);
        continue;
      }
    }

    const migrationPath = new URL(`../supabase/migrations/${entry}`, import.meta.url);
    const migration = await readFile(migrationPath, 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(migration);
      await tx`INSERT INTO schema_migrations (version) VALUES (${entry})`;
    });
    executed.push(entry);
  }

  console.log(JSON.stringify({ ok: true, executed }, null, 2));
} finally {
  await sql.end();
}
