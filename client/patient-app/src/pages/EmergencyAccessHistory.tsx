import { useEffect, useState } from 'react';
import { formatTimestamp, getEmergencyCapsuleAccessLog } from '@medichain/shared';
import type { AccessLogEntry, EmergencyCapsuleAccess } from '@medichain/shared';

/** Show durable emergency disclosures alongside the ordinary chart-access history. */
export function EmergencyAccessHistory({ patientId, entries }: { patientId: string; entries: AccessLogEntry[] }) {
  const [rows, setRows] = useState<EmergencyCapsuleAccess[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus('loading');
    getEmergencyCapsuleAccessLog(patientId).then(body => {
      if (active) { setRows(body.accesses); setStatus('ready'); }
    }).catch(() => { if (active) setStatus('failed'); });
    return () => { active = false; };
  }, [patientId, retry]);
  // Opened from Me's "Emergency access history" row: bring this list into view.
  useEffect(() => {
    if (status === 'ready' && window.location.hash === '#emergency-access') {
      document.getElementById('emergency-access')?.scrollIntoView({ block: 'start' });
    }
  }, [status]);
  return <section id="emergency-access" aria-label="Emergency summary access" className="my-4 scroll-mt-20">
    <h2 className="text-lg font-semibold">Emergency summary access</h2>
    {status === 'loading' && <p role="status">Loading emergency access history...</p>}
    {status === 'failed' && <div role="alert">Emergency access history could not be loaded.
      <button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 underline">Retry</button>
    </div>}
    {status === 'ready' && rows.length === 0 && <p>No emergency summary accesses recorded.</p>}
    {status === 'ready' && <ul className="space-y-3 mt-2">{rows.map(row => {
      const actor = entries.find(entry => entry.accessor_id === row.accessed_by);
      return <li key={row.id} className="bg-surface border border-border rounded-xl p-4">
        <p className="font-semibold">{actor?.accessor_name || row.accessed_by}</p>
        <p className="text-sm">{formatTimestamp(row.accessed_at)}</p>
        <p className="text-sm">Reason: {row.reason_text || row.reason_code}</p>
        <p className="text-sm">Viewed: {row.fields_revealed.map(field => field.replace(/_/g, ' ')).join(', ') || 'No fields disclosed'}</p>
      </li>;
    })}</ul>}
  </section>;
}
