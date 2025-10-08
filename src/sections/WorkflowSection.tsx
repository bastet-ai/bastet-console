const steps = [
  {
    title: 'Connect nodes',
    detail: 'Register Bastet agents with secure tokens and see their heartbeat telemetry in seconds.'
  },
  {
    title: 'Launch campaigns',
    detail: 'Trigger repeatable scanning playbooks with environment-aware variables and guardrails.'
  },
  {
    title: 'Collaborate on findings',
    detail: 'Assign remediation, sync with ticketing tools, and verify fixes with one click re-tests.'
  }
];

export function WorkflowSection() {
  return (
    <section id="workflow">
      <div className="section-title">
        <span className="badge">How it works</span>
        <h2>Command Bastet operations from discovery to remediation</h2>
        <p>
          Every action in the console is purpose-built to get your security scans running faster and your findings closed
          sooner.
        </p>
      </div>
      <div className="grid" style={{ gap: '1.5rem' }}>
        {steps.map((step, index) => (
          <article key={step.title} className="feature-card" style={{ display: 'flex', gap: '1.25rem' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                background: 'rgba(14, 165, 233, 0.16)',
                color: '#0284c7',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.05rem'
              }}
            >
              {index + 1}
            </div>
            <div>
              <h3 style={{ marginTop: 0 }}>{step.title}</h3>
              <p style={{ color: '#475569', marginBottom: 0 }}>{step.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
