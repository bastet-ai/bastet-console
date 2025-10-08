import type { User } from '../lib/supabaseClient';

interface AdministrationSectionProps {
  user: User | null;
  isSupabaseConfigured: boolean;
}

export function AdministrationSection({ user, isSupabaseConfigured }: AdministrationSectionProps) {
  return (
    <section id="administration">
      <div className="section-title">
        <span className="badge">Administration</span>
        <h2>Keep your Bastet deployment operational</h2>
        <p>
          Provision new scanning agents, manage API keys, and monitor the health of your Bastet deployment—all from one
          dashboard.
        </p>
      </div>

      {!isSupabaseConfigured ? (
        <div className="admin-alert" role="alert">
          Supabase credentials are missing. Update <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> to enable Google authentication and console access.
        </div>
      ) : (
        <div className="grid" style={{ gap: '1.25rem' }}>
          <article className="feature-card">
            <h3 style={{ marginTop: 0 }}>Authentication status</h3>
            <p style={{ color: '#475569' }}>
              {user
                ? `Signed in as ${user.email ?? 'authenticated user'}. You are ready to orchestrate scans and manage agent workloads.`
                : 'No user session detected. Use Google sign-in to access orchestration tools and administrative controls.'}
            </p>
          </article>
          <article className="feature-card">
            <h3 style={{ marginTop: 0 }}>Configuration checklist</h3>
            <ul style={{ color: '#475569', paddingLeft: '1.1rem', marginBottom: 0 }}>
              <li>Set up environment variables for Supabase URL and anon key.</li>
              <li>Register allowed redirect URIs in the Supabase dashboard.</li>
              <li>Invite your operations team via the Supabase Auth user management panel.</li>
            </ul>
          </article>
        </div>
      )}
    </section>
  );
}
