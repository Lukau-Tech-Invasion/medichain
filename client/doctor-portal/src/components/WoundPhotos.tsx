import { useEffect, useState } from 'react';
import { downloadRecordContent, uploadMedicalRecord, useTranslation } from '@medichain/shared';

/** Read a bounded raster photograph as base64 for the encrypted document endpoint. */
export async function uploadWoundPhoto(file: File, patientId: string): Promise<string> {
  if (!patientId || file.size > 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) {
    throw new Error('INVALID_WOUND_PHOTO');
  }
  const encoded = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('WOUND_PHOTO_READ_FAILED'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
  const header = atob(encoded).slice(0, 8);
  const valid = file.type === 'image/png' ? header === '\x89PNG\r\n\x1a\n' : header.startsWith('\xff\xd8\xff');
  if (!valid) throw new Error('INVALID_WOUND_PHOTO');
  const result = await uploadMedicalRecord({ patient_id: patientId, content_base64: encoded,
    filename: file.name, content_type: file.type, record_type: 'imaging' });
  if (!result.success || !result.ipfs_hash) throw new Error('WOUND_PHOTO_UPLOAD_FAILED');
  return result.ipfs_hash;
}

/** Choose encrypted photo attachments. Removing a link preserves the patient's document. */
export function WoundPhotoPicker({ patientId, hashes, onChange, onBusy }: {
  patientId: string; hashes: string[]; onChange: (hashes: string[]) => void; onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choose = async (file?: File) => {
    if (!file) return;
    setError(''); setBusy(true); onBusy(true);
    try { onChange([...hashes, await uploadWoundPhoto(file, patientId)]); }
    catch (error) { console.error('Wound photo upload failed', error); setError(t('docWoundCare.photoFailed')); }
    finally { setBusy(false); onBusy(false); }
  };
  return <section>
    <label htmlFor="wound-photo" className="block font-medium">{t('docWoundCare.photoUpload')}</label>
    <p className="text-sm text-content-muted">{t('docWoundCare.photoHelp')}</p>
    <input id="wound-photo" type="file" accept="image/png,image/jpeg" disabled={!patientId || busy || hashes.length >= 4}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file); }} />
    {busy && <p role="status">{t('docWoundCare.photoUploading')}</p>}
    {error && <p role="alert">{error}</p>}
    {hashes.map((hash, index) => <div key={hash} className="flex gap-3 mt-2">
      <span>{t('docWoundCare.photoNumber', { number: index + 1 })}</span>
      <button type="button" onClick={() => onChange(hashes.filter(item => item !== hash))}>{t('common.remove')}</button>
    </div>)}
  </section>;
}

/** Retrieve a selected patient's protected image only when its View button is pressed. */
export function WoundPhotoViewer({ patientId, hashes }: { patientId: string; hashes: string[] }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const view = async (hash: string) => {
    setError('');
    try {
      const result = await downloadRecordContent(hash, patientId);
      if (!['image/png', 'image/jpeg'].includes(result.contentType.split(';')[0]) || result.blob.size > 1024 * 1024) {
        throw new Error('INVALID_WOUND_PHOTO');
      }
      setUrl(URL.createObjectURL(result.blob));
    } catch (error) { console.error('Wound photo read failed', error); setError(t('docWoundCare.photoReadFailed')); }
  };
  return <section>
    {hashes.map((hash, index) => <button key={hash} type="button" className="rounded border p-2 mr-2" onClick={() => void view(hash)}>
      {t('docWoundCare.viewPhoto', { number: index + 1 })}
    </button>)}
    {error && <p role="alert">{error}</p>}
    {url && <div role="dialog" aria-label={t('docWoundCare.photoPreview')} className="mt-3 border p-3">
      <button type="button" onClick={() => setUrl('')}>{t('common.close')}</button>
      <img src={url} alt={t('docWoundCare.photoPreview')} className="max-w-full max-h-96" />
    </div>}
  </section>;
}
