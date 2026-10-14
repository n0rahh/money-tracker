import { House, Plus, Settings, Tags } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAddSheet } from '../context/AddSheetContext'

const links = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/categories', label: 'Categories', icon: Tags, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
]

export function AppShell() {
  const { openAdd } = useAddSheet()
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="mx-auto flex min-h-dvh max-w-5xl">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6 md:flex">
          <p className="mb-8 text-xl font-semibold tracking-tight text-accent">Money</p>
          <nav className="flex flex-1 flex-col gap-1">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-chip px-3 text-sm font-medium ${isActive ? 'bg-surface-2 text-accent' : 'text-muted hover:bg-surface-2 hover:text-text'}`
                }
              >
                <Icon size={18} /> {label}
              </NavLink>
            ))}
          </nav>
          <button type="button" onClick={openAdd} className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-chip bg-accent font-semibold text-accent-ink">
            <Plus size={18} /> Add
          </button>
        </aside>

        <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
          <main className="safe-pt flex-1 px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] md:px-8 md:pb-8">
            <div className="mx-auto w-full max-w-[640px]">
              <Outlet />
            </div>
          </main>

          <button
            type="button"
            aria-label="Add transaction"
            onClick={openAdd}
            className="fixed right-4 z-40 flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg transition active:scale-95 md:hidden"
            style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
          >
            <Plus size={28} />
          </button>

          <nav className="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:hidden">
            <div className="mx-auto flex max-w-5xl">
              {links.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-muted'}`
                  }
                >
                  <Icon size={22} /> {label}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </div>
  )
}
