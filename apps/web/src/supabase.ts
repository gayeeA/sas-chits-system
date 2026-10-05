import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('YOUR-PROJECT') &&
  !supabaseAnonKey.includes('YOUR-ANON-KEY'),
)

export const supabase = createClient(
  supabaseConfigured ? supabaseUrl : 'https://configuration-required.supabase.co',
  supabaseConfigured ? supabaseAnonKey : 'configuration-required',
)
