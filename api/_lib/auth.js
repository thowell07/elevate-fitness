// Verifies the Supabase access token sent as `Authorization: Bearer <token>`.
// createVerifier is injectable so tests never call Supabase.

import { MealError } from './errors.js';

export function bearerToken(headers = {}) {
  const raw = headers.authorization ?? headers.Authorization ?? '';
  const value = Array.isArray(raw) ? raw[0] : String(raw);
  const match = value.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

export function parseAllowedEmails(value) {
  return String(value || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Returns async (token) => user, or throws MealError(401 / 503).
// `createClient` is @supabase/supabase-js createClient (injected for tests).
export function createVerifier({ supabaseUrl, anonKey, allowedEmails, createClient }) {
  const allowed = parseAllowedEmails(allowedEmails);
  let client = null;
  return async function verify(token) {
    if (!token) throw new MealError(401, 'Sign in again to log meals.');
    if (!supabaseUrl || !anonKey || !createClient) {
      throw new MealError(503, 'Meal logging is not set up on the server yet.', { code: 'not_configured' });
    }
    if (!client) {
      client = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }
    let result;
    try {
      result = await client.auth.getUser(token);
    } catch {
      throw new MealError(503, 'Sign-in could not be checked right now. Try again.', { code: 'auth_unreachable' });
    }
    const user = result?.data?.user;
    const error = result?.error;
    // supabase-js reports network trouble as an error object, not a throw.
    if (error && (error.name === 'AuthRetryableFetchError' || (typeof error.status === 'number' && error.status >= 500))) {
      throw new MealError(503, 'Sign-in could not be checked right now. Try again.', { code: 'auth_unreachable' });
    }
    if (error || !user) throw new MealError(401, 'Sign in again to log meals.');
    if (allowed.length && !allowed.includes(String(user.email || '').toLowerCase())) {
      throw new MealError(401, 'This account is not allowed to log meals.');
    }
    return user;
  };
}
