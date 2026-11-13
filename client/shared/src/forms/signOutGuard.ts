/**
 * Before signing out: is anything this account recorded still only on this
 * device?
 *
 * Work saved with no signal waits, sealed, in the offline queue. Signing out
 * used to say nothing about it. Now the user is asked; choosing to sign out
 * anyway discards the queued items and destroys the key they were sealed under,
 * so nothing of them stays readable on a shared device (D2, 2026-10-30).
 */
import { getApiClient } from '../api/client';
import { confirmDialog } from '../components/Dialog';
import { discardUnsentSyncItems, unsentSyncItems } from '../utils/indexedDB';

export interface SignOutWording {
  title: string;
  /** Receives the number of unsent items. */
  message: (count: number) => string;
  confirm: string;
  cancel: string;
}

/** True when signing out may proceed. */
export async function confirmSignOutWithUnsent(wording: SignOutWording): Promise<boolean> {
  const owner = getApiClient().getUserId();
  if (!owner || typeof indexedDB === 'undefined') return true;
  let unsent = 0;
  try {
    unsent = (await unsentSyncItems(owner)).length;
  } catch {
    return true;
  }
  if (unsent === 0) return true;
  const leave = await confirmDialog({
    title: wording.title,
    message: wording.message(unsent),
    confirmLabel: wording.confirm,
    cancelLabel: wording.cancel,
    destructive: true,
  });
  if (leave) await discardUnsentSyncItems(owner).catch(() => undefined);
  return leave;
}
