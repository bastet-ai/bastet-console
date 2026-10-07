import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { PostgresDatabase } from '../src/server/postgres';
process.umask(0o077);
const url = process.env.INVENTORY_MIGRATION_DATABASE_URL;
if (!url)
    throw new Error('Provide INVENTORY_MIGRATION_DATABASE_URL in a protected environment file');
const pg = new PostgresDatabase(url, process.env.INVENTORY_POSTGRES_CA_FILE ? readFileSync(process.env.INVENTORY_POSTGRES_CA_FILE, 'utf8') : undefined);
let client: PoolClient | undefined;
try {
    client = await pg.pool.connect();
    // Use a single connection and the established NOLOGIN owner. No temporary
    // migration login should accidentally retain ownership of the new evidence.
    await client.query('SET ROLE console_owner');
    if ((await client.query("SELECT to_regclass('console.campaigns') AS t")).rows[0].t === null)
        throw new Error('Console PostgreSQL schema is required');
    // CREATE SCHEMA intentionally refuses a partial/existing migration. No data
    // import, schema replacement, automatic fallback or startup DDL is permitted.
    await client.query(readFileSync(new URL('../migrations/postgres/0002_inventory.sql', import.meta.url), 'utf8'));
    console.log(JSON.stringify({ event: 'inventory_migration_applied', version: 1 }));
}
catch {
    console.error(JSON.stringify({ event: 'inventory_migration_failed', message: 'No automatic retry; inspect migration ownership and schema state' }));
    process.exitCode = 1;
}
finally {
    client?.release();
    await pg.close();
}
