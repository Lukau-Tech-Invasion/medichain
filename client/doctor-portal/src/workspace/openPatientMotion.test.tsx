/**
 * c10 "Open patient": the tapped row's name lends the chart banner its
 * transition name for the length of the transition -- and only when no banner
 * is on screen already, since two elements with one name abort it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MotionLink, withViewTransition, WorkQueueItem } from '@medichain/shared';

type Doc = { startViewTransition?: unknown };

function fakeTransitions() {
  let finish: () => void = () => undefined;
  const seen: Array<string | null> = [];
  const start = vi.fn((update: () => void) => {
    seen.push(document.querySelector<HTMLElement>('[style*="view-transition-name"]')?.style.getPropertyValue('view-transition-name') ?? null);
    update();
    return { finished: new Promise<void>((resolve) => { finish = resolve; }) };
  });
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
  return { seen, finish: () => finish() };
}

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
  document.body.innerHTML = '';
});

describe('withViewTransition', () => {
  it('tags the source for the transition, then untags it', async () => {
    const t = fakeTransitions();
    const row = document.body.appendChild(document.createElement('span'));
    const update = vi.fn();
    withViewTransition(update, row);
    expect(update).toHaveBeenCalled();
    expect(t.seen).toEqual(['patient-identity']);
    t.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(row.style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('leaves the name to a banner already on screen', () => {
    const t = fakeTransitions();
    document.body.appendChild(document.createElement('div')).className = 'mc-patient-identity';
    const row = document.body.appendChild(document.createElement('span'));
    withViewTransition(() => undefined, row);
    expect(row.style.getPropertyValue('view-transition-name')).toBe('');
    expect(t.seen).toEqual([null]);
  });

  it('just navigates where the browser has no transitions', () => {
    const update = vi.fn();
    withViewTransition(update, document.createElement('span'));
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('a queue row that opens a patient', () => {
  it('opens the chart through a transition, gliding from the name', () => {
    const t = fakeTransitions();
    render(
      <MemoryRouter initialEntries={['/today']}>
        <Routes>
          <Route path="/today" element={<WorkQueueItem title="Thandiwe Ndlovu" to="/patients/P1" opensPatient />} />
          <Route path="/patients/:id" element={<p>chart</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: /Thandiwe Ndlovu/ }));
    expect(screen.getByText('chart')).toBeInTheDocument();
    expect(t.seen).toEqual(['patient-identity']);
  });

  it('leaves a modified click to the browser', () => {
    fakeTransitions();
    render(<MemoryRouter><MotionLink opensPatient to="/patients/P1">Open</MotionLink></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'Open' });
    // jsdom cannot follow a real navigation; stop it after React has seen the click.
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener('click', stop);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(event);
    window.removeEventListener('click', stop);
    expect((document as unknown as Doc).startViewTransition).not.toHaveBeenCalled();
  });
});
