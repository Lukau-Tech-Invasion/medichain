import { useEffect, useState } from 'react';
import { getApiErrorMessage, getMessageRecipients, useTranslation } from '@medichain/shared';
import type { MessageRecipients } from '@medichain/shared';

/**
 * Who a clinician can write to: the patients they are treating, then staff.
 *
 * The compose box used the staff picker, so a doctor could not message a
 * patient at all. Patients appear once the clinician is treating them (the
 * patient granted access, an appointment, consultation or referral, or
 * emergency access); the server refuses a message to anyone else.
 */
export default function MessageRecipientSelect({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (userId: string) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const [recipients, setRecipients] = useState<MessageRecipients | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    getMessageRecipients()
      .then((body) => current && setRecipients(body))
      .catch((err) => current && setError(getApiErrorMessage(err, t('docMessages.recipientsFailed'))));
    return () => {
      current = false;
    };
  }, [t]);

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-content-secondary mb-1">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        disabled={!recipients}
        className="w-full border border-border-interactive rounded px-3 py-2 text-sm bg-surface text-content min-h-[44px]"
      >
        <option value="">{recipients ? t('docMessages.chooseRecipient') : t('common.loading')}</option>
        {recipients && recipients.patients.length > 0 && (
          <optgroup label={t('docMessages.patientsGroup')}>
            {recipients.patients.map((patient) => (
              <option key={patient.user_id} value={patient.user_id}>
                {patient.name}
              </option>
            ))}
          </optgroup>
        )}
        {recipients && recipients.staff.length > 0 && (
          <optgroup label={t('docMessages.staffGroup')}>
            {recipients.staff.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.name} ({member.role}
                {member.specialty ? `, ${member.specialty}` : ''})
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-xs text-critical-subtle-fg">
          {error}
        </p>
      )}
      {recipients && recipients.patients.length === 0 && (
        <p className="mt-1 text-xs text-content-muted">{t('docMessages.noPatientsHint')}</p>
      )}
    </div>
  );
}
