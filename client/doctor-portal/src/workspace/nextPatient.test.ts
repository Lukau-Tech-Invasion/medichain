import { describe, expect, it } from 'vitest';
import type { TodayItem, TodayPatient } from '@medichain/shared';
import { nextPatient } from './nextPatient';

const NOW = Date.parse('2026-11-07T09:20:00Z');

function appt(patient_id: string, at: string): TodayItem {
  return { id: `A-${patient_id}`, patient_id, title: 'Appointment', detail: null, at, urgency: 'routine' as TodayItem['urgency'] };
}

function person(patient_id: string, full_name: string, content_available = true): TodayPatient {
  return { patient_id, full_name, date_of_birth: '1990-01-01', content_available };
}

describe('nextPatient', () => {
  const names = [person('P1', 'Thandiwe Ndlovu'), person('P2', 'Sipho Mabaso'), person('P3', 'Amina Yusuf')];

  it('is the earliest booked patient still waiting, not the one open', () => {
    const today = { appointments: [appt('P3', '2026-11-07T10:00:00Z'), appt('P1', '2026-11-07T09:00:00Z'), appt('P2', '2026-11-07T09:30:00Z')] };
    expect(nextPatient(today, names, 'P1', NOW)).toEqual({ patientId: 'P2', name: 'Sipho Mabaso', at: '2026-11-07T09:30:00Z' });
  });

  it('counts a clinic running up to half an hour late, and no further', () => {
    expect(nextPatient({ appointments: [appt('P2', '2026-11-07T09:00:00Z')] }, names, 'P1', NOW)?.patientId).toBe('P2');
    expect(nextPatient({ appointments: [appt('P2', '2026-11-07T08:40:00Z')] }, names, 'P1', NOW)).toBeNull();
  });

  it('offers nobody when the next patient cannot be named, rather than skipping them', () => {
    const today = { appointments: [appt('P2', '2026-11-07T09:30:00Z'), appt('P3', '2026-11-07T10:00:00Z')] };
    expect(nextPatient(today, [person('P2', '', false), person('P3', 'Amina Yusuf')], 'P1', NOW)).toBeNull();
  });

  it('is nobody on an empty day', () => {
    expect(nextPatient({ appointments: [] }, names, 'P1', NOW)).toBeNull();
  });
});
