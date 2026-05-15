export function StatCard({ label, value, accent = false, hint }) {
  return (
    <section className={`card stat-card ${accent ? 'accent-card' : ''}`}>
      <p className="eyebrow">{label}</p>
      <strong className="stat-value">{value}</strong>
      {hint ? <p className="muted">{hint}</p> : null}
    </section>
  );
}
