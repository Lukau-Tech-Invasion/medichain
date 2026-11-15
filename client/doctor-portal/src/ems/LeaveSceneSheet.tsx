/**
 * "Leaving scene — where to?" Choosing the hospital is the pre-alert: the run
 * appears on that hospital's incoming board with the timeline so far.
 */
import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { ChoiceChips, Sheet, getApiErrorMessage, listEmsDestinations, useTranslation } from '@medichain/shared';
import type { AddEmsRunEventBody } from '@medichain/shared';

const ETAS = ['5', '10', '15', '20', '30', '45'] as const;
const DESTINATIONS_CACHE = 'medichain.emsDestinations';

export function LeaveSceneSheet({ onClose, onLeave }: {
  onClose: () => void;
  onLeave: (body: AddEmsRunEventBody, destinationName?: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [facilities, setFacilities] = useState<Array<{ id: string; name: string }> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [chosen, setChosen] = useState<string | undefined>();
  const [eta, setEta] = useState<(typeof ETAS)[number] | undefined>();
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  // The hospital list holds no patient data, so the last good copy is kept on
  // the device: a crew with no signal can still choose where they are going.
  useEffect(() => {
    listEmsDestinations().then(
      (r) => {
        setFacilities(r.facilities);
        try { localStorage.setItem(DESTINATIONS_CACHE, JSON.stringify(r.facilities)); } catch { /* storage unavailable */ }
      },
      (e) => {
        let cached: Array<{ id: string; name: string }> | null = null;
        try { cached = JSON.parse(localStorage.getItem(DESTINATIONS_CACHE) ?? 'null'); } catch { cached = null; }
        if (Array.isArray(cached) && cached.length) setFacilities(cached);
        else setLoadError(getApiErrorMessage(e, t('ems.destinationsFailed')));
      },
    );
  }, [t]);

  const leave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen) {
      setProblem(t('ems.chooseDestination'));
      return;
    }
    setSaving(true);
    const ok = await onLeave({ kind: 'left_scene', destination_facility_id: chosen, ...(eta ? { eta_minutes: Number(eta) } : {}) }, facilities?.find((f) => f.id === chosen)?.name);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      title={t('ems.leaveTitle')}
      description={t('ems.leaveDescription')}
      onClose={onClose}
      actions={
        <button type="submit" form="ems-leave" aria-disabled={saving || undefined}
          className="mc-press min-h-[52px] w-full rounded-xl bg-brand px-4 text-lg font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {saving ? t('common.saving') : t('ems.leaveAndAlert')}
        </button>
      }
    >
      <form id="ems-leave" onSubmit={leave} className="space-y-4" noValidate>
        {problem && <p role="alert" className="rounded-lg bg-caution-subtle p-3 text-sm text-caution-subtle-fg">{problem}</p>}
        {loadError && <p role="alert" className="rounded-lg bg-critical-subtle p-3 text-sm text-critical-subtle-fg">{loadError}</p>}
        {facilities === null && !loadError && <p role="status" className="text-content-muted">{t('ems.loading')}</p>}
        {facilities?.length === 0 && <p className="text-content-muted">{t('ems.noDestinations')}</p>}
        {facilities && facilities.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-content-secondary">{t('ems.destination')}</legend>
            <div className="space-y-2">
              {facilities.map((f) => (
                <label key={f.id} className="mc-press flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border border-border px-4 hover:bg-surface-sunken has-[:checked]:border-brand has-[:checked]:bg-selected has-[:checked]:text-selected-fg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus">
                  <input type="radio" name="destination" value={f.id} checked={chosen === f.id}
                    onChange={() => { setProblem(''); setChosen(f.id); }} className="sr-only" />
                  <MapPin className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="font-semibold">{f.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <ChoiceChips label={t('ems.etaMinutes')} value={eta} options={ETAS.map((m) => ({ value: m, label: t('ems.minutes', { n: m }) }))} onChange={setEta} />
      </form>
    </Sheet>
  );
}
