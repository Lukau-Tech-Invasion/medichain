import { useTranslation, type PatientProfile } from '@medichain/shared';

export type PatientAdministrativeData = Pick<PatientProfile, 'phone' | 'gender' | 'address' | 'insurance'>;

/** Present administrative facts from the existing authorized chart read, without inferring coverage. */
export function PatientAdministrativeDetails({ details }: { details: PatientAdministrativeData }) {
  const { t } = useTranslation();
  const insurance = details.insurance;
  const address = details.address;
  const addressText = [address?.street, address?.city, address?.state, address?.postal_code, address?.country]
    .filter(value => typeof value === 'string' && value.trim()).join(', ');
  const status = typeof insurance?.is_active === 'boolean'
    ? t(insurance.is_active ? 'docPatientDetail.reportedActive' : 'docPatientDetail.reportedInactive')
    : undefined;
  const fields = [
    ['adminPhone', details.phone], ['adminGender', details.gender], ['adminAddress', addressText],
    ['adminInsurer', insurance?.provider], ['adminPolicy', insurance?.policy_number],
    ['adminGroup', insurance?.group_number], ['adminCoverage', insurance?.coverage_type],
    ['adminStatus', status], ['adminFrom', insurance?.valid_from], ['adminTo', insurance?.valid_to],
  ];
  // What was recorded is listed; what was not is named once, on one line, so
  // ten "Not recorded" rows do not fill the chart (still said, rule 12).
  const recorded = fields.filter(([, value]) => value?.trim());
  const missing = fields.filter(([, value]) => !value?.trim()).map(([label]) => t(`docPatientDetail.${label}`));
  return <section aria-label={t('docPatientDetail.administrativeHeading')} className="bg-surface rounded-lg border border-border p-4">
    <h3 className="font-semibold text-content" title={t('docPatientDetail.administrativeNotice')}>{t('docPatientDetail.administrativeHeading')}</h3>
    {recorded.length > 0 && (
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {recorded.map(([label, value]) => <div key={label} className="contents">
          <dt className="text-content-muted">{t(`docPatientDetail.${label}`)}</dt>
          <dd className="text-content break-words">{value?.trim()}</dd>
        </div>)}
      </dl>
    )}
    {missing.length > 0 && (
      <p className="mt-2 text-sm text-content-muted">
        <span className="font-medium">{t('docPatientDetail.adminNotRecorded')}:</span> {missing.join(', ')}
      </p>
    )}
    <p className="mt-2 text-xs text-content-muted">{t('docPatientDetail.administrativeNotice')}</p>
  </section>;
}
