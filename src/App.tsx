import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from './components/Navbar';
import { Footer } from './components/Footer';
import { HeroSection } from './sections/HeroSection';
import { FeaturesSection } from './sections/FeaturesSection';
import { WorkflowSection } from './sections/WorkflowSection';
import { AdministrationSection } from './sections/AdministrationSection';
import {
  supabase,
  signInWithGoogle,
  signOut,
  isSupabaseConfigured,
  type User
} from './lib/supabaseClient';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setUser(null);
      return;
    }

    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignIn = useCallback(async () => {
    setLoading(true);
    setStatusMessage(null);
    const { error } = await signInWithGoogle();
    if (error) {
      setStatusMessage(error);
      setLoading(false);
    }
    // On success, Supabase will redirect to the OAuth flow.
  }, []);

  const handleSignOut = useCallback(async () => {
    setLoading(true);
    setStatusMessage(null);
    const { error } = await signOut();
    if (error) {
      setStatusMessage(error);
    }
    setLoading(false);
  }, []);

  const heroCallout = useMemo(() => {
    if (!statusMessage) {
      return null;
    }

    return (
      <div
        role="status"
        style={{
          background: 'rgba(14, 165, 233, 0.1)',
          border: '1px solid rgba(14, 165, 233, 0.3)',
          borderRadius: '14px',
          padding: '0.9rem 1.1rem',
          color: '#0f172a',
          fontWeight: 500
        }}
      >
        {statusMessage}
      </div>
    );
  }, [statusMessage]);

  return (
    <>
      <Navbar
        isAuthenticated={Boolean(user)}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        loading={loading}
      />
      <main>
        <HeroSection
          onPrimaryAction={user ? () => window.open('/app', '_self') : handleSignIn}
          loading={loading}
          user={user}
          isSupabaseConfigured={isSupabaseConfigured}
          callout={heroCallout}
        />
        <FeaturesSection />
        <WorkflowSection />
        <AdministrationSection user={user} isSupabaseConfigured={isSupabaseConfigured} />
      </main>
      <Footer />
    </>
  );
}
