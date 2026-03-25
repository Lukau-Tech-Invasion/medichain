import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import LabTrendsPage from './LabTrendsPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getLabTrends: vi.fn(),
}));

describe('LabTrendsPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
    });
    (shared.getLabTrends as any).mockResolvedValue({ success: true, trends: [] });
  });

  it('renders lab trends page', async () => {
    render(<LabTrendsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Lab Result Trends/i)).toBeInTheDocument();
      expect(screen.getByText(/Analyze your health over time/i)).toBeInTheDocument();
    });
  });

  it('displays demo trends when no API data is available', async () => {
    render(<LabTrendsPage />);

    await waitFor(() => {
      // Demo trends include Glucose, Hemoglobin A1c, etc.
      expect(screen.getByText(/Glucose/i)).toBeInTheDocument();
      expect(screen.getByText(/Hemoglobin A1c/i)).toBeInTheDocument();
    });
  });

  it('allows filtering by category', async () => {
    render(<LabTrendsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Glucose/i)).toBeInTheDocument();
    });

    const filterButton = screen.getByText(/Filter/i);
    fireEvent.click(filterButton);

    const metabolicPanelOption = screen.getByText(/Metabolic Panel/i);
    fireEvent.click(metabolicPanelOption);

    // Should still show Glucose (part of metabolic panel)
    expect(screen.getByText(/Glucose/i)).toBeInTheDocument();
  });
});
