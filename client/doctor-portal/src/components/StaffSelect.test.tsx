import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import StaffSelect from './StaffSelect';
import { useAuthStore } from '../store';
import * as shared from '@medichain/shared';

vi.mock('../store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getProviders: vi.fn(),
}));

const PATEL_ID = '6850124c-80fe-42ce-8a5d-485fd558061c';

describe('StaffSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'someone-else', role: 'Doctor' } });
    vi.mocked(shared.getProviders).mockResolvedValue({
      providers: [
        { user_id: PATEL_ID, name: 'Dr Yusuf Patel', role: 'Doctor' },
        { user_id: 'b1c2', name: 'Dr Ama Owusu', role: 'Doctor', username: 'a.owusu' },
      ],
    } as unknown as Awaited<ReturnType<typeof shared.getProviders>>);
  });

  // The dropdown printed the account UUID under every name with no login
  // name; nobody chooses a colleague by their UUID.
  it('lists people by name and login name, never by account id', async () => {
    render(<StaffSelect id="pick" label="Surgeon" value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByRole('textbox', { name: /Surgeon/ }));
    expect(await screen.findByText('Dr Yusuf Patel')).toBeInTheDocument();
    expect(screen.getByText('a.owusu')).toBeInTheDocument();
    expect(screen.queryByText(PATEL_ID)).not.toBeInTheDocument();
  });
});
