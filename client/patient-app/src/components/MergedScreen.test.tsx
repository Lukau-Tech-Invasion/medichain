import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { MergedScreen, MovedTo, PageTitle } from './MergedScreen';

function Where() {
  const { search } = useLocation();
  return <p data-testid="search">{search}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/privacy" element={<>
          <MergedScreen title="Who sees my records" sections={[
            { id: 'access', label: 'Has access', render: () => <PageTitle>Access Control</PageTitle> },
            { id: 'viewed', label: 'Viewed my records', render: () => <PageTitle>Who viewed</PageTitle> },
          ]} />
          <Where />
        </>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MergedScreen', () => {
  it('opens the section the address names, with one main heading', () => {
    renderAt('/privacy?view=viewed');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Viewed my records' })).toHaveAttribute('aria-selected', 'true');
    // The section's own title is still announced, as a sub-heading.
    expect(screen.getByRole('heading', { level: 2, name: 'Who viewed' })).toBeInTheDocument();
  });

  it('falls back to the first section for an unknown view', () => {
    renderAt('/privacy?view=nonsense');
    expect(screen.getByRole('tab', { name: 'Has access' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the open section in the address, and moves with the arrow keys', () => {
    renderAt('/privacy');
    fireEvent.click(screen.getByRole('tab', { name: 'Viewed my records' }));
    expect(screen.getByTestId('search')).toHaveTextContent('?view=viewed');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Viewed my records' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Has access' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('search')).toHaveTextContent('');
  });
});

describe('MovedTo', () => {
  it('keeps the query of the old address and opens the absorbing section', () => {
    render(
      <MemoryRouter initialEntries={['/telehealth?session=S1&join=1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/telehealth" element={<MovedTo path="/appointments" view="video" />} />
          <Route path="/appointments" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('search')).toHaveTextContent('?session=S1&join=1&view=video');
  });
});
