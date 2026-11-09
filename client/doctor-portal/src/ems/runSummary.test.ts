import { describe, expect, it } from 'vitest';
import type { EmsRun, EmsRunEvent } from '@medichain/shared';
import { latestVitals, medicineText, summariseRun } from './runSummary';
import { activeAlerts, eventLabel } from './runSummary';

const run: EmsRun = {
  id: 'RUN-1', status: 'en_route', created_by: 'medic', crew: [], chief_complaint: 'Car crash, driver, airbag deployed',
  created_at: '2026-10-30T14:02:00Z', updated_at: '2026-10-30T14:24:00Z',
};

const ev = (kind: EmsRunEvent['kind'], at: string, payload: Record<string, unknown> | null = null): EmsRunEvent => ({
  id: `${kind}-${at}`, run_id: 'RUN-1', kind, occurred_at: `2026-10-30T${at}:00Z`, recorded_by: 'medic', payload,
});

describe('summariseRun', () => {
  const events = [
    ev('vitals', '14:24', { systolic_bp: 104, diastolic_bp: 66, heart_rate: 106, spo2: 96 }),
    ev('dispatched', '14:02'),
    ev('on_scene', '14:09', { text: 'Driver, conscious, left forearm deformity' }),
    ev('vitals', '14:12', { systolic_bp: 92, diastolic_bp: 58, heart_rate: 118, spo2: 91, gcs: 14 }),
    ev('treatment', '14:14', { name: 'Oxygen 15 L/min non-rebreather' }),
    ev('medication', '14:16', { name: 'Sodium chloride 0.9%', dose: '500 mL', route: 'IV' }),
    ev('left_scene', '14:18'),
    ev('note', '14:20', { text: 'Pain 6/10' }),
  ];

  it('orders the timeline and keeps the time of every reading and every treatment', () => {
    const s = summariseRun(run, events);
    expect(s.times).toEqual({
      dispatched: '2026-10-30T14:02:00Z', onScene: '2026-10-30T14:09:00Z', leftScene: '2026-10-30T14:18:00Z', handedOver: undefined,
    });
    expect(s.vitals.map((v) => [v.at.slice(11, 16), v.systolic_bp])).toEqual([['14:12', 92], ['14:24', 104]]);
    expect(s.treatments.map((t) => t.text)).toEqual(['Oxygen 15 L/min non-rebreather', 'Sodium chloride 0.9% 500 mL IV']);
    expect(s.findings.map((f) => f.text)).toEqual(['Driver, conscious, left forearm deformity']);
    expect(s.notes.map((n) => n.text)).toEqual(['Pain 6/10']);
    expect(s.mechanism).toBe('Car crash, driver, airbag deployed');
  });

  it('gives the latest vitals with their time, and only the readings that were taken', () => {
    const latest = latestVitals(summariseRun(run, events));
    expect(latest).toEqual({ at: '2026-10-30T14:24:00Z', systolic_bp: 104, diastolic_bp: 66, heart_rate: 106, spo2: 96 });
    expect(latest).not.toHaveProperty('gcs');
  });

  it('says nothing was measured rather than inventing a reading', () => {
    expect(latestVitals(summariseRun(run, [ev('vitals', '14:12', { heart_rate: 'fast' })]))).toBeNull();
  });

  it('writes a medicine as name, dose and route', () => {
    expect(medicineText({ name: 'Adrenaline', dose: '0.5 mg', route: 'IM' })).toBe('Adrenaline 0.5 mg IM');
    expect(medicineText({ name: 'Aspirin' })).toBe('Aspirin');
  });
});

describe('pre-alerts', () => {
  const base: EmsRun = { id: 'R', status: 'en_route', created_by: 'm', crew: [], created_at: '', updated_at: '' };
  const alert = (alert: string, raised: boolean, pending: boolean) => ({
    id: `${alert}-${raised}`, run_id: 'R', kind: 'alert' as const, occurred_at: '', recorded_by: 'm', payload: { alert, raised }, pending,
  });

  it("applies alerts still queued on the device to the server's set", () => {
    const run = { ...base, alerts: ['trauma' as const] };
    expect(activeAlerts(run, [alert('stemi', true, true), alert('trauma', false, true)])).toEqual(['stemi']);
  });

  it('does not apply an entry the server already counted twice', () => {
    const run = { ...base, alerts: ['stemi' as const] };
    expect(activeAlerts(run, [alert('stemi', true, false)])).toEqual(['stemi']);
  });

  it('names which alert was raised or withdrawn', () => {
    const t = (k: string, v?: Record<string, string>) => (v ? `${k}(${v.alert})` : k);
    expect(eventLabel(alert('stemi', true, false), t)).toBe('ems.alertRaised(ems.alerts.stemi)');
    expect(eventLabel(alert('stemi', false, false), t)).toBe('ems.alertWithdrawn(ems.alerts.stemi)');
  });
});
