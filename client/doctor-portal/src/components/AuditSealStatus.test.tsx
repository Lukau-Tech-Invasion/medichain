import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { I18nProvider } from '@medichain/shared';
import type { AuditSealSummary } from '@medichain/shared';
import { AuditSealStatus } from './AuditSealStatus';

const HEALTHY: AuditSealSummary = {
  unsealed_events: 3,
  last_sealed_at: '2026-09-29T10:00:00Z',
  last_exported_at: '2026-09-29T10:05:00Z',
  sink: 'filesystem',
  signing: 'ed25519',
};

function renderStatus(summary: AuditSealSummary | null | undefined) {
  return render(
    <I18nProvider>
      <AuditSealStatus summary={summary} />
    </I18nProvider>,
  );
}

describe('AuditSealStatus', () => {
  it('renders nothing when the server did not report audit_seal', () => {
    const { container } = renderStatus(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the backlog, last seal and export, sink and signing state', () => {
    renderStatus(HEALTHY);
    const panel = screen.getByTestId('audit-seal-status');
    expect(panel).toHaveTextContent('Audit sealing');
    expect(panel).toHaveTextContent('3 entries waiting to be sealed');
    expect(panel).toHaveTextContent(/Last sealed/);
    expect(panel).toHaveTextContent(/Last exported/);
    expect(panel).toHaveTextContent('Checkpoints are exported to disk');
    expect(panel).toHaveTextContent('Batches are signed');
  });

  it('says so plainly when nothing has been sealed or exported', () => {
    renderStatus({ ...HEALTHY, last_sealed_at: null, last_exported_at: null });
    expect(screen.getByText('Nothing sealed yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing exported yet')).toBeInTheDocument();
  });

  it('reads an unsigned stream and a missing sink as weaker states', () => {
    renderStatus({ ...HEALTHY, sink: 'none', signing: 'unsigned' });
    const unsigned = screen.getByText('Batches are sealed without a signature (weaker)');
    const noSink = screen.getByText('No checkpoint export is configured');
    expect(unsigned).toHaveClass('text-caution-subtle-fg');
    expect(noSink).toHaveClass('text-caution-subtle-fg');
    expect(screen.queryByText('Batches are signed')).not.toBeInTheDocument();
  });
});
