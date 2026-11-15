import { createPortal } from 'react-dom';
import { ModalPanel } from '@medichain/shared';
import { StoredValue } from './StoredSoapDetails';

/** Preview a saved record independently of the application before printing it. */
export default function RecordPrintPreview({ title, record, onClose }: {
  title: string; record: unknown; onClose: () => void;
}) {
  if (record == null) return null;
  return createPortal(
    <ModalPanel
      label={`Print ${title}`}
      onClose={onClose}
      overlayClassName="record-print-root fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
      className="w-full max-w-4xl"
    >
      <article className="hp-record-paper bg-surface rounded-xl max-w-4xl w-full max-h-[90vh] overflow-auto p-6 text-content">
        <header className="mb-5 border-b border-border-interactive pb-3">
          <h1 className="text-xl font-semibold">MediChain — {title}</h1>
          <div className="no-print mt-3 flex gap-3">
            <button type="button" onClick={() => window.print()} className="border rounded-lg px-3 py-2">Print document</button>
            <button type="button" onClick={onClose} className="border rounded-lg px-3 py-2">Close</button>
          </div>
        </header>
        <StoredValue value={record} />
      </article>
    </ModalPanel>, document.body,
  );
}
