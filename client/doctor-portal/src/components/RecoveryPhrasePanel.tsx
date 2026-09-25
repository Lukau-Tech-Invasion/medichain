import { useState } from 'react';
import { useTranslation, copyTextToClipboard } from '@medichain/shared';
import { Copy, Check, Printer } from 'lucide-react';

interface RecoveryPhrasePanelProps {
  mnemonic: string;
  /** Omit on a read-only showing, where there is nothing left to confirm. */
  acknowledged?: boolean;
  onAcknowledgedChange?: (acknowledged: boolean) => void;
}

/**
 * The patient's recovery phrase, and the ways to get it into their hands.
 *
 * # Why registration waits on the checkbox
 *
 * The phrase is generated in this browser and never sent anywhere, so nothing
 * at the clinic can recover it. A record registered against a wallet whose
 * phrase was lost is a record its patient can never sign in to. Before this,
 * the only control was a link that hid the words, and a clerk could register
 * without ever having shown them to anyone -- in a live demo, one misclick
 * made the patient just registered unreachable.
 *
 * Copy and Print exist because reading twelve words aloud for someone to
 * write down is where transcription errors come from. Print opens a slip
 * holding only the phrase, not the page, so the patient's record is not
 * printed beside the key to it.
 */
export function RecoveryPhrasePanel({
  mnemonic,
  acknowledged,
  onAcknowledgedChange,
}: RecoveryPhrasePanelProps) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = async () => {
    setCopyState((await copyTextToClipboard(mnemonic)) ? 'copied' : 'failed');
  };

  const handlePrint = () => {
    const slip = window.open('', '_blank', 'width=480,height=360');
    if (!slip) {
      setCopyState('failed');
      return;
    }
    const doc = slip.document;
    doc.title = t('docRegisterPatient.recoveryPrintTitle');
    const heading = doc.createElement('h1');
    heading.textContent = t('docRegisterPatient.recoveryPrintTitle');
    const words = doc.createElement('p');
    words.textContent = mnemonic;
    words.style.cssText = 'font: 18px/1.6 monospace; padding: 12px; border: 1px solid #000;';
    const note = doc.createElement('p');
    note.textContent = t('docRegisterPatient.recoveryPrintBody');
    doc.body.style.fontFamily = 'system-ui, sans-serif';
    doc.body.append(heading, words, note);
    slip.focus();
    slip.print();
  };

  return (
    <div className="mt-3 rounded-lg border border-caution-subtle-fg/30 bg-caution-subtle p-4">
      <p className="font-semibold text-caution-subtle-fg">{t('docRegisterPatient.recoveryTitle')}</p>
      <p className="mt-1 text-sm text-caution-subtle-fg">{t('docRegisterPatient.recoveryBody')}</p>
      <p
        data-testid="recovery-phrase"
        className="mt-2 select-all rounded bg-surface p-3 font-mono text-sm text-content break-words"
      >
        {mnemonic}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-lg border border-border-interactive bg-surface px-3 py-1.5 text-sm text-content hover:bg-surface-sunken"
        >
          {copyState === 'copied' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copyState === 'copied' ? t('docRegisterPatient.recoveryCopied') : t('docRegisterPatient.recoveryCopy')}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex items-center gap-1 rounded-lg border border-border-interactive bg-surface px-3 py-1.5 text-sm text-content hover:bg-surface-sunken"
        >
          <Printer size={14} aria-hidden />
          {t('docRegisterPatient.recoveryPrint')}
        </button>
        {copyState === 'failed' && (
          <span role="alert" className="text-sm text-caution-subtle-fg">
            {t('docRegisterPatient.recoveryCopyFailed')}
          </span>
        )}
      </div>

      {onAcknowledgedChange && (
        <label className="mt-3 flex items-start gap-2 text-sm text-caution-subtle-fg">
          <input
            id="recovery-phrase-acknowledged"
            type="checkbox"
            checked={acknowledged ?? false}
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>{t('docRegisterPatient.recoveryAcknowledge')}</span>
        </label>
      )}
    </div>
  );
}
