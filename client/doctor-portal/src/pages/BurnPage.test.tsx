import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BurnPage from './BurnPage';

describe('BurnPage', () => {
  it('renders burn page', () => {
    render(<BurnPage />);

    expect(screen.getByText(/Burn Assessment/i)).toBeInTheDocument();
    // TBSA here is Rule of 9s with a paediatric adjustment. Lund-Browder is
    // the more accurate paediatric chart but needs a different region set —
    // logged in docs/TECHNICAL_DEBT_REGISTER.md rather than half-applied.
    expect(screen.getByText(/Rule of 9s & Parkland Formula Calculator/i)).toBeInTheDocument();
  });

  it('displays TBSA calculation section', () => {
    render(<BurnPage />);

    // The chart is Rule of 9s with a paediatric adjustment, not Lund-Browder;
    // see the burn-TBSA entry in docs/TECHNICAL_DEBT_REGISTER.md.
    expect(screen.getByText(/Rule of 9s - Body Surface Area/i)).toBeInTheDocument();
  });

  it('allows selecting burn depth per body region', () => {
    const { container } = render(<BurnPage />);

    // Burns are charted per body region, and each region's depth is disabled
    // until that region has a burned percentage — a depth with no area is not
    // a meaningful entry. The product uses ABA depth terms (superficial /
    // partial / full thickness), not the older "degree" wording.
    const percent = container.querySelector('#burn-percent-head') as HTMLInputElement;
    fireEvent.change(percent, { target: { value: '4.5' } });

    const depth = container.querySelector('#burn-depth-head') as HTMLSelectElement;
    expect(depth).not.toBeDisabled();
    fireEvent.change(depth, { target: { value: 'full-thickness' } });
    expect(depth).toHaveValue('full-thickness');
  });
});
