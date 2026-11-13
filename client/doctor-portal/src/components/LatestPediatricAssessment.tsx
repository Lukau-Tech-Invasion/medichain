import { useEffect, useState } from 'react';
import { ApiClientError, formatTimestamp, listPedsForPatient } from '@medichain/shared';

/** Display only recorded numeric observations, preserving zero and unknown values. */
function observation(value: unknown, unit = ''): string {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return 'Not recorded';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric}${unit}` : 'Not recorded';
}

/** Read the most recent pediatric encounter without combining it with a different visit's vital signs. */
export function LatestPediatricAssessment({ patientId }: { patientId: string }) {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [resultPatientId, setResultPatientId] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setRecord(null); setError(null);
    listPedsForPatient(patientId).then(rows => {
      if (!active) return;
      const latest = rows[0];
      if (latest !== undefined && (!latest || typeof latest !== 'object' || Array.isArray(latest))) throw new Error('Invalid assessment');
      setRecord(latest as Record<string, unknown> | undefined ?? null);
    }).catch(reason => {
      if (!active) return;
      const denied = reason instanceof ApiClientError && reason.status === 403;
      setError({ message: denied ? 'Pediatric assessment access was refused.' : 'Pediatric assessment could not be loaded.', retryable: !denied });
    }).finally(() => { if (active) { setResultPatientId(patientId); setLoading(false); } });
    return () => { active = false; };
  }, [patientId, attempt]);
  const data = record?.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record;
  const triangle = data?.pediatric_triangle && typeof data.pediatric_triangle === 'object'
    ? data.pediatric_triangle as Record<string, unknown> : null;
  const rawDate = record?.assessment_datetime;
  const recordedAt = typeof rawDate === 'string' && Number.isFinite(Date.parse(rawDate)) ? formatTimestamp(rawDate) : 'Not recorded';
  return <section aria-label="Latest pediatric assessment" className="bg-surface rounded-xl shadow p-6">
    <h3 className="font-semibold text-content mb-4">Latest pediatric assessment</h3>
    {loading || resultPatientId !== patientId ? <p role="status">Loading pediatric assessment…</p> : error ? <div role="alert">
      <p>{error.message}</p>
      {error.retryable && <button type="button" className="underline mt-2" onClick={() => setAttempt(value => value + 1)}>Retry pediatric assessment</button>}
    </div> : !record ? <p>No pediatric assessments recorded.</p> : <>
      <p className="text-sm text-content-muted mb-3">Recorded {recordedAt}. Observations below belong to this assessment.</p>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {Object.entries({ 'Age at assessment': observation(record.age_months, ' months'),
          Weight: observation(data?.weight_kg ?? record.weight_kg, ' kg'),
          Height: observation(data?.length_cm ?? record.length_cm, ' cm'),
          'Heart rate': observation(triangle?.heart_rate, ' bpm'),
          'Respiratory rate': observation(triangle?.respiratory_rate, ' breaths/min'),
          Temperature: observation(triangle?.temperature_celsius, ' °C'),
        }).map(([label, value]) => <div key={label}><dt className="text-xs text-content-muted">{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </>}
  </section>;
}
