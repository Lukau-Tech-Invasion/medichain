import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import AppointmentScheduler from './AppointmentScheduler';

describe('AppointmentScheduler', () => {
  it('renders appointment scheduler page', () => {
    render(<AppointmentScheduler />);

    expect(screen.getByText(/Appointment Scheduler/i)).toBeInTheDocument();
    expect(screen.getByText(/Manage and schedule patient appointments/i)).toBeInTheDocument();
  });

  it('displays calendar and upcoming appointments', () => {
    render(<AppointmentScheduler />);

    expect(screen.getByText(/Calendar View/i)).toBeInTheDocument();
    expect(screen.getByText(/Upcoming Appointments/i)).toBeInTheDocument();
  });

  it('allows searching for appointments', () => {
    render(<AppointmentScheduler />);

    const input = screen.getByPlaceholderText(/Search appointments/i);
    fireEvent.change(input, { target: { value: 'John Doe' } });
    expect(input).toHaveValue('John Doe');
  });

  it('allows opening the schedule new appointment modal', () => {
    render(<AppointmentScheduler />);

    const addButton = screen.getByText(/Schedule New/i);
    fireEvent.click(addButton);

    expect(screen.getByText(/Schedule New Appointment/i)).toBeInTheDocument();
  });
});
