import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { inventoryClient } from '../src/server/inventory/client';
import { reconFingerprints } from '../src/server/inventory/recon';
import { canonicalAsset, object, text } from '../src/server/inventory/model';
async function main() {
    const [file, mappingFile] = process.argv.slice(2);
    if (!file || !mappingFile)
        throw new Error('Usage: import-recon-inventory.ts observations.jsonl deployment-map.json');
    const campaign = text(process.env.INVENTORY_CAMPAIGN_ID, 'campaign ID'), mapping = object(JSON.parse(readFileSync(mappingFile, 'utf8')), 'deployment map');
    const send = inventoryClient(process.env.INVENTORY_API_URL!, process.env.INVENTORY_WORKER_TOKEN!);
    let imported = 0, skipped = 0, line = 0;
    const stream = createReadStream(file), lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
        for await (const value of lines) {
            line++;
            if (!value.trim())
                continue;
            if (Buffer.byteLength(value) > 262144)
                throw new Error('Oversized recon record');
            const row = object(JSON.parse(value));
            if (row.tool !== 'httpx') {
                skipped++;
                continue;
            }
            const target = canonicalAsset({ kind: 'url', value: row.target }).value;
            const deployment = text(mapping[target], 'explicit target deployment mapping', 100);
            for (const fingerprint of reconFingerprints(row, deployment)) {
                await send({ action: 'fingerprint', campaign_id: campaign, ...fingerprint });
                imported++;
            }
        }
    }
    catch {
        console.error(JSON.stringify({ event: 'inventory_recon_record_failed', line }));
        throw new Error('Import failed; retained evidence can be replayed safely');
    }
    finally {
        lines.close();
        stream.destroy();
    }
    console.log(JSON.stringify({ event: 'inventory_recon_imported', imported, skipped }));
}
void main().catch(() => { console.error(JSON.stringify({ event: 'inventory_recon_import_failed', reason: 'Check protected input files, explicit mappings and worker configuration; replay retained JSONL after correction' })); process.exitCode = 1; });
