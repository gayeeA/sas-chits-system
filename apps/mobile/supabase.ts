import 'react-native-url-polyfill/auto'
import * as SecureStore from 'expo-secure-store'
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: {
    storage: {
      getItem: SecureStore.getItemAsync,
      setItem: SecureStore.setItemAsync,
      removeItem: SecureStore.deleteItemAsync,
    },
    autoRefreshToken: true, persistSession: true, detectSessionInUrl: false,
  } })

export function supabaseErrorMessage(message: string) {
  if (/PGRST202|PGRST205|schema cache|could not find (?:the )?(?:table|view|function|relation)/i.test(message)) {
    return 'The Supabase database is missing objects required by this app. Run migrations 002_admin_features.sql through 011_merge_duplicate_members.sql in order after the base schema. Do not rerun schema.sql on a database with financial records.'
  }
  return message
}
