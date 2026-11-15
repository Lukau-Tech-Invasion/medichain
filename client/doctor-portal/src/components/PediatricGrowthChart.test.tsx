import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PediatricGrowthChart from './PediatricGrowthChart';

describe('PediatricGrowthChart', () => {
  it('keeps unknown ages out of the plotted series and preserves the newborn age of zero', () => {
    render(<PediatricGrowthChart points={[
      { ageMonths: null, weight: 20, height: null, date: null },
      { ageMonths: 0, weight: 3.2, height: null, date: null },
    ]} />);
    expect(screen.getByRole('img', { name: 'Weight by recorded age in months' }).querySelectorAll('circle')).toHaveLength(1);
    expect(screen.getByText(/^0 months: 3.2 kg;/)).toBeInTheDocument();
    expect(screen.queryByText(/null months/)).not.toBeInTheDocument();
    expect(screen.getByText('Height: no measurements with a recorded age.')).toBeInTheDocument();
    expect(screen.getByText(/Measurements without a recorded age are listed in the table/)).toBeInTheDocument();
  });
});
