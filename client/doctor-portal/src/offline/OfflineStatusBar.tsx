/**
 * One bar that says whether the clinician is online and what has not reached
 * the server. It replaces a banner that said "changes are saved locally" while
 * no change was: the queue it counted had no writer, so it always read 0.
 */
import { useState } from 'react';
import { CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { formatTimestamp, useTranslation } from '@medichain/shared';
import type { SyncQueueItem } from '@medichain/shared';
import { useClinicianOffline } from './ClinicianOffline';

function patientName(item: SyncQueueItem, names: Map<string, string>): string {
  return (item.patientId && names.get(item.patientId)) || item.patientId || '';
}

export function OfflineStatusBar() {
  const { t } = useTranslation();
  const { online, roster, waiting, refused, syncing, syncNow, dismiss } = useClinicianOffline();
  const [open, setOpen] = useState(false);
  const names = new Map((roster?.patients ?? []).map((p) => [p.patient_id, p.full_name]));

  if (online && waiting.length === 0 && refused.length === 0) return null;

  return (
    <section aria-label={t('clinicianOffline.label')} className="border-b border-caution bg-caution-subtle text-caution-subtle-fg text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        {!online && <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <p className="min-w-0 flex-1" role="status">
          {online
            ? t('clinicianOffline.onlineWaiting', { n: waiting.length })
            : roster
              ? t('clinicianOffline.offline', { n: roster.patients.length })
              : t('clinicianOffline.offlineNoDay')}
          {!online && <span className="block text-xs">{t('clinicianOffline.notOffline')}</span>}
        </p>
        {waiting.length > 0 && !online && (
          <span className="rounded-full bg-caution px-2 py-0.5 text-xs font-medium text-caution-fg">
            {t('clinicianOffline.waiting', { n: waiting.length })}
          </span>
        )}
        {(waiting.length > 0 || refused.length > 0) && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="min-h-[44px] underline hover:no-underline">
            {open ? t('clinicianOffline.hideList') : t('clinicianOffline.showList')}
          </button>
        )}
        <button type="button" onClick={() => void syncNow()} disabled={syncing}
          className="inline-flex min-h-[44px] items-center gap-1.5 underline hover:no-underline disabled:no-underline disabled:opacity-70">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {syncing ? t('clinicianOffline.sending') : online ? t('clinicianOffline.sendNow') : t('clinicianOffline.retry')}
        </button>
      </div>

      {refused.length > 0 && (
        <div role="alert" className="flex items-start gap-2 border-t border-caution bg-critical-subtle px-4 py-2 text-critical-subtle-fg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{t('clinicianOffline.refused', { n: refused.length })}</p>
        </div>
      )}

      {open && (
        <ul className="divide-y divide-border border-t border-caution bg-surface text-content">
          {[...refused, ...waiting].map((item) => (
            <li key={item.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {item.description}
                  {patientName(item, names) && <span className="font-normal text-content-secondary"> · {patientName(item, names)}</span>}
                </p>
                <p className="text-xs text-content-muted">
                  {t('clinicianOffline.writtenAt', { time: formatTimestamp(new Date(item.timestamp).toISOString()) })}
                </p>
                {item.status === 'failed' && (
                  <p className="text-xs text-critical-subtle-fg">
                    {t('clinicianOffline.refusedReason', { reason: item.error ?? t('clinicianOffline.noReason') })}
                  </p>
                )}
              </div>
              {item.status === 'failed' ? (
                <button type="button" onClick={() => void dismiss(item.id)}
                  className="min-h-[44px] text-sm underline hover:no-underline">
                  {t('clinicianOffline.dismiss')}
                </button>
              ) : (
                <span className="text-xs text-content-muted">{t('clinicianOffline.notSentYet')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
