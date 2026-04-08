import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const { data, error } = await supabase.from('source_health').select('source').limit(1);

if (error) {
  console.error(JSON.stringify({ ok: false, message: error.message, code: error.code }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, rows: data?.length ?? 0 }, null, 2));
