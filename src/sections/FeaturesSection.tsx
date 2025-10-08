const features = [
  {
    title: 'Fleet orchestration',
    description:
      'Coordinate distributed Bastet scanners with one-click campaign launches, templated runs, and rolling updates.'
  },
  {
    title: 'Insightful reporting',
    description:
      'Blend vulnerability data, host metadata, and mitigation tracking into a consolidated operational picture.'
  },
  {
    title: 'Secure by design',
    description:
      'Single-sign-on with Google, scoped access tokens, and audit-grade event retention keep your perimeter tight.'
  }
];

export function FeaturesSection() {
  return (
    <section id="features">
      <div className="section-title">
        <span className="badge">Mission highlights</span>
        <h2>Built for relentless security teams</h2>
        <p>
          Bastet Console provides the operational backbone for your distributed scanning network—making it easy to
          collaborate, act, and report.
        </p>
      </div>
      <div className="grid grid-3">
        {features.map((feature) => (
          <article key={feature.title} className="feature-card">
            <h3 style={{ marginTop: 0 }}>{feature.title}</h3>
            <p style={{ color: '#475569', marginBottom: 0 }}>{feature.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
