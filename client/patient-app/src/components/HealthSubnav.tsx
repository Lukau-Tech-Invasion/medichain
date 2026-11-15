/**
 * The My health pages, as a side list on a laptop (mockup p6). On a phone the
 * My health page itself is this list.
 */
import { Link, useLocation } from 'react-router-dom';
import { Activity, BookOpen, FileText, FlaskConical, Pill, Thermometer } from 'lucide-react';
import { useTranslation } from '@medichain/shared';

export function HealthSubnav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const items = [
    { to: '/records', label: t('myHealth.records'), icon: FileText },
    { to: '/lab-results', label: t('myHealth.labResults'), icon: FlaskConical },
    { to: '/medications', label: t('myHealth.medications'), icon: Pill },
    { to: '/vitals', label: t('myHealth.vitals'), icon: Activity },
    { to: '/symptoms', label: t('myHealth.trackCheck'), icon: Thermometer },
    { to: '/medical-history', label: t('myHealth.history'), icon: BookOpen },
  ];
  return (
    <nav aria-label={t('myHealth.title')} className="space-y-1">
      <p className="px-3 pb-1 text-sm text-content-muted">{t('myHealth.title')}</p>
      {items.map(({ to, label, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Link key={to} to={to} aria-current={active ? 'page' : undefined}
            className={`flex min-h-[48px] items-center gap-3 rounded-xl px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              active ? 'bg-selected font-semibold text-selected-fg' : 'text-content hover:bg-surface-sunken'
            }`}>
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
