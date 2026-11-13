import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PedigreeChart from './PedigreeChart';

describe('Recorded family relationships', () => {
  it('does not imply a shared parent for a half-sibling and renders zero age', () => {
    const { container } = render(<PedigreeChart patientName="Fictional Patient" familyMembers={[{
      memberId: 'FM-QA', patientId: 'PAT-QA', patientName: 'Fictional Patient',
      relationship: 'half-sister', name: 'Fictional Lerato', vitalStatus: 'unknown',
      currentAge: 0, conditions: [], recordedBy: 'DOC-QA', recordedAt: '',
    }]} />);
    expect(screen.getByRole('img', { name: 'Recorded family relationships' })).toBeInTheDocument();
    expect(screen.getByText('Half-sibling; shared parent not recorded')).toBeInTheDocument();
    expect(screen.getByText('0y')).toBeInTheDocument();
    expect(container.querySelector('line[stroke-dasharray="5 5"]')).toBeInTheDocument();
    expect(screen.getByText('Fictional Lerato')).toHaveClass('text-content');
  });
});
