import { RELEASES } from '@/lib/changelog'
import { useT } from '@/i18n/core'

export default function ChangelogPage() {
  const t = useT()
  return (
    <main id="page-changelog" className="flex-1 overflow-auto p-[18px_36px_48px]">
      <div className="flex flex-col">
        {RELEASES.map((r, i) => (
          <section key={r.version} className="cl-item">
            <aside className="cl-side">
              <span className="cl-date">{r.date}</span>
              <span className="cl-ver">{r.version}</span>
              {r.commit && <code className="cl-commit">{r.commit}</code>}
            </aside>
            <div>
              <header className="cl-head">
                <h3 className="cl-title">{r.title}</h3>
                {i === 0 && <span className="cl-cur">{t('当前版本')}</span>}
              </header>
              <ul className="cl-points">
                {r.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
