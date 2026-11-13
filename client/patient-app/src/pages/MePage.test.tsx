import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@medichain/shared';
import { describe, it, expect, vi } from 'vitest';
import { MePage } from './MePage';

vi.mock('../store/authStore', () => ({
  usePatientAuthStore: (select: (s: unknown) => unknown) => select({
    patient: { fullName: 'Thandiwe Nkosi', healthId: 'MC-48217703', userId: 'u-1' },
    logout: vi.fn(),
  }),
}));

describe('MePage', () => {
  it('opens every Me screen from one list, and nothing the plan retired', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <I18nProvider><MePage /></I18nProvider>
      </MemoryRouter>,
    );
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/profile',
      '/privacy', '/privacy?view=viewed', '/privacy?view=viewed#emergency-access',
      '/emergency-card', '/cards?view=family', '/cards',
      '/settings?view=language', '/settings',
    ]);
    // Offline sync is a section of Settings and the survey follows a visit
    // (owner decisions, 2026-11-04): neither is a row here.
    expect(screen.queryByText(/without internet|rate your care/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByText('Thandiwe Nkosi')).toBeInTheDocument();
  });
});
