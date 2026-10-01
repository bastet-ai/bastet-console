import type { User } from '../lib/authClient'

export function AdministrationSection({ user }: { user: User | null }) {
  return (
    <section id="administration">
      <div className="section-title">
        <span className="badge">Administration</span>
        <h2>Manage your Bastet campaigns</h2>
        <p>Organize campaigns, invite collaborators, and manage your scanning nodes from one dashboard.</p>
      </div>
      <div className="grid" style={{ gap: '1.25rem' }}>
        <article className="feature-card">
          <h3 style={{ marginTop: 0 }}>Authentication status</h3>
          <p style={{ color: '#475569' }}>
            {user
              ? `Signed in as ${user.email}. Open your dashboard to manage campaigns and nodes.`
              : 'Sign in with Google to access your campaigns and administrative controls.'}
          </p>
        </article>
      </div>
    </section>
  )
}
