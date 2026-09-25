import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, Ban, RefreshCw, Search, ShieldCheck, ShieldAlert } from 'lucide-react';
import {
  generateNFCCard,
  getApiErrorMessage,
  getCardInfo,
  listNFCCards,
  suspendCard,
  useTranslation,
  clickable,
  formatTimestamp,
} from '@medichain/shared';
import type { NFCCardInfo } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import PatientSelect from '../components/PatientSelect';

/**
 * HealthIdCardsPage
 *
 * Issue, look up and suspend the physical health ID card.
 *
 * The card is this product's headline: a paramedic taps it and sees blood type,
 * allergies and DNR status in three seconds. Four endpoints have backed it since
 * the beginning -- generate, card-by-patient, list, suspend -- and until now no
 * screen in either application called any of them. There was no way to issue a
 * card at all, so the feature the whole system is named for could only be
 * exercised with curl.
 *
 * The registry tab is Admin-only because `GET /api/nfc/cards` and
 * `POST /api/nfc/suspend` are; issuing is doctor, nurse or admin, matching
 * `Role::may_issue_identity_credentials`.
 */

/** What the API accepts for `national_id_type`, in its own short spellings. */
const ID_TYPES = [
  { value: 'fayda', labelKey: 'docHealthIdCards.idFayda' },
  { value: 'ghana', labelKey: 'docHealthIdCards.idGhana' },
  { value: 'nin', labelKey: 'docHealthIdCards.idNin' },
  { value: 'smartid', labelKey: 'docHealthIdCards.idSmartId' },
  { value: 'huduma', labelKey: 'docHealthIdCards.idHuduma' },
  { value: 'other', labelKey: 'docHealthIdCards.idOther' },
] as const;

type Tab = 'issue' | 'lookup' | 'registry';

interface IssuedCard {
  card_id: string;
  card_hash: string;
  qr_code_base64?: string;
}

const HealthIdCardsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();

  const isAdministrator = user?.role === 'Admin';

  const [tab, setTab] = useState<Tab>('issue');

  // Issue
  const [patientId, setPatientId] = useState('');
  const [idType, setIdType] = useState<string>('');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<IssuedCard | null>(null);
  const [existingCard, setExistingCard] = useState<NFCCardInfo | null>(null);
  const [preflightUnknown, setPreflightUnknown] = useState(false);

  // Lookup
  const [lookupPatientId, setLookupPatientId] = useState('');
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<NFCCardInfo | null>(null);
  const [lookupMessage, setLookupMessage] = useState('');

  // Registry
  const [cards, setCards] = useState<NFCCardInfo[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [registryError, setRegistryError] = useState('');
  const [suspending, setSuspending] = useState('');

  const loadRegistry = useCallback(async () => {
    if (!isAdministrator) return;
    setLoadingCards(true);
    try {
      const result = await listNFCCards();
      setCards(result.cards ?? []);
      setRegistryError('');
    } catch (err) {
      // Said out loud rather than rendered as an empty registry. "No cards have
      // been issued" and "the registry could not be read" are opposite facts.
      setRegistryError(getApiErrorMessage(err, t('docHealthIdCards.registryLoadFailed')));
    } finally {
      setLoadingCards(false);
    }
  }, [isAdministrator, t]);

  useEffect(() => {
    if (tab === 'registry') void loadRegistry();
  }, [tab, loadRegistry]);

  // Check the selected patient before enabling issuance. The API reports an
  // unissued card as null (a normal state), so this does not manufacture a 404
  // in the browser just to prevent a duplicate physical credential.
  useEffect(() => {
    if (!patientId) {
      setExistingCard(null);
      setPreflightUnknown(false);
      setIssued(null);
      return;
    }
    let cancelled = false;
    getCardInfo(patientId)
      .then((card) => {
        if (!cancelled) {
          setExistingCard(card);
          setPreflightUnknown(false);
        }
      })
      .catch(() => {
        // Issuance remains unavailable if this preflight cannot establish the
        // current state; avoid guessing that a duplicate does not exist.
        if (!cancelled) {
          setExistingCard(null);
          setPreflightUnknown(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const handleIssue = async () => {
    if (!patientId || !idType) {
      showError(t('docHealthIdCards.errIssueFields'));
      return;
    }
    if (existingCard) {
      showError(t('docHealthIdCards.alreadyIssued'));
      return;
    }
    if (preflightUnknown) {
      showError(t('docHealthIdCards.cardStatusUnknown'));
      return;
    }
    setIssuing(true);
    try {
      const result = await generateNFCCard({ patient_id: patientId, national_id_type: idType });
      // The card id and hash come from the response because they are generated
      // server-side; nothing here invents them.
      setIssued({
        card_id: result.card_id,
        card_hash: result.card_hash,
        qr_code_base64: result.qr_code_base64,
      });
      showSuccess(t('docHealthIdCards.issued'));
      if (tab === 'registry') await loadRegistry();
    } catch (err) {
      showError(getApiErrorMessage(err, t('docHealthIdCards.errIssue')));
    } finally {
      setIssuing(false);
    }
  };

  const handleLookup = async () => {
    if (!lookupPatientId) {
      showError(t('docHealthIdCards.errLookupPatient'));
      return;
    }
    setLooking(true);
    setFound(null);
    setLookupMessage('');
    try {
      const card = await getCardInfo(lookupPatientId);
      if (card) {
        setFound(card);
      } else {
        setLookupMessage(t('docHealthIdCards.noCardForPatient'));
      }
    } catch (err) {
      // A patient with no card is the common case, not an error worth a toast.
      setLookupMessage(getApiErrorMessage(err, t('docHealthIdCards.noCardForPatient')));
    } finally {
      setLooking(false);
    }
  };

  const handleSuspend = async (cardHash: string) => {
    setSuspending(cardHash);
    try {
      await suspendCard(cardHash);
      showSuccess(t('docHealthIdCards.suspended'));
      // Re-read rather than editing the row in place: the API is what decides
      // whether the suspension took, and a locally flipped badge would claim it
      // did even when storage refused.
      await loadRegistry();
    } catch (err) {
      showError(getApiErrorMessage(err, t('docHealthIdCards.errSuspend')));
    } finally {
      setSuspending('');
    }
  };

  const statusBadge = (status: string) => {
    const tone =
      status === 'Active'
        ? 'bg-ok-subtle text-ok-subtle-fg'
        : status === 'Suspended'
          ? 'bg-caution-subtle text-caution-subtle-fg'
          : 'bg-critical-subtle text-critical-subtle-fg';
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>{status}</span>;
  };

  const tabs: Tab[] = isAdministrator ? ['issue', 'lookup', 'registry'] : ['issue', 'lookup'];

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <CreditCard className="w-7 h-7 text-content-secondary" />
        <div>
          <h1 className="text-2xl font-bold text-content">{t('docHealthIdCards.title')}</h1>
          <p className="text-sm text-content-secondary">{t('docHealthIdCards.subtitle')}</p>
        </div>
      </div>

      <div className="border-b border-border mb-6">
        <div className="flex">
          {tabs.map((name) => (
            <button
              key={name}
              onClick={() => setTab(name)}
              className={`px-5 py-3 font-medium ${
                tab === name
                  ? 'text-content border-b-2 border-content'
                  : 'text-content-muted hover:text-content-secondary'
              }`}
            >
              {t(`docHealthIdCards.tab_${name}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'issue' && (
        <div className="max-w-2xl space-y-4">
          <PatientSelect
            id="healthid-patient"
            label={t('docHealthIdCards.patientLabel')}
            value={patientId}
            onChange={(id) => setPatientId(id)}
            required
          />
          <div>
            <label
              htmlFor="healthid-type"
              className="block text-sm font-semibold text-content-secondary mb-2"
            >
              {t('docHealthIdCards.idTypeLabel')}
            </label>
            {/* No pre-selected country. Which national ID a patient holds is
                something the clinician reads off the document in front of them,
                and a default here would be stamped onto every card issued by
                anyone who did not notice the field. */}
            <select
              id="healthid-type"
              value={idType}
              onChange={(e) => setIdType(e.target.value)}
              className="w-full border border-border-interactive rounded-lg px-3 py-2 bg-surface text-content"
            >
              <option value="">{t('docHealthIdCards.idTypePlaceholder')}</option>
              {ID_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleIssue}
            disabled={issuing || Boolean(existingCard) || preflightUnknown}
            className={`px-4 py-2 rounded-lg bg-brand text-brand-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 ${clickable}`}
          >
            {issuing ? t('docHealthIdCards.issuing') : t('docHealthIdCards.issue')}
          </button>
          {existingCard && (
            <p className="text-sm text-caution-subtle-fg" role="status">
              {t('docHealthIdCards.alreadyIssued')}
            </p>
          )}
          {preflightUnknown && (
            <p className="text-sm text-critical-subtle-fg" role="status">
              {t('docHealthIdCards.cardStatusUnknown')}
            </p>
          )}

          {issued && (
            <div className="border border-border rounded-lg p-4 bg-surface">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> {t('docHealthIdCards.issuedHeading')}
              </h2>
              <dl className="text-sm space-y-1">
                <div className="flex gap-2">
                  <dt className="text-content-secondary">{t('docHealthIdCards.cardId')}</dt>
                  <dd className="font-mono break-all select-all">{issued.card_id}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-content-secondary">{t('docHealthIdCards.cardHash')}</dt>
                  <dd className="font-mono break-all select-all">{issued.card_hash}</dd>
                </div>
              </dl>
              {issued.qr_code_base64 ? (
                <img
                  src={`data:image/png;base64,${issued.qr_code_base64}`}
                  alt={t('docHealthIdCards.qrAlt')}
                  className="mt-3 w-40 h-40"
                />
              ) : (
                // The API returns the QR as an optional field. Saying it is
                // missing beats rendering a broken image.
                <p className="mt-3 text-sm text-content-muted">
                  {t('docHealthIdCards.qrUnavailable')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'lookup' && (
        <div className="max-w-2xl space-y-4">
          <PatientSelect
            id="healthid-lookup-patient"
            label={t('docHealthIdCards.patientLabel')}
            value={lookupPatientId}
            onChange={(id) => setLookupPatientId(id)}
          />
          <button
            onClick={handleLookup}
            disabled={looking}
            className={`px-4 py-2 rounded-lg border border-border-interactive disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 flex items-center gap-2 ${clickable}`}
          >
            <Search className="w-4 h-4" />
            {looking ? t('docHealthIdCards.looking') : t('docHealthIdCards.lookup')}
          </button>

          {lookupMessage && (
            <div className="rounded-lg border border-border bg-surface-sunken p-3 text-sm text-content-secondary">
              {lookupMessage}
            </div>
          )}

          {found && (
            <div className="border border-border rounded-lg p-4 bg-surface text-sm space-y-1">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="w-4 h-4" />
                <span className="font-semibold">{found.card_id}</span>
                {statusBadge(found.status)}
              </div>
              <p className="font-mono break-all select-all">{found.card_hash}</p>
              <p className="text-content-secondary">{found.national_id_type}</p>
              <p className="text-content-muted">
                {t('docHealthIdCards.issuedAt', {
                  when: formatTimestamp(found.created_at * 1000),
                })}
              </p>
              <p className="text-content-muted">
                {found.last_used_at
                  ? t('docHealthIdCards.lastUsed', {
                      when: formatTimestamp(found.last_used_at * 1000),
                    })
                  : t('docHealthIdCards.neverUsed')}
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'registry' && isAdministrator && (
        <div className="space-y-4">
          <button
            onClick={() => void loadRegistry()}
            disabled={loadingCards}
            className={`px-3 py-2 rounded-lg border border-border-interactive text-sm flex items-center gap-2 disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 ${clickable}`}
          >
            <RefreshCw className="w-4 h-4" />
            {t('docHealthIdCards.refresh')}
          </button>

          {registryError && (
            <div
              role="alert"
              className="rounded-lg bg-critical-subtle text-critical-subtle-fg p-3 text-sm"
            >
              {registryError}
            </div>
          )}

          {cards.length === 0 && !loadingCards && !registryError ? (
            <p className="text-content-muted">{t('docHealthIdCards.registryEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-content-secondary">
                    <th className="py-2 pr-4">{t('docHealthIdCards.colPatient')}</th>
                    <th className="py-2 pr-4">{t('docHealthIdCards.colCardId')}</th>
                    <th className="py-2 pr-4">{t('docHealthIdCards.colIdType')}</th>
                    <th className="py-2 pr-4">{t('docHealthIdCards.colStatus')}</th>
                    <th className="py-2 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {cards.map((card) => (
                    <tr key={card.card_id} className="border-t border-border">
                      <td className="py-2 pr-4 font-mono break-all">{card.patient_id}</td>
                      <td className="py-2 pr-4 font-mono break-all">{card.card_id}</td>
                      <td className="py-2 pr-4">{card.national_id_type}</td>
                      <td className="py-2 pr-4">{statusBadge(card.status)}</td>
                      <td className="py-2 pr-4">
                        {card.status === 'Active' && (
                          <button
                            onClick={() => void handleSuspend(card.card_hash)}
                            disabled={suspending === card.card_hash}
                            className={`px-3 py-1 rounded-lg border border-critical text-critical-subtle-fg text-xs flex items-center gap-1 disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 ${clickable}`}
                          >
                            <Ban className="w-3 h-3" />
                            {t('docHealthIdCards.suspend')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HealthIdCardsPage;
