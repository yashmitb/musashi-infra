import { bootstrapScriptEnv } from '../src/lib/script-runtime.js';

const optionalVars = [
  'KALSHI_BASE_URL',
  'FULL_SYNC_PAGE_BUDGET',
  'FULL_SYNC_ABSOLUTE_MAX_PAGES',
  'CRAWL_ADVANCE_MAX_RUNS',
  'CRAWL_ADVANCE_MAX_DURATION_MS',
  'RESOLUTION_CHECK_MAX_MARKETS',
  'GAP_DETECTION_MAX_MARKETS',
];

try {
  await bootstrapScriptEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);

  console.log(
    JSON.stringify(
      {
        ok: true,
        required: {
          SUPABASE_URL: process.env.SUPABASE_URL,
          SUPABASE_SERVICE_KEY: redactSecret(process.env.SUPABASE_SERVICE_KEY ?? ''),
        },
        optional: Object.fromEntries(optionalVars.map((name) => [name, process.env[name] ?? '(default)'])),
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function redactSecret(value: string): string {
  if (value.length <= 8) {
    return '********';
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
