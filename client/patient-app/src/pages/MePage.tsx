/**
 * Me (mockup p3): who the patient is, who sees their records, their cards and
 * family, and the app. Every row opens one screen; the long menu of separate
 * pages it replaces is in `docs/PATIENT_APP_SIMPLIFICATION_PLAN_2026-11-01.md`.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Copy, CreditCard, Eye, Globe, LogOut, Shield, ShieldAlert, SlidersHorizontal, Users, ClipboardList } from 'lucide-react';
import {
  LOCALE_CONFIGS,
  confirmDialog,
  confirmSignOutWithUnsent,
  copyTextToClipboard,
  formatHealthId,
  listPatientAccessGrants,
  notifySuccess,
  useTranslation,
} from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

interface Row {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  detail?: string;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

function Group({ title, rows, children }: { title: string; rows: Row[]; children?: React.ReactNode }) {
  return (
    <section aria-labelledby={`me-${title}`} className="space-y-1.5">
      <h2 id={`me-${title}`} className="px-1 text-sm font-semibold text-content-secondary">{title}</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {rows.map(({ to, label, icon: Icon, detail }) => (
          <li key={to}>
            <Link to={to} className="flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
              <Icon className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
              <span className="flex-1 font-medium text-content">{label}</span>
              {detail && <span className="text-sm text-content-muted">{detail}</span>}
              <ChevronRight className="h-4 w-4 text-content-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
        {children}
      </ul>
    </section>
  );
}

export function MePage() {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const patient = usePatientAuthStore((s) => s.patient);
  const logout = usePatientAuthStore((s) => s.logout);
  const signingOut = useRef(false);
  const name = patient?.fullName ?? '';
  const [copyError, setCopyError] = useState('');
  // undefined until known: a failed read shows no count rather than "0".
  const [activeGrants, setActiveGrants] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!patient?.healthId) return;
    let cancelled = false;
    listPatientAccessGrants(patient.healthId)
      .then((body) => { if (!cancelled) setActiveGrants(body.grants.filter((g) => g.status === 'active').length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [patient?.healthId]);

  const copyId = async (id: string) => {
    if (await copyTextToClipboard(id)) {
      setCopyError('');
      notifySuccess(t('emergency.copySuccess'));
    } else {
      setCopyError(t('emergency.copyFailed'));
    }
  };

  const signOut = async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      // Records saved without signal and not yet sent are named first.
      const leave = await confirmSignOutWithUnsent({
        title: t('forms.unsentTitle'),
        message: (n) => t('forms.unsentMessage', { n: String(n) }),
        confirm: t('forms.unsentConfirm'),
        cancel: t('forms.unsentCancel'),
      });
      if (!leave) return;
      const confirmed = await confirmDialog({
        title: t('settings.signOutConfirm'),
        message: t('settings.signOutConfirmBody'),
        confirmLabel: t('settings.signOut'),
        destructive: true,
      });
      if (!confirmed) return;
      await logout();
      navigate('/login');
    } finally {
      signingOut.current = false;
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-8 md:p-5">
      <h1 className="text-2xl font-bold text-content">{t('me.title')}</h1>

      {/* The copy button sits beside the link, not inside it: a button nested
          in a link is two controls in one target. */}
      <div className="flex items-center gap-1 rounded-2xl border border-border bg-surface pr-2">
        <Link to="/profile" aria-label={t('me.openDetails', { name })}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-4 hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-lg font-bold text-brand-subtle-fg" aria-hidden="true">
            {initials(name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-content">{name}</span>
            <span className="block text-sm text-content-muted">
              {t('me.healthId')} <span className="font-mono text-content-secondary">{formatHealthId(patient?.healthId)}</span>
            </span>
            <span className="block text-sm text-brand">{t('me.myDetails')}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-content-muted" aria-hidden="true" />
        </Link>
        {patient?.healthId && (
          <button type="button" onClick={() => void copyId(patient.healthId)} aria-label={t('me.copyHealthId')} title={t('me.copyHealthId')}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-content-muted hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <Copy className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
      {copyError && <p role="alert" className="text-sm text-critical-subtle-fg">{copyError}</p>}

      <Group title={t('me.whoSees')} rows={[
        { to: '/privacy', label: t('me.whoCanSee'), icon: Shield,
          detail: activeGrants === undefined ? undefined : t('me.grantCount', { n: String(activeGrants) }) },
        { to: '/privacy?view=viewed', label: t('me.whoViewed'), icon: Eye },
        { to: '/privacy?view=viewed#emergency-access', label: t('me.emergencyHistory'), icon: ShieldAlert },
      ]} />

      <Group title={t('me.cardsFamily')} rows={[
        { to: '/emergency-card', label: t('me.emergencyCard'), icon: CreditCard },
        { to: '/cards?view=family', label: t('me.family'), icon: Users },
        { to: '/cards', label: t('me.insurance'), icon: ClipboardList },
      ]} />

      <Group title={t('me.app')} rows={[
        { to: '/settings?view=language', label: t('me.language'), icon: Globe, detail: LOCALE_CONFIGS[locale]?.nativeName },
        { to: '/settings', label: t('me.settings'), icon: SlidersHorizontal },
      ]}>
        <li>
          <button type="button" onClick={() => void signOut()}
            className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left font-medium text-critical-subtle-fg hover:bg-critical-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
            <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t('settings.signOut')}
          </button>
        </li>
      </Group>
    </div>
  );
}

export default MePage;
