/* eslint-disable no-console */
/**
 * Minimal migration runner for Vercel Postgres (@vercel/postgres).
 *
 * Usage:
 *   node scripts/db-migrate.cjs
 *
 * Requirements:
 *   - Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL / DATABASE_URL.
 *   - For local dev, this script will also attempt to load .env.local (without printing secrets).
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@vercel/postgres');

function loadDotEnvLocalIfNeeded() {
  const hasConn =
    Boolean(process.env.POSTGRES_URL_NON_POOLING) ||
    Boolean(process.env.POSTGRES_URL) ||
    Boolean(process.env.DATABASE_URL);
  if (hasConn) return;

  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (!key) continue;
    // remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

function getConnectionString() {
  return (
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    null
  );
}

function listMigrationFiles() {
  const dir = path.join(process.cwd(), 'migrations');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function ensureSchemaMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function alreadyApplied(client) {
  const res = await client.query(`SELECT id FROM schema_migrations ORDER BY id ASC;`);
  return new Set(res.rows.map((r) => String(r.id)));
}

async function applyMigration(client, id, sqlText) {
  await client.query('BEGIN;');
  try {
    await client.query(sqlText);
    await client.query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;', [id]);
    await client.query('COMMIT;');
  } catch (err) {
    await client.query('ROLLBACK;');
    throw err;
  }
}

async function main() {
  loadDotEnvLocalIfNeeded();

  const connectionString = getConnectionString();
  if (!connectionString) {
    console.error(
      'Missing Postgres connection string. Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL / DATABASE_URL.'
    );
    process.exit(1);
  }

  const client = createClient({ connectionString });
  await client.connect();

  try {
    await ensureSchemaMigrations(client);
    const applied = await alreadyApplied(client);
    const files = listMigrationFiles();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const fullPath = path.join(process.cwd(), 'migrations', file);
      const sqlText = fs.readFileSync(fullPath, 'utf8');
      console.log(`Applying migration ${file}...`);
      await applyMigration(client, file, sqlText);
      ran += 1;
      console.log(`Applied ${file}`);
    }

    if (ran === 0) console.log('No pending migrations.');
    else console.log(`Done. Applied ${ran} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});


