import { useEffect, useState } from 'react';
import { formatDateOnly, useTranslation } from '@medichain/shared';
import { findDirectoryPatient, type Patient } from './PatientSelect';

/**
 * Render a patient by name and date of birth, not by record id.
 *
 * `PAT-8f3a…` identifies nobody to a clinician, and two patients cannot be told
 * apart by it at a glance; name plus date of birth is the pair a nurse checks
 * at the bedside. The patient counterpart of `StaffName`.
 *
 * One directory lookup per patient per page load, shared by every instance. An
 * id the directory cannot resolve is shown as the id, labelled as one: it is
 * never rendered as somebody else's name.
 */

const cache = new Map<string, Promise<Patient | null>>();

function lookup(patientId: string): Promise<Patient | null> {
  let found = cache.get(patientId);
  if (!found) {
    found = findDirectoryPatient(patientId).catch(() => null);
    cache.set(patientId, found);
  }
  return found;
}

/**
 * `dobOnly`: just "born …", for a row that already shows the name. The second
 * identifier under a name, where the record id used to sit.
 */
/**
 * `inherit`: take the surrounding colour, for a dark fixed panel (an imaging
 * viewer, a coloured banner) where the theme's text tokens would not pair.
 */
export function PatientName({ id, withDob = true, dobOnly = false, inherit = false }: {
  id: string | null | undefined;
  withDob?: boolean;
  dobOnly?: boolean;
  inherit?: boolean;
}) {
  const { t } = useTranslation();
  const [entry, setEntry] = useState<Patient | null>(null);

  useEffect(() => {
    setEntry(null);
    if (!id) return;
    let active = true;
    void lookup(id).then((found) => { if (active) setEntry(found); });
    return () => { active = false; };
  }, [id]);

  if (!id) return null;
  const muted = inherit ? '' : 'text-content-muted';
  const strong = inherit ? 'font-medium' : 'font-medium text-content';
  // The id stays on the element for anything that must find this patient's row.
  if (!entry) return <span className={muted} data-patient-name-of={id}>{t('kit.patientIdLabel', { id })}</span>;
  const dob = withDob || dobOnly ? formatDateOnly(entry.date_of_birth) : '';
  if (dobOnly) return dob ? <span className={muted} data-patient-name-of={id}>{t('kit.bornOn', { date: dob })}</span> : null;
  return (
    <span data-patient-name-of={id}>
      <span className={strong}>{entry.full_name}</span>
      {dob && <span className={muted}> · {t('kit.bornOn', { date: dob })}</span>}
    </span>
  );
}

export default PatientName;
