/**
 * The patient workspace: choose the patient once, then every form knows them.
 *
 * `/patients/:patientId` is the chart home; `/patients/:patientId/:form` mounts
 * that form inside the same shell. The reason for opening the chart is asked
 * once (`AccessReasonGate`); the banner keeps two identifiers and the allergies
 * in view; "This visit" lists what was saved; "Close patient" catches unsaved
 * drafts before the next patient. Design: docs/FRONTEND_WORKFLOW_AND_MOTION_PLAN.md §2.
 *
 * One patient at a time is deliberate (ONC and the Joint Commission recommend
 * it; errors rose with several records open in the JAMA 2019 trial's post hoc
 * analysis) and is paired with strong identity cues rather than relied on alone.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AlertTriangle, ChevronDown, History, Search, X } from 'lucide-react';
import {
  ModalPanel,
  draftsForPatient,
  formatDateOnly,
  formatTimestamp,
  getApiClient,
  getPatient,
  unsavedForms,
  clearUnsavedForms,
  clearDraft,
  returnPathFrom,
  useMotionNavigate,
  useTranslation,
} from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { AccessReasonGate } from '../components/AccessReasonGate';
import { useAuthStore } from '../store/authStore';
import { rolesOwningRoute } from '../config/navigation';
import { PatientWorkspaceContext } from './PatientWorkspaceContext';
import { AdmissionControl } from './AdmissionControl';
import { AmbulanceRunStrip } from '../ems/AmbulanceRunStrip';
import { workspacePath, workspaceRail, type WorkspaceForm } from './forms';
import { clearVisit, recordVisitEvent, useVisitEvents } from './visitLog';
import { findDirectoryPatient, type Patient } from '../components/PatientSelect';
import { useClinicianOffline } from '../offline/ClinicianOffline';
import { OfflineChartSummary } from '../offline/OfflineChartSummary';

// ux-allow(no-form): the only field filters the list of forms as it is typed; there is nothing to submit.

/** Mutations that are housekeeping, not something saved for this patient. */
const NOT_CLINICAL = /^\/api\/(notifications|auth|events|access-contexts?|patients\/[^/]+\/access-context|session)/;

export interface PatientWorkspaceProps {
  /** The form elements by route segment, built where the routes are declared. */
  forms: Record<string, ReactNode>;
  /** The chart home shown when no form is open. */
  home: ReactNode;
}

export function PatientWorkspace(props: PatientWorkspaceProps) {
  const { patientId } = useParams<{ patientId: string }>();
  return (
    <AccessReasonGate patientId={patientId}>
      {patientId ? <WorkspaceShell key={patientId} patientId={patientId} {...props} /> : null}
    </AccessReasonGate>
  );
}

function age(dateOfBirth: string | undefined): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  const beforeBirthday = now.getMonth() < born.getMonth()
    || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) years -= 1;
  return years >= 0 ? years : null;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

function WorkspaceShell({ patientId, forms, home }: PatientWorkspaceProps & { patientId: string }) {
  const { t } = useTranslation();
  const { form } = useParams<{ form?: string }>();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? 'Doctor';
  const rail = useMemo(() => workspaceRail(role), [role]);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [directory, setDirectory] = useState<Patient | null>(null);
  const [closing, setClosing] = useState(false);
  const returnTo = useRef(returnPathFrom(location.state, '/dashboard'));
  const events = useVisitEvents(user?.userId, patientId);
  const currentForm = form ? rail.byId.get(form) : undefined;
  const formRef = useRef<{ label: string }>({ label: t('workspace.chartHome') });
  formRef.current = { label: currentForm?.label ?? t('workspace.chartHome') };

  useEffect(() => {
    let active = true;
    getPatient(patientId).then((p) => active && setProfile(p), () => undefined);
    findDirectoryPatient(patientId).then((d) => active && setDirectory(d), () => undefined);
    return () => { active = false; };
  }, [patientId]);

  // The chart was opened: the first entry of the visit.
  useEffect(() => {
    if (events.length === 0) {
      recordVisitEvent(user?.userId, patientId, { at: Date.now(), label: t('workspace.chartOpened'), kind: 'opened' });
    }
    // Once per workspace mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every save while this patient is open lands in "This visit", attributed to
  // the form that was open when the server accepted it.
  useEffect(() => getApiClient().onMutationSucceeded(({ path }) => {
    if (NOT_CLINICAL.test(path)) return;
    recordVisitEvent(user?.userId, patientId, { at: Date.now(), label: formRef.current.label, kind: 'saved' });
  }), [patientId, user?.userId]);

  // No signal: the copy of this patient kept on the device stands in.
  const { online, roster } = useClinicianOffline();
  const kept = roster?.patients.find((p) => p.patient_id === patientId);
  const name = profile?.full_name ?? directory?.full_name ?? kept?.full_name ?? '';
  const dob = profile?.date_of_birth ?? directory?.date_of_birth ?? kept?.date_of_birth;
  const years = age(dob);
  const sex = profile?.gender ?? kept?.gender ?? undefined;
  const info = profile?.emergency_info ?? (kept ? {
    allergies: kept.allergies,
    blood_type: kept.blood_type ?? undefined,
    dnr_status: kept.dnr_status,
  } : undefined);
  const allergies = info?.allergies ?? [];
  const restricted = form ? rolesOwningRoute(role, `/${form}`).length > 0 : false;
  const known = form ? Boolean(forms[form]) && rail.byId.has(form) : true;

  const workspaceValue = useMemo(
    () => ({ patientId, patient: directory ?? (name ? { patient_id: patientId, full_name: name, date_of_birth: dob ?? '' } : null) }),
    [patientId, directory, name, dob],
  );

  return (
    <PatientWorkspaceContext.Provider value={workspaceValue}>
      <div className="flex min-h-full flex-col">
        <header
          className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-3 lg:px-6"
          aria-label={t('workspace.bannerLabel')}
        >
          <span className="mc-patient-identity flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-base font-bold text-brand-subtle-fg" aria-hidden="true">
            {initials(name)}
          </span>
          <div className="min-w-0" aria-live="polite">
            <h1 className="truncate text-lg font-bold text-content">{name || t('workspace.loadingPatient')}</h1>
            <p className="text-sm text-content-secondary">
              {[sex, years !== null ? t('workspace.years', { n: String(years) }) : null, dob ? t('workspace.born', { date: formatDateOnly(dob) }) : null]
                .filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {allergies.length > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-critical-subtle px-3 py-1 text-sm font-semibold text-critical-subtle-fg">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {allergies.map((a) => a.name).join(' · ')}
              </span>
            ) : info ? (
              <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-content-secondary">{t('workspace.noKnownAllergies')}</span>
            ) : null}
            {info?.blood_type && info.blood_type !== 'Unknown' && (
              <span className="rounded-full bg-notice-subtle px-3 py-1 text-sm font-semibold text-notice-subtle-fg">{info.blood_type}</span>
            )}
            {info?.dnr_status && (
              <span className="rounded-full bg-caution-subtle px-3 py-1 text-sm font-semibold text-caution-subtle-fg">{t('workspace.dnr')}</span>
            )}
          </div>
          <AdmissionControl patientId={patientId} canAdmit={role === 'Doctor' || role === 'Nurse'} />
          <button
            type="button"
            onClick={() => setClosing(true)}
            className="mc-press ml-auto inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border-interactive px-4 font-semibold text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            {t('workspace.closePatient')}
          </button>
        </header>

        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)_280px]">
          <ActionsRail patientId={patientId} rail={rail} current={form} />
          <section className="min-w-0" aria-label={currentForm?.label ?? t('workspace.chartHome')}>
            {!form && !online && roster && kept && <OfflineChartSummary bundle={roster} patient={kept} />}
            {!form && <div className="px-4 pt-4 lg:px-6"><AmbulanceRunStrip patientId={patientId} /></div>}
            {restricted || !known ? (
              <div role="alert" className="m-6 rounded-xl border border-border bg-surface p-6 text-content">
                {t('workspace.formUnavailable')}
              </div>
            ) : form ? forms[form] : home}
          </section>
          <VisitPanel events={events} patientName={name} />
        </div>
      </div>
      {closing && (
        <ClosePatientDialog
          patientId={patientId}
          patientName={name}
          detail={[sex, years !== null ? t('workspace.years', { n: String(years) }) : null, dob ? formatDateOnly(dob) : null].filter(Boolean).join(' · ')}
          events={events}
          onCancel={() => setClosing(false)}
          returnTo={returnTo.current}
          userId={user?.userId}
        />
      )}
    </PatientWorkspaceContext.Provider>
  );
}

function ActionsRail({ patientId, rail, current }: { patientId: string; rail: ReturnType<typeof workspaceRail>; current?: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const q = query.trim().toLowerCase();
  const matches = q
    ? rail.groups.flatMap((g) => g.forms).filter((f) => `${f.label} ${f.group}`.toLowerCase().includes(q))
    : [];
  const item = (f: WorkspaceForm) => {
    const Icon = f.icon;
    const on = f.id === current;
    return (
      <Link
        key={f.id}
        to={workspacePath(patientId, f.id)}
        aria-current={on ? 'page' : undefined}
        className={`flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
          on ? 'bg-selected font-semibold text-selected-fg' : 'text-content-secondary hover:bg-surface-sunken'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{f.label}</span>
      </Link>
    );
  };
  return (
    <nav aria-label={t('workspace.actionsLabel')} className="border-b border-border bg-surface p-2 lg:border-b-0 lg:border-r">
      <div className="relative m-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" aria-hidden="true" />
        <label htmlFor="workspace-form-search" className="sr-only">{t('workspace.searchForms')}</label>
        <input
          id="workspace-form-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('workspace.searchForms')}
          className="min-h-[40px] w-full rounded-lg border border-border-interactive bg-surface pl-9 pr-3 text-sm text-content"
        />
      </div>
      {q ? (
        <div className="mt-2 space-y-0.5">{matches.length ? matches.map(item) : <p className="px-3 py-2 text-sm text-content-muted">{t('workspace.noFormMatches')}</p>}</div>
      ) : (
        <>
          <Link
            to={workspacePath(patientId)}
            aria-current={!current ? 'page' : undefined}
            className={`mt-2 flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              !current ? 'bg-selected font-semibold text-selected-fg' : 'text-content-secondary hover:bg-surface-sunken'
            }`}
          >
            {t('workspace.chartHome')}
          </Link>
          {rail.common.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-content-muted">{t('workspace.common')}</p>
              <div className="space-y-0.5">{rail.common.map(item)}</div>
            </>
          )}
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
            className="mt-3 flex min-h-[40px] w-full items-center justify-between rounded-lg px-3 text-xs font-semibold uppercase tracking-wide text-content-muted hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t('workspace.allForms', { n: String(rail.byId.size) })}
            <ChevronDown className={`h-4 w-4 transition-transform ${showAll ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {showAll && rail.groups.map((g) => (
            <div key={g.label} className="mc-enter">
              <p className="px-3 pb-1 pt-2 text-xs text-content-muted">{g.label}</p>
              <div className="space-y-0.5">{g.forms.map(item)}</div>
            </div>
          ))}
        </>
      )}
    </nav>
  );
}

function VisitPanel({ events, patientName }: { events: ReturnType<typeof useVisitEvents>; patientName: string }) {
  const { t } = useTranslation();
  return (
    <aside aria-label={t('workspace.thisVisit')} className="hidden border-l border-border bg-surface p-4 xl:block">
      <h2 className="flex items-center gap-2 font-semibold text-content">
        <History className="h-4 w-4" aria-hidden="true" />
        {t('workspace.thisVisit')}
      </h2>
      <p className="mb-3 text-xs text-content-muted">{t('workspace.thisVisitFor', { name: patientName })}</p>
      <ol className="space-y-0" aria-live="polite">
        {events.map((e) => (
          <li key={`${e.at}-${e.label}`} className="mc-enter flex gap-3 border-t border-border py-2 first:border-t-0">
            <span className="w-12 shrink-0 text-xs tabular-nums text-content-muted">{formatTimestamp(e.at, { timeStyle: 'short' })}</span>
            <span className={`text-sm ${e.kind === 'saved' ? 'font-semibold text-content' : 'text-content-secondary'}`}>
              {e.kind === 'saved' ? t('workspace.savedEntry', { form: e.label }) : e.label}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function ClosePatientDialog(props: {
  patientId: string;
  patientName: string;
  detail: string;
  events: ReturnType<typeof useVisitEvents>;
  returnTo: string;
  userId?: string;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useMotionNavigate();
  const saved = props.events.filter((e) => e.kind === 'saved');
  const drafts = draftsForPatient(props.patientId);
  const unsaved = unsavedForms();
  const pending = [...new Set([...unsaved, ...drafts])];

  const close = () => {
    drafts.forEach((formId) => clearDraft(formId, props.patientId));
    clearUnsavedForms();
    clearVisit(props.userId, props.patientId);
    getApiClient().setPatientAccessContext(undefined);
    navigate(props.returnTo);
  };

  return (
    <ModalPanel
      labelledBy="close-patient-title"
      onClose={props.onCancel}
      className="mc-rise w-full max-w-lg rounded-2xl bg-surface-raised p-6 text-content shadow-xl"
    >
      <h2 id="close-patient-title" className="text-xl font-bold">{t('workspace.closeTitle', { name: props.patientName })}</h2>
      <p className="mt-1 text-sm text-content-muted">{props.detail}</p>
      <h3 className="mt-5 text-sm font-semibold">{t('workspace.savedThisVisit')}</h3>
      {saved.length ? (
        <ul className="mt-2 divide-y divide-border">
          {saved.map((e) => (
            <li key={`${e.at}-${e.label}`} className="flex gap-3 py-2 text-sm">
              <span className="w-12 shrink-0 tabular-nums text-content-muted">{formatTimestamp(e.at, { timeStyle: 'short' })}</span>
              <span className="font-medium">{e.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-content-muted">{t('workspace.nothingSaved')}</p>
      )}
      {pending.length > 0 && (
        <div role="alert" className="mt-4 rounded-lg border border-caution bg-caution-subtle p-3 text-sm text-caution-subtle-fg">
          <p className="font-semibold">{t('workspace.unsavedWarning')}</p>
          <p>{pending.join(', ')}</p>
        </div>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={props.onCancel} className="min-h-[44px] rounded-lg border border-border-interactive px-4 font-semibold hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {t('workspace.backToPatient')}
        </button>
        <button type="button" onClick={close} className="min-h-[44px] rounded-lg bg-brand px-4 font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {pending.length ? t('workspace.closeDiscarding') : t('workspace.closePatient')}
        </button>
      </div>
    </ModalPanel>
  );
}
