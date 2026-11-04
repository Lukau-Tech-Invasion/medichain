/**
 * What the device holds about one patient, shown on the chart home when there
 * is no signal. Says plainly that it is the downloaded copy and when it was
 * taken, so nobody mistakes it for the live chart.
 */
import { formatTimestamp, useTranslation } from '@medichain/shared';
import type { OfflineBundle, OfflinePatient } from '@medichain/shared';

function allergyText(a: OfflinePatient['allergies'][number]): string {
  const detail = [a.severity, a.reaction].filter(Boolean).join(', ');
  return detail ? `${a.name} (${detail})` : a.name;
}

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-content">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-sm text-content-secondary">
          {items.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-content-muted">{empty}</p>
      )}
    </div>
  );
}

export function OfflineChartSummary({ bundle, patient }: { bundle: OfflineBundle; patient: OfflinePatient }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="offline-summary-title" className="m-4 rounded-xl border border-caution bg-surface p-4 lg:mx-6">
      <h2 id="offline-summary-title" className="text-lg font-semibold text-content">{t('clinicianOffline.summaryTitle')}</h2>
      <p className="text-xs text-content-muted">
        {t('clinicianOffline.dayListFrom', { time: formatTimestamp(bundle.generated_at), until: formatTimestamp(bundle.expires_at) })}
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <List title={t('clinicianOffline.allergies')} items={patient.allergies.map(allergyText).filter(Boolean)} empty={t('clinicianOffline.noAllergies')} />
        <List title={t('clinicianOffline.medications')} items={patient.current_medications} empty={t('clinicianOffline.none')} />
        <List title={t('clinicianOffline.conditions')} items={patient.chronic_conditions} empty={t('clinicianOffline.none')} />
        <List
          title={t('clinicianOffline.contacts')}
          items={patient.emergency_contacts.map((c) => [c.name, c.relationship, c.phone].filter(Boolean).join(' · '))}
          empty={t('clinicianOffline.none')}
        />
      </div>
    </section>
  );
}
