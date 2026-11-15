// The badge and helpers live in `@medichain/shared`; shared has no test runner
// of its own, so their tests live here, as `useStepUp.test.ts` does.
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { I18nProvider, SealStatusBadge, combineSealStatuses, summariseSignatures } from '@medichain/shared';
import type { SealStatus } from '@medichain/shared';

function renderBadge(status: SealStatus | 'partial' | null | undefined) {
  return render(
    <I18nProvider>
      <SealStatusBadge status={status} />
    </I18nProvider>,
  );
}

describe('SealStatusBadge', () => {
  it.each([
    ['pending', 'Sealing pending'],
    ['sealed', 'Sealed'],
    ['exported', 'Sealed and exported'],
    ['partial', 'Partly sealed'],
  ] as const)('renders %s as "%s"', (status, label) => {
    renderBadge(status);
    expect(screen.getByTestId('seal-badge')).toHaveTextContent(new RegExp(`^${label}$`));
  });

  it('renders nothing for a null or absent state', () => {
    const { container: nullContainer } = renderBadge(null);
    const { container: undefinedContainer } = renderBadge(undefined);
    expect(nullContainer).toBeEmptyDOMElement();
    expect(undefinedContainer).toBeEmptyDOMElement();
  });

  it('never uses the finished colours for a pending or partial state', () => {
    renderBadge('pending');
    expect(screen.getByTestId('seal-badge')).toHaveClass('bg-caution-subtle');
    renderBadge('sealed');
    expect(screen.getAllByTestId('seal-badge')[1]).toHaveClass('bg-ok-subtle');
  });
});

describe('combineSealStatuses', () => {
  it('is never stronger than the weakest reported entry', () => {
    expect(combineSealStatuses(['exported', 'exported'])).toBe('exported');
    expect(combineSealStatuses(['exported', 'sealed'])).toBe('sealed');
    expect(combineSealStatuses(['sealed', 'pending'])).toBe('partial');
    expect(combineSealStatuses(['pending', 'pending'])).toBe('pending');
  });

  it('ignores entries with no reported state, and answers null when none has one', () => {
    expect(combineSealStatuses(['sealed', null, undefined])).toBe('sealed');
    expect(combineSealStatuses([null, undefined])).toBeNull();
    expect(combineSealStatuses([])).toBeNull();
  });
});

describe('summariseSignatures', () => {
  it('reports the worst signature, and unsigned as itself', () => {
    expect(summariseSignatures([{ signature: 'valid' }, { signature: 'valid' }])).toBe('valid');
    expect(summariseSignatures([{ signature: 'valid' }, { signature: 'unsigned' }])).toBe('unsigned');
    expect(summariseSignatures([{ signature: 'unsigned' }, { signature: 'invalid' }])).toBe('invalid');
  });

  it('is none when no row is in a sealed batch', () => {
    expect(summariseSignatures([{ signature: null }])).toBe('none');
    expect(summariseSignatures([])).toBe('none');
  });
});
