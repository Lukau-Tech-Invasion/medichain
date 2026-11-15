import { Suspense, createContext, useContext, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';

/**
 * One screen built from pages that used to stand alone (patient-app
 * simplification plan, 2026-11-01). Each former page becomes a section behind a
 * tab; the open section is in `?view=` so the old addresses can redirect to it
 * and a link in a message lands on the right part of the screen.
 *
 * A section renders the former page whole, so every read it made is still made
 * (rule 10). Inside a section the page's own title becomes an <h2> through
 * `PageTitle`, leaving the screen one <h1>.
 */

const EmbeddedContext = createContext(false);

export interface ScreenSection {
  id: string;
  label: string;
  render: () => ReactNode;
}

export function MergedScreen({ title, sections }: { title: string; sections: ScreenSection[] }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const active = sections.find((s) => s.id === requested) ?? sections[0];
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const open = (id: string) => {
    const next = new URLSearchParams(params);
    if (id === sections[0].id) next.delete('view');
    else next.set('view', id);
    setParams(next, { replace: true });
  };

  // Arrow keys move between tabs, as the ARIA tabs pattern expects.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + sections.length) % sections.length;
    open(sections[next].id);
    tabs.current[next]?.focus();
  };

  return (
    <div className="pb-6">
      <div className="px-4 pt-4 md:px-5">
        <h1 className="text-2xl font-bold text-content">{title}</h1>
        <div role="tablist" aria-label={title} className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {sections.map((section, index) => {
            const selected = section.id === active.id;
            return (
              <button
                key={section.id}
                ref={(el) => { tabs.current[index] = el; }}
                id={`${base}-tab-${section.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${base}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => open(section.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                  selected ? 'bg-brand text-brand-fg' : 'bg-surface-sunken text-content-secondary hover:bg-surface'
                }`}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${active.id}`}>
        <EmbeddedContext.Provider value>
          {/* Keyed so a section's state starts fresh each time it is opened. */}
          <div key={active.id}>
            <Suspense fallback={<p role="status" className="p-4 text-sm text-content-muted">…</p>}>{active.render()}</Suspense>
          </div>
        </EmbeddedContext.Provider>
      </div>
    </div>
  );
}

/**
 * A page's title: the screen's <h1> on its own; inside a merged screen an <h2>
 * that only a screen reader announces, because the selected tab already shows
 * the same words.
 */
export function PageTitle({ className, children }: { className?: string; children: ReactNode }) {
  const embedded = useContext(EmbeddedContext);
  return embedded ? <h2 className="sr-only">{children}</h2> : <h1 className={className}>{children}</h1>;
}

/**
 * A page's coloured header. Inside a merged screen it is reduced to its
 * one-line description: a second banner under the tabs repeated the screen's
 * title and pushed the content below the fold on a phone.
 */
export function PageBanner({ title, subtitle, icon, gradient, aside }: {
  title: ReactNode;
  subtitle: ReactNode;
  icon: ReactNode;
  /** Tailwind gradient classes, e.g. `from-teal-700 to-cyan-800`. */
  gradient: string;
  /** Shown beside the title in both forms (e.g. an online/offline pill). */
  aside?: ReactNode;
}) {
  const embedded = useContext(EmbeddedContext);
  if (embedded) {
    return (
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 md:px-5">
        <PageTitle>{title}</PageTitle>
        <p className="flex-1 text-sm text-content-secondary">{subtitle}</p>
        {aside}
      </div>
    );
  }
  return (
    <div className={`bg-gradient-to-r ${gradient} p-6 text-white`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {icon}
          <PageTitle className="text-2xl font-bold">{title}</PageTitle>
        </div>
        {aside}
      </div>
      <p className="text-white">{subtitle}</p>
    </div>
  );
}

/** True when the page is rendered as a section of a merged screen. */
export function useEmbedded(): boolean {
  return useContext(EmbeddedContext);
}

/**
 * The redirect from a retired page's address to the screen that absorbed it.
 * Keeps the query the old address carried — a video-visit link is
 * `/telehealth?session=…&join=1`, and dropping `session` would land the patient
 * on the list instead of in their call — and adds the section to open.
 */
export function MovedTo({ path, view }: { path: string; view?: string }) {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  if (view) params.set('view', view);
  const query = params.toString();
  return <Navigate to={`${path}${query ? `?${query}` : ''}${hash}`} replace />;
}
