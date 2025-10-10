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

// Google OAuth functions using our Next.js API routes
export async function signInWithGoogle(): Promise<{ user?: User; error?: string }> {
  try {
    // Load Google OAuth library dynamically
    const { gapi } = await import('gapi-script');
    
    // Initialize Google API
    await gapi.load('auth2', async () => {
      await gapi.auth2.init({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
      });
    });

    // Sign in with Google
    const authInstance = gapi.auth2.getAuthInstance();
    const googleUser = await authInstance.signIn();
    const idToken = googleUser.getAuthResponse().id_token;

    // Send to our backend API
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idToken })
    });

    const data = await response.json();

    if (data.success) {
      // Store token in localStorage
      localStorage.setItem('auth_token', data.token);
      return { user: data.user };
    } else {
      return { error: data.error || 'Authentication failed' };
    }
  } catch (error) {
    console.error('Google OAuth error:', error);
    return { error: 'Failed to authenticate with Google' };
  }
}

export async function signOut(): Promise<{ error?: string }> {
  try {
    // Call our logout API
    await fetch('/api/auth/logout', {
      method: 'POST'
    });

    // Clear local storage
    localStorage.removeItem('auth_token');
    
    return {};
  } catch (error) {
    console.error('Logout error:', error);
    return { error: 'Failed to logout' };
  }
}

// Verify current session
export async function verifySession(): Promise<{ user?: User; error?: string }> {
  try {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      return { error: 'No session found' };
    }

    const response = await fetch('/api/auth/verify', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (data.valid) {
      return { user: data.user };
    } else {
      localStorage.removeItem('auth_token');
      return { error: 'Invalid session' };
    }
  } catch (error) {
    console.error('Session verification error:', error);
    return { error: 'Failed to verify session' };
  }
}
