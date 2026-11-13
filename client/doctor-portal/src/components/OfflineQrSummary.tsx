import { formatDateOnly } from '@medichain/shared';
import type { OfflineEmergencySummary } from '@medichain/shared';
import { WifiOff } from 'lucide-react';

/**
 * The emergency summary printed inside a patient's Medical ID QR, shown when
 * the server cannot be reached (or the code predates server access). It is
 * what the patient chose to carry, not a server-verified record, and the page
 * says so: nothing here was checked or recorded in their access history.
 */
export function OfflineQrSummary({ summary, reason }: { summary: OfflineEmergencySummary; reason: string }) {
  const unknown = 'Not recorded';
  const yesNo = (value: boolean | null) => (value === null ? unknown : value ? 'Yes' : 'No');
  const made = summary.generatedAt ? formatDateOnly(summary.generatedAt * 1000) : '';
  return (
    <section
      aria-labelledby="offline-qr-summary"
      className="mt-4 rounded-lg border border-caution bg-caution-subtle p-4 text-caution-subtle-fg"
    >
      <h3 id="offline-qr-summary" className="flex items-center gap-2 font-semibold">
        <WifiOff className="h-4 w-4" aria-hidden="true" /> Summary printed on the patient's QR code
      </h3>
      <p className="mt-1 text-sm">{reason}</p>
      {summary.profileUnavailable ? (
        <p className="mt-3 text-sm font-medium">This code could not include the patient's details when it was made.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="font-medium">Name</dt>
          <dd>{summary.name ?? unknown}</dd>
          <dt className="font-medium">Date of birth</dt>
          <dd>{summary.dateOfBirth ?? unknown}</dd>
          <dt className="font-medium">Blood type</dt>
          <dd>{summary.bloodType ?? unknown}</dd>
          <dt className="font-medium">Allergies</dt>
          <dd>{summary.allergies.length ? summary.allergies.join(', ') : 'None listed on this code'}</dd>
          <dt className="font-medium">DNR</dt>
          <dd>
            {yesNo(summary.dnr)}
            {summary.dnr && summary.dnrVerified !== true ? ' (not verified)' : ''}
          </dd>
          <dt className="font-medium">Organ donor</dt>
          <dd>{yesNo(summary.organDonor)}</dd>
          <dt className="font-medium">Emergency contact</dt>
          <dd>
            {summary.emergencyContact ? (
              <>
                {summary.emergencyContact.name}
                {summary.emergencyContact.relationship ? ` (${summary.emergencyContact.relationship})` : ''}{' '}
                <a className="underline" href={`tel:${summary.emergencyContact.phone}`}>
                  {summary.emergencyContact.phone}
                </a>
              </>
            ) : (
              unknown
            )}
          </dd>
        </dl>
      )}
      {made && <p className="mt-3 text-xs">Code made {made}. Details may have changed since.</p>}
    </section>
  );
}
