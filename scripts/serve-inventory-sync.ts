import { runSync } from './inventory-sync';
import { setTimeout } from 'node:timers/promises';
async function main() {
    do {
        try {
            await runSync();
        }
        catch {
            console.error(JSON.stringify({ event: 'inventory_sync_start_failed' }));
        }
        if (!process.argv.includes('--watch'))
            break;
        process.exitCode = 0;
        await setTimeout(300000);
    } while (true);
}
void main();
