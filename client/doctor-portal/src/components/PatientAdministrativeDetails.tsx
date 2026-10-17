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
  return <section aria-label={t('docPatientDetail.administrativeHeading')} className="bg-surface rounded-xl shadow p-6 lg:col-span-2">
    <h3 className="font-semibold text-content">{t('docPatientDetail.administrativeHeading')}</h3>
    <p className="text-sm text-content-muted mt-2">{t('docPatientDetail.administrativeNotice')}</p>
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
      {fields.map(([label, value]) => <div key={label} className="min-w-0">
        <dt className="text-sm text-content-muted">{t(`docPatientDetail.${label}`)}</dt>
        <dd className="text-content break-words">{value?.trim() || t('docPatientDetail.adminNotRecorded')}</dd>
      </div>)}
    </dl>
  </section>;
}
