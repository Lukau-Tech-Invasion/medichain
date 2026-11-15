import { useEffect, useRef, useState } from 'react';
import { getApiClient, updateUserProfile, useTranslation } from '@medichain/shared';
import type { User } from '@medichain/shared';

interface Contact { email: string; phone: string }
type StoredContact = Pick<User, 'user_id' | 'email' | 'phone'>;

/** Read only this account's persisted contact details; reject a mismatched identity. */
async function readContact(userId: string): Promise<Contact> {
  const saved = await getApiClient().get<StoredContact>(`/api/users/${encodeURIComponent(userId)}`);
  if (saved.user_id !== userId) throw new Error('Contact response identity mismatch');
  return { email: saved.email ?? '', phone: saved.phone ?? '' };
}

/** Edit collected contact fields independently of notification/display preferences. */
export function ClinicianContactDetails({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Contact>({ email: '', phone: '' });
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    setReady(false); setError(''); setNotice('');
    readContact(userId).then(contact => {
      if (generation.current !== current) return;
      setDraft(contact); setReady(true);
    }).catch(error => {
      console.error('Contact details could not be loaded', error);
      if (generation.current === current) setError(t('docSettings.contactLoadFailed'));
    });
    return () => { generation.current++; };
  }, [userId, attempt, t]);

  /** Save once, then verify the persisted values; retain drafts when confirmation fails. */
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !ready) return;
    busy.current = true; setPending(true); setError(''); setNotice('');
    const current = generation.current;
    const submitted = { email: draft.email.trim(), phone: draft.phone.trim() };
    try {
      await updateUserProfile(userId, submitted);
      const saved = await readContact(userId);
      if (generation.current !== current) return;
      if (saved.email !== submitted.email || saved.phone !== submitted.phone) {
        throw new Error('Saved contact values were not confirmed');
      }
      setDraft(saved); setNotice(t('docSettings.contactSaved'));
    } catch (error) {
      console.error('Contact save could not be confirmed', error);
      if (generation.current === current) setError(t('docSettings.contactSaveFailed'));
    } finally {
      busy.current = false;
      if (generation.current === current) setPending(false);
    }
  }

  return <section aria-label={t('docSettings.contactDetails')} className="mt-6">
    <h3 className="font-semibold text-content">{t('docSettings.contactDetails')}</h3>
    {error && <p role="alert" className="my-3 rounded border border-critical bg-critical-subtle p-3 text-critical-subtle-fg">{error}</p>}
    {!ready ? <>
      {!error && <p role="status">{t('docSettings.contactLoading')}</p>}
      {error && <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded border border-border-interactive px-3 py-2">{t('docSettings.contactRetry')}</button>}
    </> : <form aria-label={t('docSettings.contactDetails')} onSubmit={event => void save(event)}>
      <fieldset disabled={pending} className="mt-3 grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="clinician-contact-email" className="block font-medium">{t('docSettings.email')}</label>
          <input id="clinician-contact-email" type="email" maxLength={254} value={draft.email}
            onChange={event => { setDraft(value => ({ ...value, email: event.target.value })); setNotice(''); }}
            className="w-full rounded border border-border-interactive bg-surface p-3 text-content" /></div>
        <div><label htmlFor="clinician-contact-phone" className="block font-medium">{t('docSettings.phone')}</label>
          <input id="clinician-contact-phone" type="tel" maxLength={32} value={draft.phone}
            onChange={event => { setDraft(value => ({ ...value, phone: event.target.value })); setNotice(''); }}
            className="w-full rounded border border-border-interactive bg-surface p-3 text-content" /></div>
        <p className="text-sm text-content-muted sm:col-span-2">{t('docSettings.contactOptional')}</p>
        <button type="submit" className="rounded border border-border-interactive px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2">
          {t(pending ? 'docSettings.saving' : 'docSettings.contactSave')}
        </button>
      </fieldset>
    </form>}
    {notice && <p role="status" className="mt-3 text-content">{notice}</p>}
  </section>;
}
