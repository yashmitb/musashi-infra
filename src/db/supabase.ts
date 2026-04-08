import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseEnv } from '../lib/env.js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (supabaseClient !== null) {
    return supabaseClient;
  }

  const { supabaseUrl, supabaseServiceKey } = getSupabaseEnv();
  supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClient;
}

export function setSupabaseForTests(client: SupabaseClient | null): void {
  supabaseClient = client;
}
