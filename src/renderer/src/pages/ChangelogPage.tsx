import { RELEASES } from '@/lib/changelog'

export default function ChangelogPage() {
  return (
    <main className="changelog-main">
      <div className="cl-list">
        {RELEASES.map((r, i) => (
          <section key={r.version} className="cl-item pop-in" style={{ animationDelay: `${Math.min(i * 45, 400)}ms` }}>
            <header className="cl-head">
              <span className="cl-ver">{r.version}</span>
              <span className="cl-title">{r.title}</span>
              {i === 0 && <span className="cl-cur">当前版本</span>}
              <span className="cl-meta">
                {r.date}
                {r.commit && <code>{r.commit}</code>}
              </span>
            </header>
            <ul className="cl-points">
              {r.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  )
}
