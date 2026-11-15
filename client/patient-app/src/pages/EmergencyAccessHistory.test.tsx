import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getEmergencyCapsuleAccessLog } from '@medichain/shared';
import { EmergencyAccessHistory } from './EmergencyAccessHistory';

vi.mock('@medichain/shared', () => ({
  getEmergencyCapsuleAccessLog: vi.fn(),
  formatTimestamp: (value: string) => value,
}));

describe('Emergency access history', () => {
  it('shows the actual reason and disclosed fields', async () => {
    vi.mocked(getEmergencyCapsuleAccessLog).mockResolvedValue({
      success: true, patient_id: 'PAT-DEMO', count: 1,
      accesses: [{ id: 'access-1', patient_id: 'PAT-DEMO', accessed_by: 'responder',
        capsule_version: null, grant_id: 'grant-1', reason_code: 'emergency',
        reason_text: 'Unconscious patient assessment', fields_revealed: ['blood_type'],
        commitment_verified: false, accessed_at: '2026-09-27T10:00:00Z' }],
    });
    render(<EmergencyAccessHistory patientId="PAT-DEMO" entries={[]} />);
    expect(await screen.findByText('Reason: Unconscious patient assessment')).toBeInTheDocument();
    expect(screen.getByText('Viewed: blood type')).toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('reports a failed audit lookup rather than claiming no access occurred', async () => {
    vi.mocked(getEmergencyCapsuleAccessLog).mockRejectedValue(new Error('unavailable'));
    render(<EmergencyAccessHistory patientId="PAT-DEMO" entries={[]} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText('No emergency summary accesses recorded.')).not.toBeInTheDocument();
  });
});
