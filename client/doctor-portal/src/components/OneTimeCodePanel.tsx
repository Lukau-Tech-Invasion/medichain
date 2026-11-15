import { useState } from 'react';
import { useTranslation, copyTextToClipboard, formatTimestamp } from '@medichain/shared';
import { Copy, Check, Printer } from 'lucide-react';

interface OneTimeCodePanelProps {
  /** The one-time code, exactly as the server returned it. */
  code: string;
  /** When the code stops working (ISO 8601). */
  expiresAt?: string;
  /** What the person redeeming it must also give: a patient ID or an Employee ID. */
  identifier?: string;
  /** Heading, already translated. */
  title: string;
  /** Plain explanation of who receives this and what they do with it. */
  body: string;
  /** Heading of the printed slip. */
  printTitle: string;
  /** Instruction printed under the code. */
  printBody: string;
  /** Label for the identifier line, on screen and on the slip. */
  identifierLabel: string;
}

/**
 * A one-time credential code, shown once, and the ways to get it into the hands
 * of the person it belongs to.
 *
 * # Why this exists in this shape
 *
 * The server keeps only a hash of the code, so it cannot be fetched again; the
 * moment the page is left it is gone, and the remedy is a re-issue. Copy and
 * Print exist because reading twelve characters aloud for someone to write down
 * is where transcription errors come from. Print opens a slip holding only the
 * identifier, the code and the instructions -- not the page, so the patient's
 * record is not printed beside the key to their account.
 *
 * The clinic never learns the password: whoever holds the code chooses their own
 * when they redeem it.
 */
export function OneTimeCodePanel({
  code,
  expiresAt,
  identifier,
  title,
  body,
  printTitle,
  printBody,
  identifierLabel,
}: OneTimeCodePanelProps) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const expiry = expiresAt ? formatTimestamp(expiresAt) : '';

  const handleCopy = async () => {
    setCopyState((await copyTextToClipboard(code)) ? 'copied' : 'failed');
  };

  const handlePrint = () => {
    const slip = window.open('', '_blank', 'width=480,height=420');
    if (!slip) {
      setCopyState('failed');
      return;
    }
    const doc = slip.document;
    doc.title = printTitle;
    const heading = doc.createElement('h1');
    heading.textContent = printTitle;
    const lines: HTMLElement[] = [heading];
    if (identifier) {
      const idLine = doc.createElement('p');
      idLine.textContent = `${identifierLabel}: ${identifier}`;
      idLine.style.cssText = 'font: 16px/1.6 monospace;';
      lines.push(idLine);
    }
    const codeLine = doc.createElement('p');
    codeLine.textContent = code;
    codeLine.style.cssText = 'font: 22px/1.6 monospace; padding: 12px; border: 1px solid #000; letter-spacing: 2px;';
    lines.push(codeLine);
    if (expiry) {
      const expiryLine = doc.createElement('p');
      expiryLine.textContent = t('docActivationCode.validUntil', { time: expiry });
      lines.push(expiryLine);
    }
    const note = doc.createElement('p');
    note.textContent = printBody;
    lines.push(note);
    doc.body.style.fontFamily = 'system-ui, sans-serif';
    doc.body.append(...lines);
    slip.focus();
    slip.print();
  };

  return (
    <div className="rounded-lg border border-caution-subtle-fg/30 bg-caution-subtle p-4 text-left">
      <p className="font-semibold text-caution-subtle-fg">{title}</p>
      <p className="mt-1 text-sm text-caution-subtle-fg">{body}</p>

      {identifier && (
        <p className="mt-3 text-sm text-caution-subtle-fg">
          {identifierLabel}: <span className="font-mono font-medium">{identifier}</span>
        </p>
      )}
      <p
        data-testid="one-time-code"
        className="mt-2 select-all rounded bg-surface p-3 font-mono text-lg tracking-widest text-content break-words"
      >
        {code}
      </p>
      {expiry && (
        <p className="mt-1 text-sm text-caution-subtle-fg">
          {t('docActivationCode.validUntil', { time: expiry })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-lg border border-border-interactive bg-surface px-3 py-1.5 text-sm text-content hover:bg-surface-sunken"
        >
          {copyState === 'copied' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copyState === 'copied' ? t('docActivationCode.copied') : t('docActivationCode.copy')}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex items-center gap-1 rounded-lg border border-border-interactive bg-surface px-3 py-1.5 text-sm text-content hover:bg-surface-sunken"
        >
          <Printer size={14} aria-hidden />
          {t('docActivationCode.print')}
        </button>
        {copyState === 'failed' && (
          <span role="alert" className="text-sm text-caution-subtle-fg">
            {t('docActivationCode.copyFailed')}
          </span>
        )}
      </div>
      <p className="mt-3 text-sm text-caution-subtle-fg">{t('docActivationCode.shownOnce')}</p>
    </div>
  );
}

export default OneTimeCodePanel;
