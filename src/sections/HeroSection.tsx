import type { ReactNode } from 'react';

interface HeroSectionProps {
  user: any;
  onSignIn: () => void;
  callout?: ReactNode;
  signInLabel?: string;
}

export function HeroSection({ user, onSignIn, callout, signInLabel = 'Sign in with Google' }: HeroSectionProps) {
  const ctaLabel = user ? 'Open the console' : signInLabel;
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
          onClick={onSignIn}
        >
          {ctaLabel}
        </button>
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
