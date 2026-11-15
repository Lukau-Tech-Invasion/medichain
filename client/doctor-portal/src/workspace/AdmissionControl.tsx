/**
 * Where the open patient is admitted, and the one tap to admit or discharge
 * them (UX plan WP 5.2). Admission is what puts a patient on a ward's list and
 * lets the nurses rostered there open the chart; discharge ends that at once.
 */
import { useCallback, useEffect, useState } from 'react';
import { BedDouble } from 'lucide-react';
import {
  ChoiceChips,
  Sheet,
  admitPatient,
  confirmDialog,
  dischargeAdmission,
  getApiErrorMessage,
  getPatientAdmissions,
  listWards,
  notifySuccess,
  useTranslation,
} from '@medichain/shared';
import type { Admission, Ward } from '@medichain/shared';

export function AdmissionControl({ patientId, canAdmit }: { patientId: string; canAdmit: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ admission: Admission; ward_name: string | null } | null | undefined>(undefined);
  const [admitting, setAdmitting] = useState(false);
  const [failure, setFailure] = useState('');

  const load = useCallback(() => {
    getPatientAdmissions(patientId).then(
      // A malformed reply is "unknown", like a failed one -- not "not admitted".
      (r) => setOpen(Array.isArray(r?.admissions)
        ? r.admissions.find((a) => !a.admission.discharged_at) ?? null
        : undefined),
      () => setOpen(undefined),
    );
  }, [patientId]);
  useEffect(load, [load]);

  const discharge = async () => {
    if (!open) return;
    const ok = await confirmDialog({ title: t('admission.dischargeTitle'), message: t('admission.dischargeMessage', { ward: open.ward_name ?? '' }), confirmLabel: t('admission.discharge') });
    if (!ok) return;
    setFailure('');
    try {
      await dischargeAdmission(open.admission.id);
      notifySuccess(t('admission.discharged'));
      load();
    } catch (e) {
      setFailure(getApiErrorMessage(e, t('admission.dischargeFailed')));
    }
  };

  // Unknown (still loading, or the read failed): show nothing rather than guess.
  if (open === undefined) return null;
  return (
    <>
      {open ? (
        <span className="inline-flex items-center gap-2 rounded-full bg-surface-sunken px-3 py-1 text-sm text-content">
          <BedDouble className="h-4 w-4" aria-hidden="true" />
          {[open.ward_name, open.admission.bed_label ? t('myWard.bed', { bed: open.admission.bed_label }) : null].filter(Boolean).join(' · ')}
          {canAdmit && (
            <button type="button" onClick={() => void discharge()} className="ml-1 min-h-[32px] rounded px-2 font-semibold underline">
              {t('admission.discharge')}
            </button>
          )}
        </span>
      ) : canAdmit ? (
        <button type="button" onClick={() => setAdmitting(true)}
          className="mc-press inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border-interactive px-3 text-sm font-semibold text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <BedDouble className="h-4 w-4" aria-hidden="true" />
          {t('admission.admit')}
        </button>
      ) : null}
      {failure && <span role="alert" className="rounded-lg bg-critical-subtle px-3 py-1 text-sm text-critical-subtle-fg">{failure}</span>}
      {admitting && <AdmitSheet patientId={patientId} onClose={() => setAdmitting(false)} onAdmitted={() => { setAdmitting(false); load(); }} />}
    </>
  );
}

function AdmitSheet({ patientId, onClose, onAdmitted }: { patientId: string; onClose: () => void; onAdmitted: () => void }) {
  const { t } = useTranslation();
  const [wards, setWards] = useState<Ward[] | null>(null);
  const [ward, setWard] = useState<string | undefined>();
  const [bed, setBed] = useState('');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listWards().then((r) => setWards(r.wards), (e) => setProblem(getApiErrorMessage(e, t('admission.wardsFailed'))));
  }, [t]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ward) {
      setProblem(t('admission.chooseWard'));
      return;
    }
    setSaving(true);
    try {
      await admitPatient({ patient_id: patientId, ward_id: ward, ...(bed.trim() ? { bed_label: bed.trim() } : {}) });
      notifySuccess(t('admission.admitted'));
      onAdmitted();
    } catch (e) {
      setProblem(getApiErrorMessage(e, t('admission.admitFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={t('admission.admitTitle')} onClose={onClose}
      actions={
        <button type="submit" form="admit-form" aria-disabled={saving || undefined}
          className="mc-press min-h-[48px] w-full rounded-xl bg-brand px-4 font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {saving ? t('common.saving') : t('admission.admit')}
        </button>
      }>
      <form id="admit-form" onSubmit={submit} noValidate className="space-y-4">
        {problem && <p role="alert" className="rounded-lg bg-caution-subtle p-3 text-caution-subtle-fg">{problem}</p>}
        {wards && wards.length === 0 && <p className="text-content-muted">{t('admission.noWards')}</p>}
        {wards && wards.length > 0 && (
          <ChoiceChips label={t('wardRoster.ward')} value={ward} onChange={(v) => { setProblem(''); setWard(v); }}
            options={wards.map((w) => ({ value: w.id, label: w.name }))} />
        )}
        <label className="block text-sm font-medium text-content-secondary">
          {t('admission.bed')}
          <input value={bed} onChange={(e) => setBed(e.target.value)} maxLength={40}
            className="mt-1 w-full rounded-lg border border-border-interactive bg-surface px-3 py-2 text-content" />
        </label>
      </form>
    </Sheet>
  );
}
