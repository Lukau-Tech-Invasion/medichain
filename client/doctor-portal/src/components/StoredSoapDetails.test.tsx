import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StoredSoapDetails } from './StoredSoapDetails';

describe('StoredSoapDetails', () => {
  it('reads all saved sections and corrections without executing note markup', () => {
    const { container } = render(<StoredSoapDetails note={{
      subjective: { chief_complaint: '<img src=x onerror=alert(1)>' },
      objective: { physical_exam: [{ system: 'General', is_normal: false, findings: 'Not examined' }] },
      assessment: { clinical_summary: 'Synthetic assessment' },
      plan: { treatment_plan: 'Synthetic plan', medications: [] },
      addenda: [{ content: 'QA correction', author_id: 'doctor-qa', created_at: 1791523898 }],
    }} />);
    fireEvent.click(screen.getByText('Read saved note and addenda'));
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Not examined')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Synthetic assessment')).toBeInTheDocument();
    expect(screen.getByText('Synthetic plan')).toBeInTheDocument();
    expect(screen.getByText('QA correction')).toBeInTheDocument();
    expect(screen.getByText('doctor-qa')).toBeInTheDocument();
  });

  it('does not manufacture missing observations or corrections', () => {
    render(<StoredSoapDetails note={{ objective: {} }} />);
    expect(screen.getAllByText('Not recorded')).toHaveLength(4);
    expect(screen.getByText('Addenda (0)')).toBeInTheDocument();
    expect(screen.getByText('None recorded')).toBeInTheDocument();
  });
});
