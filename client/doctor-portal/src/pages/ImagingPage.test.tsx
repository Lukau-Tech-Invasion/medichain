import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ImagingPage from './ImagingPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ImagingPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          images: [
            {
              id: 'i1',
              title: 'Abdominal CT',
              date: new Date().toISOString(),
              type: 'CT Scan',
              thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
            }
          ],
        }),
      });
    });
  });

  it('renders imaging page', async () => {
    render(
      <MemoryRouter>
        <ImagingPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Medical Imaging/i)).toBeInTheDocument();
      expect(screen.getByText(/Abdominal CT/i)).toBeInTheDocument();
    });
  });

  it('displays image thumbnails', async () => {
    render(
      <MemoryRouter>
        <ImagingPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const images = screen.getAllByRole('img');
      expect(images.length).toBeGreaterThan(0);
    });
  });
});
