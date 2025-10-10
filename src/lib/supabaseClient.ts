import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// TypeScript declaration for Google Identity Services
declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initCodeClient: (config: {
            client_id: string;
            scope: string;
            ux_mode: string;
            callback: (response: { code: string }) => void;
          }) => {
            requestCode: () => void;
          };
        };
      };
    };
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

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
    // Check if Google Identity Services is available
    if (typeof window === 'undefined' || !window.google) {
      return { error: 'Google Identity Services not loaded' };
    }

    // Use Google Identity Services for OAuth
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
      scope: 'openid email profile',
      ux_mode: 'popup',
      callback: async (response: any) => {
        try {
          // Exchange authorization code for tokens
          const tokenResponse = await fetch('/api/auth/google', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ code: response.code })
          });

          const data = await tokenResponse.json();

          if (data.success) {
            // Store token in localStorage
            localStorage.setItem('auth_token', data.token);
            // Return user data through a custom event
            window.dispatchEvent(new CustomEvent('googleAuthSuccess', { detail: data.user }));
          } else {
            window.dispatchEvent(new CustomEvent('googleAuthError', { detail: data.error }));
          }
        } catch (error) {
          console.error('Token exchange error:', error);
          window.dispatchEvent(new CustomEvent('googleAuthError', { detail: 'Token exchange failed' }));
        }
      }
    });

    // Request authorization code
    client.requestCode();

    // Return a promise that resolves when authentication completes
    return new Promise((resolve) => {
      const handleSuccess = (event: any) => {
        window.removeEventListener('googleAuthSuccess', handleSuccess);
        window.removeEventListener('googleAuthError', handleError);
        resolve({ user: event.detail });
      };

      const handleError = (event: any) => {
        window.removeEventListener('googleAuthSuccess', handleSuccess);
        window.removeEventListener('googleAuthError', handleError);
        resolve({ error: event.detail });
      };

      window.addEventListener('googleAuthSuccess', handleSuccess);
      window.addEventListener('googleAuthError', handleError);
    });

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
