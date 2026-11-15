import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PatientNavigation } from '../../../shared/src/components/PatientNavigation';

const sections = [{ label: 'My health', items: [
  { path: '/records', label: 'My Records', icon: () => null },
  { path: '/language', label: 'Language', icon: () => null },
] }];
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; });
afterEach(cleanup);
/** Render the drawer with a current route and observable dismissal. */
function setup() {
  const close = vi.fn();
  render(<MemoryRouter initialEntries={['/records']}><PatientNavigation sections={sections} onClose={close} onLogout={vi.fn()} /></MemoryRouter>);
  return close;
}
describe('patient navigation', () => {
  it('finds destinations and marks the current page', () => {
    setup();
    expect(screen.getByRole('link', { name: 'My Records' }).getAttribute('aria-current')).toBe('page');
    fireEvent.change(screen.getByLabelText('Find a page'), { target: { value: 'language' } });
    expect(screen.queryByRole('link', { name: 'My Records' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Language' })).toBeTruthy();
  });
  it('explains an empty search and recovers when cleared', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Find a page'), { target: { value: 'zzzz' } });
    expect(screen.getByRole('status').textContent).toContain('No pages found');
    fireEvent.change(screen.getByLabelText('Find a page'), { target: { value: '' } });
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
  it('dismisses on selecting a destination and native escape', () => {
    const close = setup();
    fireEvent.click(screen.getByRole('link', { name: 'My Records' }));
    expect(close).toHaveBeenCalled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true }));
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('locks background scrolling and restores it on unmount', () => {
    document.body.style.overflow = 'auto';
    setup();
    expect(document.body.style.overflow).toBe('hidden');
    cleanup();
    expect(document.body.style.overflow).toBe('auto');
  });
});
