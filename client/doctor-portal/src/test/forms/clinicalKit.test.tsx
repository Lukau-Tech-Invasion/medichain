/**
 * The shared clinical controls keep their promises: a measurement field holds
 * only what was typed (never a default, never a silently dropped value), "Now"
 * fills the current time, a status says which of six reasons a screen is empty,
 * and a queue row names its patient by two identifiers.
 */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NowButton, NumberField, StatusBanner, WorkQueueItem, localNow } from '@medichain/shared';

function Heart() {
  const [value, setValue] = useState('');
  return (
    <>
      <NumberField label="Heart rate" unit="bpm" integer value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe('NumberField', () => {
  it('starts empty and opens the numeric keypad', () => {
    render(<Heart />);
    const input = screen.getByLabelText(/heart rate/i);
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('inputmode', 'numeric');
  });

  it('keeps digits and refuses letters rather than storing a guess', () => {
    render(<Heart />);
    const input = screen.getByLabelText(/heart rate/i);
    fireEvent.change(input, { target: { value: '118' } });
    fireEvent.change(input, { target: { value: '118x' } });
    expect(screen.getByTestId('value')).toHaveTextContent('"118"');
  });

  it('accepts a decimal comma and stores a point', () => {
    let stored = '';
    render(<NumberField label="Temperature" value="" onChange={(v) => { stored = v; }} />);
    fireEvent.change(screen.getByLabelText(/temperature/i), { target: { value: '37,5' } });
    expect(stored).toBe('37.5');
  });
});

describe('NowButton', () => {
  it('fills the current local time in the input format', () => {
    let value = '';
    render(<NowButton label="Time given" onNow={(v) => { value = v; }} />);
    fireEvent.click(screen.getByRole('button', { name: /time given/i }));
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('formats a known instant', () => {
    const at = new Date(2026, 9, 31, 7, 5);
    expect(localNow('datetime-local', at)).toBe('2026-10-31T07:05');
    expect(localNow('time', at)).toBe('07:05');
    expect(localNow('date', at)).toBe('2026-10-31');
  });
});

describe('StatusBanner', () => {
  it('announces failures as alerts and offers a retry', () => {
    let retried = false;
    render(<StatusBanner kind="error" onRetry={() => { retried = true; }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i);
    fireEvent.click(screen.getByRole('button'));
    expect(retried).toBe(true);
  });

  it('does not offer retry for an empty list, and says it is empty rather than failed', () => {
    render(<StatusBanner kind="empty" message="No lab orders for this patient" onRetry={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('No lab orders for this patient');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('WorkQueueItem', () => {
  it('is one link naming the task and the patient by two identifiers', () => {
    render(
      <MemoryRouter>
        <WorkQueueItem title="Collect FBC" patientName="Thabo Mokoena" patientDetail="Born 12 Mar 1980"
          urgency="critical" urgencyLabel="STAT" to="/x" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('Collect FBC');
    expect(link).toHaveTextContent('Thabo Mokoena · Born 12 Mar 1980');
    expect(link).toHaveTextContent('STAT');
  });
});
