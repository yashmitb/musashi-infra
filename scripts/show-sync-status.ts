import { readFile } from 'node:fs/promises';

import { createClient } from '@supabase/supabase-js';

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

const rawEnv = await readFile(new URL('../.env', import.meta.url), 'utf8');
const env = parseEnv(rawEnv);

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const [runsResult, checkpointsResult, healthResult] = await Promise.all([
  supabase.from('ingestion_runs').select('*').order('started_at', { ascending: false }).limit(5),
  supabase.from('sync_checkpoints').select('*'),
  supabase.from('source_health').select('*'),
]);

console.log(
  JSON.stringify(
    {
      runs: runsResult.data,
      runsError: runsResult.error,
      checkpoints: checkpointsResult.data,
      checkpointsError: checkpointsResult.error,
      sourceHealth: healthResult.data,
      sourceHealthError: healthResult.error,
    },
    null,
    2,
  ),
);
