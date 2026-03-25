import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import StrokePage from './StrokePage';

describe('StrokePage', () => {
  it('renders stroke page', () => {
    render(<StrokePage />);

    expect(screen.getByText(/Acute Stroke Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/NIH Stroke Scale \(NIHSS\) and tPA Checklist/i)).toBeInTheDocument();
  });

  it('displays NIHSS sections', () => {
    render(<StrokePage />);

    expect(screen.getByText(/1a. Level of Consciousness/i)).toBeInTheDocument();
    expect(screen.getByText(/1b. LOC Questions/i)).toBeInTheDocument();
  });

  it('allows calculating NIHSS score', () => {
    render(<StrokePage />);

    // Select '1 - Drowsy' for LOC (adds 1 point)
    const radio = screen.getByLabelText(/1 - Drowsy/i);
    fireEvent.click(radio);

    expect(screen.getByText(/NIHSS Total:/i)).toBeInTheDocument();
  });
});
