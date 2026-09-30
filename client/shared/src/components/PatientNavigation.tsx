import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, Search, X } from 'lucide-react';

interface NavigationSection {
  label: string;
  items: { path: string; label: string; icon: ComponentType<{ className?: string }> }[];
}

/** Show every patient destination in a searchable, keyboard-accessible drawer. */
export function PatientNavigation({ sections, onClose, onLogout }: {
  sections: NavigationSection[];
  onClose: () => void;
  onLogout: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const { pathname } = useLocation();
  const initialPath = useRef(pathname);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialog.current?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    if (pathname !== initialPath.current) closeRef.current();
  }, [pathname]);

  const filtered = sections.map(section => ({ ...section, items: section.items.filter(item =>
    `${section.label} ${item.label}`.toLowerCase().includes(query.trim().toLowerCase()))
  })).filter(section => section.items.length);

  return (
    <dialog ref={dialog} aria-labelledby="patient-menu-title" onCancel={onClose}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-[100dvh] max-h-none w-full max-w-sm border-0 p-0 bg-surface text-content shadow-xl backdrop:bg-black/50">
      <div className="flex h-full flex-col">
        <header className="shrink-0 border-b border-border p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-3">
            <h2 id="patient-menu-title" className="text-xl font-semibold">All pages</h2>
            <button autoFocus type="button" onClick={onClose} aria-label="Close navigation"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
              <X className="h-6 w-6" />
            </button>
          </div>
          <label htmlFor="patient-menu-search" className="mt-3 block text-sm text-content-muted">Find a page</label>
          <div className="relative mt-1">
            <Search aria-hidden="true" className="absolute left-3 top-3 h-5 w-5 text-content-muted" />
            <input id="patient-menu-search" type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Try records, language or family" className="min-h-[44px] w-full rounded-lg border border-border-interactive bg-surface pl-10 pr-3 text-base text-content focus:outline-brand" />
          </div>
        </header>
        <nav aria-label="All patient pages" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {filtered.map(section => (
            <section key={section.label} aria-label={section.label} className="mb-5">
              <h3 className="mb-2 px-3 text-sm font-semibold text-content-muted">{section.label}</h3>
              {section.items.map(({ path, label, icon: Icon }) => (
                <Link key={path} to={path} onClick={onClose} aria-current={pathname === path ? 'page' : undefined}
                  className={`flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${pathname === path ? 'bg-brand-subtle text-brand-subtle-fg font-semibold' : 'text-content hover:bg-surface-sunken'}`}>
                  <Icon className="h-5 w-5 shrink-0" /><span>{label}</span>
                </Link>
              ))}
            </section>
          ))}
          {filtered.length === 0 && <p role="status" className="p-3 text-content-muted">No pages found. Try another word or clear your search.</p>}
        </nav>
        <footer className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onLogout} className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-content hover:bg-surface-sunken">
            <LogOut className="h-5 w-5" />Sign out
          </button>
        </footer>
      </div>
    </dialog>
  );
}
