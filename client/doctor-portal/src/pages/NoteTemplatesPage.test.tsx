import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NoteTemplatesPage from './NoteTemplatesPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

describe('NoteTemplatesPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
  });

  it('renders note templates page', () => {
    render(<NoteTemplatesPage />);

    expect(screen.getByText(/Clinical Note Templates/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search templates/i)).toBeInTheDocument();
  });

  it('displays default templates', () => {
    render(<NoteTemplatesPage />);

    expect(screen.getByText(/SOAP Note/i)).toBeInTheDocument();
    expect(screen.getByText(/H&P/i)).toBeInTheDocument();
    expect(screen.getByText(/Discharge Summary/i)).toBeInTheDocument();
  });

  it('allows selecting a template to view', () => {
    render(<NoteTemplatesPage />);

    const template = screen.getByText(/SOAP Note/i);
    fireEvent.click(template);

    expect(screen.getByText(/Template Content/i)).toBeInTheDocument();
  });
});
