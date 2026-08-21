/**
 * WalletAddress — the only sanctioned way to show a blockchain address in the UI.
 *
 * # Why
 *
 * MediChain is blockchain-backed, but ordinary clinical work is not blockchain
 * administration. A 48-character SS58 address is not something a clinician
 * should read, retype, or be expected to recognise. The audit found addresses
 * used as plain form fields and as primary identifiers on clinical screens
 * (`docs/WORKFLOW_AUDIT.md`, §15 findings).
 *
 * The rule: show a person's *name* in clinical context. Show the address only
 * where it has genuine verification or administrative value — profile and
 * security screens, audit trails, admin tooling — and when you do, show it
 * shortened, make it copyable, and say what it is.
 */

import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { shortenAddress } from '../wallet/service';

export interface WalletAddressProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The SS58 address. Renders nothing when empty. */
  address: string | null | undefined;
  /** Show the address in full instead of `5Grw...utQY`. */
  full?: boolean;
  /** Render a copy button. On by default — copying is the point. */
  copyable?: boolean;
  /**
   * A short explanation of what this address is for, shown on hover/focus.
   * Defaults to a generic description; override where a more specific one
   * helps ("the wallet this record was signed with").
   */
  hint?: string;
  /** Accessible label for the copy button. */
  copyLabel?: string;
  /** Announced after a successful copy. */
  copiedLabel?: string;
}

/**
 * Copy text to the clipboard, falling back to a hidden textarea where the
 * async Clipboard API is unavailable (insecure origins, older WebViews — both
 * realistic for clinic tablets).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path rather than failing outright.
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export function WalletAddress({
  address,
  full = false,
  copyable = true,
  hint = 'Blockchain account address for this user',
  copyLabel = 'Copy full address',
  copiedLabel = 'Address copied',
  className,
  ...props
}: WalletAddressProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the pending reset if the component goes away mid-timeout, so we
  // never call setState on an unmounted component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onCopy = useCallback(async () => {
    if (!address) return;
    const ok = await copyTextToClipboard(address);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, [address]);

  if (!address) return null;

  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)} {...props}>
      <span
        className="font-mono text-sm"
        title={`${hint}: ${address}`}
        // The shortened form is decorative; assistive tech gets the whole
        // thing, since "5Grw dot dot dot utQY" is useless read aloud.
        aria-label={full ? undefined : `${hint}: ${address}`}
      >
        {full ? address : shortenAddress(address)}
      </span>
      {copyable && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={copyLabel}
          className="rounded p-0.5 text-xs underline decoration-dotted underline-offset-2 opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          {copied ? '✓' : 'Copy'}
        </button>
      )}
      {/* Announce the result rather than relying on the glyph change alone. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </span>
  );
}
