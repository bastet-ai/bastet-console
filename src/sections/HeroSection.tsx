import type { ReactNode } from 'react';
import type { User } from '../lib/supabaseClient';

interface HeroSectionProps {
  onPrimaryAction: () => void;
  loading: boolean;
  user: User | null;
  isSupabaseConfigured: boolean;
  callout?: ReactNode;
}

export function HeroSection({ onPrimaryAction, loading, user, isSupabaseConfigured, callout }: HeroSectionProps) {
  const ctaLabel = user ? 'Open the console' : 'Sign in with Google';
  const subtitle = user
    ? 'Welcome back! Access the Bastet node console to orchestrate fleet-wide automations and security scans.'
    : 'Authenticate with Google to manage Bastet scanning nodes, automate deployments, and monitor telemetry.';

  return (
    <section className="hero" id="about">
      <div>
        <span className="badge">Coordinating distributed security scanning for Bastet</span>
        <h1>Operational command for your Bastet nodes</h1>
        <p>{subtitle}</p>
        <button
          type="button"
          className="cta-button"
          onClick={onPrimaryAction}
          disabled={loading || !isSupabaseConfigured}
        >
          {loading ? 'Preparing…' : ctaLabel}
        </button>
        {!isSupabaseConfigured && (
          <p style={{ marginTop: '1rem', color: '#b91c1c', fontWeight: 600 }}>
            Configure Supabase credentials to enable authentication.
          </p>
        )}
      </div>
      <div className="hero-card" role="complementary">
        <h3>Why Bastet Console?</h3>
        <ul>
          <li>Launch targeted vulnerability scans across distributed agents.</li>
          <li>Correlate findings and act on remediation playbooks quickly.</li>
          <li>Audit every action with tamper-resistant event history.</li>
        </ul>
        {callout}
      </div>
    </section>
  );
}
