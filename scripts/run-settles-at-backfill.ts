import { bootstrapScriptEnv } from '../src/lib/script-runtime.js';
import { backfillSettlesAt } from '../src/jobs/settles-at-backfill.js';

await bootstrapScriptEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);

const result = await backfillSettlesAt();
console.log(JSON.stringify(result, null, 2));
