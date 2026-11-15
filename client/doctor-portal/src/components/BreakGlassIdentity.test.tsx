import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BreakGlassIdentity } from './ChartAccess';
import { forgetIdentifiedForTests, rememberIdentified } from '../workspace/identifiedPatients';
import { usePatientStore } from '../store/patientStore';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderIdentity(patientId: string) {
  render(<I18nProvider><BreakGlassIdentity patientId={patientId} /></I18nProvider>);
}

describe('who is this, before the glass is broken (c1)', () => {
  afterEach(() => {
    forgetIdentifiedForTests();
    usePatientStore.setState({ currentEmergency: null });
    mockFetch.mockReset();
  });

  it('shows only the id for a patient this tab never identified, and asks the server nothing', () => {
    renderIdentity('PAT-9');
    expect(screen.getByText(/Patient ID PAT-9/)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('names a patient chosen from the directory', () => {
    rememberIdentified({ patientId: 'PAT-1', name: 'Thandiwe Nkosi', dateOfBirth: '1992-03-12', gender: 'F' });
    renderIdentity('PAT-1');
    expect(screen.getByText('Thandiwe Nkosi')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('names a patient whose card was read', () => {
    usePatientStore.setState({ currentEmergency: { patientId: 'PAT-2', fullName: 'Sipho Mabaso', allergies: [], currentMedications: [] } });
    renderIdentity('PAT-2');
    expect(screen.getByText('Sipho Mabaso')).toBeInTheDocument();
  });

  it('does not carry one patient\'s card over to another id', () => {
    usePatientStore.setState({ currentEmergency: { patientId: 'PAT-2', fullName: 'Sipho Mabaso', allergies: [], currentMedications: [] } });
    renderIdentity('PAT-3');
    expect(screen.queryByText('Sipho Mabaso')).not.toBeInTheDocument();
  });
});
