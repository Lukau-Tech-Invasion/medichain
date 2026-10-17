import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RecordPrintPreview from './RecordPrintPreview';

describe('RecordPrintPreview', () => {
  it('prints a separate saved-data document, preserving dates, units and unknown values', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const close = vi.fn();
    render(<><aside>Unrelated application screen</aside><RecordPrintPreview title="QA result"
      record={{ patientName: 'Synthetic Patient', result: '12.5', unit: 'g/dL',
        collectedAt: new Date('2026-10-09T10:00:00Z'), observations: {},
        narrative: '<script>unsafe()</script>' }} onClose={close} /></>);
    const document = screen.getByRole('dialog', { name: 'Print QA result' });
    expect(document.parentElement).toBe(window.document.body);
    expect(within(document).queryByText('Unrelated application screen')).not.toBeInTheDocument();
    expect(within(document).getByText('g/dL')).toBeInTheDocument();
    expect(within(document).getByText('Not recorded')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(within(document).getByText(/2026/)).toBeInTheDocument();
    fireEvent.click(within(document).getByRole('button', { name: 'Print document' }));
    expect(print).toHaveBeenCalledOnce();
    fireEvent.click(within(document).getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledOnce();
    print.mockRestore();
  });
});
