import type { SealSignature, SealStatus } from '../types';

/**
 * A set of entries' combined seal state: one of the three per-entry states, or
 * `partial` when some entries are sealed and some are not.
 */
export type CombinedSealStatus = SealStatus | 'partial';

/**
 * Combine the seal states of several entries (for example the rows of one
 * access session) into the one state a badge shows.
 *
 * Entries the server gave no state for are ignored while at least one entry
 * has one; when none does the answer is `null` and nothing should be shown.
 * The result is never stronger than the weakest known entry: `exported` needs
 * every known entry exported, `sealed` needs every known entry sealed or
 * exported.
 *
 * @param statuses - Per-entry `seal_status` values, in any order.
 * @returns The combined state, or `null` when no entry reported one.
 */
export function combineSealStatuses(
  statuses: ReadonlyArray<SealStatus | null | undefined>,
): CombinedSealStatus | null {
  const known = statuses.filter((status): status is SealStatus => status != null);
  if (known.length === 0) return null;
  if (known.every((status) => status === 'exported')) return 'exported';
  if (known.every((status) => status === 'pending')) return 'pending';
  if (known.every((status) => status !== 'pending')) return 'sealed';
  return 'partial';
}

/** The translation key naming a seal state. */
export function sealLabelKey(status: CombinedSealStatus): string {
  switch (status) {
    case 'exported':
      return 'seal.exported';
    case 'sealed':
      return 'seal.sealed';
    case 'partial':
      return 'seal.partial';
    default:
      return 'seal.pending';
  }
}

/**
 * The signature state of a set of sealed batches, worst first.
 *
 * `none` means no row is in a sealed batch, so there is nothing to have signed.
 * `unsigned` is reported as itself: a batch sealed without a key is a weaker
 * guarantee than a valid signature and must never read as one.
 */
export type SignatureSummary = SealSignature | 'none';

/**
 * Summarise the signatures of verified rows.
 *
 * @param rows - Verification rows; those without a batch have `signature: null`.
 * @returns `invalid` if any signature failed, else `unsigned` if any batch is
 *   unsigned, else `valid` if every batch checked out, else `none`.
 */
export function summariseSignatures(
  rows: ReadonlyArray<{ signature: SealSignature | null }>,
): SignatureSummary {
  const signatures = rows.map((row) => row.signature).filter((s): s is SealSignature => s !== null);
  if (signatures.length === 0) return 'none';
  if (signatures.includes('invalid')) return 'invalid';
  if (signatures.includes('unsigned')) return 'unsigned';
  return 'valid';
}
