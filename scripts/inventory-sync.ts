/** Trusted-host worker. Only package identities go to OSV, never asset URLs,
 * scope, account credentials, fingerprint evidence, or private target details. */
import { readFileSync } from 'node:fs';
import { PostgresDatabase } from '../src/server/postgres';
import { InventoryStore, pgStorage } from '../src/server/inventory/store';
import { fetchPackageAdvisories, osvRequest, validateAdvisory } from '../src/server/inventory/advisories';
// Product labels/CPE guesses are deliberately excluded. Unsupported identities
// remain visible as inventory with no automatic advisory coverage claim.
export const ecosystems = new Set(['npm', 'PyPI', 'Go', 'crates.io', 'Maven', 'NuGet', 'Packagist', 'RubyGems', 'Hex', 'Pub', 'SwiftURL']);
export async function syncInventory(store: InventoryStore) {
    const q = store.storage;
    await q.query(`INSERT INTO inventory.worker_health(name,last_started_at,status) VALUES('osv',now(),'running')
    ON CONFLICT(name) DO UPDATE SET last_started_at=now(),status='running',detail=NULL`);
    let failed = 0, packages = 0;
    const components = (await q.query(`SELECT DISTINCT c.ecosystem,c.name FROM inventory.current_fingerprints f JOIN inventory.components c ON c.id=f.component_id WHERE f.presence='present' AND f.allow_advisory_lookup`)).rows;
    for (const c of components) {
        if (!ecosystems.has(c.ecosystem))
            continue;
        try {
            const documents = await fetchPackageAdvisories(c.ecosystem, c.name);
            for (const a of documents)
                await store.saveAdvisory(a);
            packages++;
        }
        catch {
            failed++;
        }
    }
    // Known IDs are refreshed independently. Their disappearance from a package
    // query is not proof of withdrawal; only the advisory itself can establish it.
    const known = (await q.query('SELECT id FROM inventory.advisories ORDER BY id')).rows;
    for (const a of known) {
        try {
            await store.saveAdvisory(validateAdvisory(await osvRequest(`/v1/vulns/${encodeURIComponent(a.id)}`)));
        }
        catch {
            failed++;
        }
    }
    await store.refreshAssessments();
    await store.expireResearch();
    await q.query(`UPDATE inventory.worker_health SET status=$1,detail=$2,last_success_at=CASE WHEN $3=0 THEN now() ELSE last_success_at END WHERE name='osv'`, [failed ? 'degraded' : 'healthy', `${packages} package queries; ${failed} failures`, failed]);
    if (failed)
        throw new Error('Advisory sync incomplete; retained prior assessments');
    return { packages };
}
export async function runSync() {
    process.umask(0o077);
    const url = process.env.INVENTORY_DATABASE_URL;
    if (!url)
        throw new Error('Missing INVENTORY_DATABASE_URL');
    const pg = new PostgresDatabase(url, process.env.INVENTORY_POSTGRES_CA_FILE ? readFileSync(process.env.INVENTORY_POSTGRES_CA_FILE, 'utf8') : undefined);
    try {
        await syncInventory(new InventoryStore(pgStorage(pg.pool)));
        console.log(JSON.stringify({ event: 'inventory_sync_completed' }));
    }
    catch {
        console.error(JSON.stringify({ event: 'inventory_sync_failed' }));
        process.exitCode = 1;
    }
    finally {
        await pg.close();
    }
}
