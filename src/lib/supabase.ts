import { createClient } from '@supabase/supabase-js';
import { guardedSupabaseFetch } from './supabaseRequestGuard';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: guardedSupabaseFetch },
});
