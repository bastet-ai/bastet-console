import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

const placeholderValues = ['YOUR_SUPABASE_URL', 'YOUR_SUPABASE_ANON_KEY'];

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !placeholderValues.some((value) => supabaseUrl.includes(value) || supabaseAnonKey.includes(value))
);

// Create Supabase client for database operations only (no auth)
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// User type for your custom authentication
export interface User {
  id: string;
  email: string;
  name: string;
  google_id: string;
  access_token?: string;
  refresh_token?: string;
  created_at: string;
  updated_at: string;
}

// Database operations for user management
export async function createUser(userData: Omit<User, 'id' | 'created_at' | 'updated_at'>): Promise<{ data: User | null; error: string | null }> {
  if (!supabase) {
    return { data: null, error: 'Supabase is not configured yet.' };
  }

  const { data, error } = await supabase
    .from('users')
    .insert([{
      ...userData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }])
    .select()
    .single();

  return { data, error: error?.message || null };
}

export async function getUserByGoogleId(googleId: string): Promise<{ data: User | null; error: string | null }> {
  if (!supabase) {
    return { data: null, error: 'Supabase is not configured yet.' };
  }

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('google_id', googleId)
    .single();

  return { data, error: error?.message || null };
}

export async function updateUserTokens(userId: string, accessToken: string, refreshToken?: string): Promise<{ error: string | null }> {
  if (!supabase) {
    return { error: 'Supabase is not configured yet.' };
  }

  const { error } = await supabase
    .from('users')
    .update({
      access_token: accessToken,
      refresh_token: refreshToken,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  return { error: error?.message || null };
}

// Google OAuth functions (you'll implement these with Google's OAuth library)
export async function signInWithGoogle(): Promise<{ error?: string }> {
  // TODO: Implement Google OAuth flow
  // 1. Redirect to Google OAuth
  // 2. Handle callback
  // 3. Get user info from Google
  // 4. Store/update user in Supabase database
  return { error: 'Google OAuth not implemented yet. Use Google OAuth library.' };
}

export async function signOut(): Promise<{ error?: string }> {
  // TODO: Clear local session/tokens
  // No need to call Supabase auth
  return {};
}
