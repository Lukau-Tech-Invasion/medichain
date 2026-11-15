import { useState } from 'react';
import { getCardInfo, nfcErrorMessage, nfcSupported, writeNfcCard, useTranslation } from '@medichain/shared';
import { Nfc } from 'lucide-react';

/**
 * Write the patient's issued MediChain card number onto a blank NFC sticker or
 * card, so a clinician's Android phone can read it with a tap.
 *
 * Web NFC exists only in Chrome on Android, so on any other device this
 * renders nothing. The number written is the card the clinic issued
 * (`nfc_tags.id`): holding the sticker is then the same as holding the card,
 * and emergency access from it is recorded in the patient's access history.
 */
export function NfcStickerWriter({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'waiting' | 'done' | 'failed'>('idle');
  const [message, setMessage] = useState('');

  if (!nfcSupported()) return null;

  const write = async () => {
    setState('waiting');
    setMessage(t('medicalId.nfcHoldSticker'));
    try {
      const card = await getCardInfo(patientId);
      if (!card || card.status.toLowerCase() !== 'active') {
        setState('failed');
        setMessage(t('medicalId.nfcNoCard'));
        return;
      }
      await writeNfcCard(card.card_id);
      setState('done');
      setMessage(t('medicalId.nfcWritten'));
    } catch (error) {
      setState('failed');
      setMessage(nfcErrorMessage(error));
    }
  };

  return (
    <div className="patient-card text-center">
      <div className="flex items-center justify-center gap-2 mb-2">
        <Nfc className="w-5 h-5 text-content-muted" aria-hidden="true" />
        <h3 className="font-bold text-content">{t('medicalId.nfcTitle')}</h3>
      </div>
      <p className="text-sm text-content-muted mb-2">{t('medicalId.nfcDesc')}</p>
      <button
        type="button"
        onClick={() => void write()}
        disabled={state === 'waiting'}
        className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-brand-fg rounded-lg text-sm font-medium hover:bg-brand transition-colors disabled:opacity-60"
      >
        <Nfc className="w-4 h-4" aria-hidden="true" />
        {t('medicalId.nfcWrite')}
      </button>
      {message && (
        <p role={state === 'failed' ? 'alert' : 'status'} className="mt-2 text-sm text-content-secondary">
          {message}
        </p>
      )}
    </div>
  );
}
