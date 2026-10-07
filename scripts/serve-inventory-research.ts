import { researchWorker } from '../src/server/inventory/research-runner';
void researchWorker().catch(() => { console.error(JSON.stringify({ event: 'research_worker_start_failed' })); process.exitCode = 1; });
