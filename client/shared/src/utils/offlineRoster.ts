/**
 * The clinician's day, kept on the device for use without signal.
 *
 * Owner decisions, 2026-11-04: only the day's patients (appointments, ward,
 * active care) are carried — never the roster — and only until the end of the
 * shift. The list is sealed under the signed-in account's non-extractable key
 * (`offlineSeal.ts`), so the IndexedDB files copied off a lost phone are
 * ciphertext, and it is deleted at sign-out.
 *
 * Every patient in it was logged server-side as "downloaded to a device for
 * offline use" when it was fetched, so the patient's access history shows it.
 */
import { getClinicianOfflineBundle, type OfflineBundle, type OfflinePatient } from '../api/endpoints';
import { cacheData, deleteItem, getCachedData, STORES } from './indexedDB';
import { canSeal, openBody, sealBody } from './offlineSeal';

const CATEGORY = 'clinician-day';

function rosterKey(owner: string): string {
  return `clinician-day:${owner}`;
}

/** Fetch the caller's day and keep it sealed on this device. */
export async function refreshOfflineRoster(owner: string): Promise<OfflineBundle> {
  const bundle = await getClinicianOfflineBundle();
  if (!canSeal()) return bundle; // never stored in the clear
  const ttl = Math.max(0, new Date(bundle.expires_at).getTime() - Date.now());
  await cacheData(rosterKey(owner), CATEGORY, 'Patients for today', await sealBody(bundle, owner), ttl, 'high', owner);
  return bundle;
}

/** The kept day, or `null` when there is none or it has expired. */
export async function readOfflineRoster(owner: string): Promise<OfflineBundle | null> {
  if (!canSeal()) return null;
  try {
    const sealed = await getCachedData<unknown>(rosterKey(owner));
    if (!sealed) return null;
    const bundle = (await openBody(sealed, owner)) as OfflineBundle;
    return new Date(bundle.expires_at).getTime() > Date.now() ? bundle : null;
  } catch {
    // A key that no longer opens it (signed out elsewhere) is the same as none.
    return null;
  }
}

/** Delete the kept day. Called at sign-out. */
export async function forgetOfflineRoster(owner: string): Promise<void> {
  try {
    await deleteItem(STORES.CACHED_DATA, rosterKey(owner));
  } catch {
    // Nothing stored, or storage unavailable: nothing left to delete.
  }
}

/**
 * Find patients in the kept day by name, health ID or date of birth.
 * The same identifiers the online search accepts, over the day only.
 */
export function searchOfflineRoster(bundle: OfflineBundle, query: string): OfflinePatient[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return bundle.patients;
  return bundle.patients.filter((p) => {
    const haystack = `${p.full_name} ${p.patient_id} ${p.date_of_birth}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
