import { runFullSync } from '../src/jobs/full-sync.js';

const result = await runFullSync();
console.log(JSON.stringify(result, null, 2));
