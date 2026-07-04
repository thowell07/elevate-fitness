import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const allowedEmails = (import.meta.env.VITE_ALLOWED_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const isAuthTokenError = (error) =>
  /jwt|expired|invalid token|refresh_token|not authenticated|unauthorized|401/i.test(
    String(error?.message || error?.code || '')
  );

export const isAllowedEmail = (email) => {
  if (!allowedEmails.length) return true;
  return allowedEmails.includes((email || '').toLowerCase());
};
