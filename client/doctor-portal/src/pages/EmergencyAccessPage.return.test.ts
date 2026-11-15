import { describe, expect, it } from 'vitest';
import { runReturnPath } from './EmergencyAccessPage';

describe('back to the ambulance run after a card read (c6)', () => {
  it('accepts only an ambulance run of this app', () => {
    expect(runReturnPath({ returnTo: '/ems-run' })).toBe('/ems-run');
    expect(runReturnPath({ returnTo: '/ems-run/RUN-1a2b' })).toBe('/ems-run/RUN-1a2b');
  });

  it('ignores anything else, so navigation state cannot send someone elsewhere', () => {
    for (const to of ['https://evil.example', '//evil.example', '/patients/PAT-1', '/ems-run/../admin', '/ems-run/a/b', '/ems-run/..', '/ems-run/.', 42]) {
      expect(runReturnPath({ returnTo: to })).toBeNull();
    }
    expect(runReturnPath(null)).toBeNull();
  });
});
