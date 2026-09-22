import { useEffect, useState } from 'react';
import { apiUrl, getApiClient } from '@medichain/shared';
import { useAuthStore } from '../store';

/**
 * Render who did something by their name, not their wallet address.
 *
 * Records store the actor's SS58 wallet, which is the right identity for the
 * API to keep — it is what signs, and it is unambiguous. It is the wrong thing
 * to put in front of a clinician: `5GnPcTux4PX1F8RchBGn9QBgS3fPu3AnVQyQc9snQ74LoCDG`
 * tells a reader nothing, and two colleagues cannot be told apart by it. An
 * order, a note or a dispensing record is only accountable if the person who
 * made it can be recognised.
 *
 * The directory is fetched once per page load and shared by every instance, so
 * a list of fifty rows makes one request, not fifty.
 *
 * When a wallet is not in the directory the address is shown unchanged. That is
 * deliberate: a wallet that cannot be resolved must never be rendered as
 * somebody else's name, and an account may legitimately be absent (deactivated,
 * or belonging to another facility).
 */

interface Provider {
  wallet_address: string;
  name?: string;
  username?: string;
  role?: string;
  email?: string;
  specialty?: string;
}

type Directory = Map<string, Provider>;

let cache: Directory | null = null;
let inFlight: Promise<Directory> | null = null;
const subscribers = new Set<(d: Directory) => void>();

async function loadDirectory(wallet: string, role: string): Promise<Directory> {
  if (cache) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const directory: Directory = new Map();
    try {
      const response = await fetch(apiUrl('/api/providers'), {
        headers: {
          ...getApiClient().getSessionHeaders(wallet),
          'X-Provider-Role': role,
        },
      });
      if (response.ok) {
        const body = await response.json();
        const rows: Provider[] = Array.isArray(body.providers) ? body.providers : [];
        for (const row of rows) {
          if (row.wallet_address) directory.set(row.wallet_address, row);
        }
      }
    } catch {
      // An unreachable directory means addresses stay as addresses, which is
      // the honest fallback. It is not worth a visible error on every row.
    }
    cache = directory;
    inFlight = null;
    subscribers.forEach((notify) => notify(directory));
    return directory;
  })();
  return inFlight;
}

/** Forget the directory, so the next render re-reads it (used on sign-out). */
export function resetStaffDirectory() {
  cache = null;
  inFlight = null;
}

/** The display name for a wallet, or the wallet itself when unknown. */
export function useStaffName(id?: string | null): string {
  const { user } = useAuthStore();
  const [directory, setDirectory] = useState<Directory | null>(cache);

  useEffect(() => {
    if (!user || cache) {
      if (cache) setDirectory(cache);
      return;
    }
    let active = true;
    const notify = (d: Directory) => {
      if (active) setDirectory(d);
    };
    subscribers.add(notify);
    void loadDirectory(user.walletAddress, user.role).then(notify);
    return () => {
      active = false;
      subscribers.delete(notify);
    };
  }, [user]);

  if (!id) return '';
  const found = directory?.get(id);
  return found?.name || found?.username || found?.email || id;
}

/**
 * A resolver for screens that put the name inside a sentence.
 *
 * `useStaffName` is a hook and cannot be called per row inside a `.map()`.
 * This is called once at the top of a component and returns a plain function,
 * so a list can resolve every actor it renders. The component re-renders when
 * the directory arrives.
 */
export function useStaffDirectory(): (id?: string | null) => string {
  const { user } = useAuthStore();
  const [directory, setDirectory] = useState<Directory | null>(cache);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const notify = (d: Directory) => {
      if (active) setDirectory(d);
    };
    subscribers.add(notify);
    void loadDirectory(user.walletAddress, user.role).then(notify);
    return () => {
      active = false;
      subscribers.delete(notify);
    };
  }, [user]);

  return (id?: string | null) => {
    if (!id) return '';
    const found = directory?.get(id);
    return found?.name || found?.username || found?.email || id;
  };
}

interface StaffNameProps {
  /** The stored actor: a wallet address, or already a name. */
  id?: string | null;
  /** Shown when `id` is empty. */
  fallback?: string;
  className?: string;
  /** Append the person's role, when the directory knows it. */
  withRole?: boolean;
}

/** Who did it, in words. */
export default function StaffName({ id, fallback = '—', className, withRole }: StaffNameProps) {
  const name = useStaffName(id);
  const { user } = useAuthStore();
  const [, force] = useState(0);
  useEffect(() => {
    // Re-render once the shared directory arrives.
    const notify = () => force((n) => n + 1);
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  }, [user]);

  if (!id) return <span className={className}>{fallback}</span>;
  const role = withRole ? cache?.get(id)?.role : undefined;
  return (
    <span className={className} title={name === id ? undefined : id}>
      {name}
      {role ? ` (${role})` : ''}
    </span>
  );
}
