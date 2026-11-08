/**
 * "Close patient" (mockup c5): what was saved this visit, each piece of work
 * not yet saved with its own Save and Discard, and -- when the day's booking
 * says who is next -- a way straight on to them.
 *
 * "Save" opens the form holding the draft rather than submitting it from here:
 * a half-written form has its own checks, and a submit from outside it would
 * send whatever happens to be filled in (rule 9).
 */
import { useEffect, useState } from 'react';
import {
  ModalPanel,
  clearDraft,
  clearUnsavedForms,
  draftsForPatient,
  formatTimestamp,
  getApiClient,
  getDoctorToday,
  unsavedForms,
  useMotionNavigate,
  useTranslation,
} from '@medichain/shared';
import { clearVisit, type VisitEvent } from './visitLog';
import { workspacePath } from './forms';
import { nextPatient, type NextPatient } from './nextPatient';

export interface ClosePatientDialogProps {
  patientId: string;
  patientName: string;
  detail: string;
  events: VisitEvent[];
  returnTo: string;
  userId?: string;
  /** The form on screen: its own unsaved-changes registration names it. */
  currentForm?: string;
  labelOf: (formId: string) => string;
  onCancel: () => void;
  /** Show the form holding a draft, so it can be saved there. */
  onOpenForm: (formId: string) => void;
  /** Throw away what is typed into the form on screen (it is remounted empty). */
  onDiscardOnScreen: () => void;
}

interface PendingWork {
  key: string;
  label: string;
  formId?: string;
  onScreen: boolean;
}

function pendingWork(props: ClosePatientDialogProps, onScreenDiscarded: boolean): PendingWork[] {
  const drafts = draftsForPatient(props.patientId);
  const elsewhere = drafts
    .filter((d) => d !== props.currentForm)
    .map((d) => ({ key: d, label: props.labelOf(d), formId: d, onScreen: false }));
  const unsaved = unsavedForms();
  const draftOnScreen = props.currentForm !== undefined && drafts.includes(props.currentForm);
  if (onScreenDiscarded || (unsaved.length === 0 && !draftOnScreen)) return elsewhere;
  const label = unsaved.length ? [...new Set(unsaved)].join(', ') : props.labelOf(props.currentForm ?? '');
  return [{ key: `on-screen-${props.currentForm ?? ''}`, label, formId: props.currentForm, onScreen: true }, ...elsewhere];
}

function useNextPatient(patientId: string): NextPatient | null {
  const [next, setNext] = useState<NextPatient | null>(null);
  useEffect(() => {
    let active = true;
    // Not every role has a booked day; no answer simply means no button.
    getDoctorToday().then(
      (r) => {
        if (active && r?.today?.appointments) setNext(nextPatient(r.today, r.names ?? [], patientId));
      },
      () => undefined,
    );
    return () => { active = false; };
  }, [patientId]);
  return next;
}

export function ClosePatientDialog(props: ClosePatientDialogProps) {
  const { t } = useTranslation();
  const navigate = useMotionNavigate();
  const [onScreenDiscarded, setOnScreenDiscarded] = useState(false);
  // Discarding a draft elsewhere changes nothing React can see; re-read.
  const [, reread] = useState(0);
  const next = useNextPatient(props.patientId);
  const saved = props.events.filter((e) => e.kind === 'saved');
  const opened = props.events.find((e) => e.kind === 'opened');
  const pending = pendingWork(props, onScreenDiscarded);

  const discard = (item: PendingWork) => {
    if (item.formId) clearDraft(item.formId, props.patientId);
    if (item.onScreen) {
      props.onDiscardOnScreen();
      setOnScreenDiscarded(true);
    }
    reread((n) => n + 1);
  };

  const save = (item: PendingWork) => {
    if (item.onScreen || !item.formId) props.onCancel();
    else props.onOpenForm(item.formId);
  };

  const finish = (to: string) => {
    draftsForPatient(props.patientId).forEach((formId) => clearDraft(formId, props.patientId));
    clearUnsavedForms();
    clearVisit(props.userId, props.patientId);
    getApiClient().setPatientAccessContext(undefined);
    navigate(to);
  };

  const minutes = opened ? Math.max(0, Math.round((Date.now() - opened.at) / 60000)) : null;
  const detail = [
    props.detail,
    opened ? t(minutes ? 'workspace.openedFor' : 'workspace.openedAt', { time: formatTimestamp(opened.at, { timeStyle: 'short' }), minutes: String(minutes) }) : null,
  ].filter(Boolean).join(' · ');
  const nextLabel = next
    ? t(pending.length ? 'workspace.closeNextDiscarding' : 'workspace.closeNext', {
      name: next.name, time: formatTimestamp(next.at, { timeStyle: 'short' }),
    })
    : '';
  const quiet = 'min-h-[44px] rounded-lg border border-border-interactive px-4 font-semibold hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  const primary = 'min-h-[44px] rounded-lg bg-brand px-4 font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

  return (
    <ModalPanel
      labelledBy="close-patient-title"
      onClose={props.onCancel}
      className="mc-rise w-full max-w-lg rounded-2xl bg-surface-raised p-6 text-content shadow-xl"
    >
      <h2 id="close-patient-title" className="text-xl font-bold">{t('workspace.closeTitle', { name: props.patientName })}</h2>
      <p className="mt-1 text-sm text-content-muted">{detail}</p>

      <h3 className="mt-5 text-sm font-semibold">{t('workspace.savedThisVisit')}</h3>
      {saved.length ? (
        <ul className="mt-2 divide-y divide-border">
          {saved.map((e, i) => (
            <li key={`${e.at}-${e.label}-${i}`} className="flex gap-3 py-2 text-sm">
              <span className="w-12 shrink-0 tabular-nums text-content-muted">{formatTimestamp(e.at, { timeStyle: 'short' })}</span>
              <span className="font-medium">{e.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-content-muted">{t('workspace.nothingSaved')}</p>
      )}

      {pending.length > 0 && (
        <div role="alert" aria-label={t('workspace.unsavedWarning')} className="mt-4">
        <ul className="space-y-2">
          {pending.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-caution bg-caution-subtle p-3 text-sm text-caution-subtle-fg">
              <span className="min-w-0 flex-1 font-semibold">{t('workspace.notSaved', { form: item.label })}</span>
              <button type="button" onClick={() => save(item)} aria-label={t('workspace.openToSaveForm', { form: item.label })}
                className="min-h-[40px] rounded-lg bg-brand px-3 font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {t('workspace.openToSave')}
              </button>
              <button type="button" onClick={() => discard(item)} aria-label={t('workspace.discardForm', { form: item.label })}
                className="min-h-[40px] rounded-lg border border-border-interactive bg-surface px-3 font-semibold text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {t('workspace.discard')}
              </button>
            </li>
          ))}
        </ul>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={props.onCancel} className={`${quiet} mr-auto`}>
          {t('workspace.backToPatient')}
        </button>
        <button type="button" onClick={() => finish(props.returnTo)} className={next ? quiet : primary}>
          {pending.length ? t('workspace.closeDiscarding') : t('workspace.closePatient')}
        </button>
        {next && (
          <button type="button" onClick={() => finish(workspacePath(next.patientId))} className={primary}>
            {nextLabel}
          </button>
        )}
      </div>
    </ModalPanel>
  );
}
