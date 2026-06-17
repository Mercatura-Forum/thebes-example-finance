import { NavLink, Outlet } from 'react-router-dom'
import { SignOutChip } from '@thebes/sdk'

const tabs = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/budgets', label: 'Budgets' },
]

/** App shell: a precise, quiet header. The dashboard data carries the page. */
export function Layout() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <NavLink to="/" className="font-display text-xl font-bold tracking-tight">
            ledger<span className="text-[var(--color-act)]">/</span>
          </NavLink>
          <nav className="flex items-center gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    isActive ? 'bg-[var(--color-act)]/10 text-[var(--color-act-ink)]' : 'text-ink-soft hover:text-ink'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
            <SignOutChip className="ml-2 border-l border-[var(--color-line)] pl-3" />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-5xl px-5 py-8 text-xs text-ink-soft">
        Personal finance, on-chain — every account, transaction, and budget is
        yours. Balances are verified against the ledger.
      </footer>
    </div>
  )
}
