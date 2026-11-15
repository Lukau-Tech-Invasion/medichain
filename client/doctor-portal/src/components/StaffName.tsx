import { useEffect, useState } from 'react';
import { getProviders, type BookableProvider } from '@medichain/shared';
import { useAuthStore } from '../store';

/**
 * Render who did something by their name, not their user id.
 *
 * Records store the actor's `user_id`, which is the right identity for the
 * API to keep — it is unambiguous. It is the wrong thing to put in front of a
 * clinician: a UUID tells a reader nothing, and two colleagues cannot be told
 * apart by it. An
 * order, a note or a dispensing record is only accountable if the person who
 * made it can be recognised.
 *
 * The directory is fetched once per page load and shared by every instance, so
 * a list of fifty rows makes one request, not fifty.
 *
 * When an id is not in the directory it is shown unchanged. That is
 * deliberate: an id that cannot be resolved must never be rendered as
 * somebody else's name, and an account may legitimately be absent (deactivated,
 * or belonging to another facility).
 */

type Directory = Map<string, BookableProvider>;

let cache: Directory | null = null;
let inFlight: Promise<Directory> | null = null;
const subscribers = new Set<(d: Directory) => void>();

async function loadDirectory(): Promise<Directory> {
  if (cache) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const directory: Directory = new Map();
    try {
      const { providers } = await getProviders();
      for (const row of providers) {
        if (row.user_id) directory.set(row.user_id, row);
      }
    } catch {
      // An unreachable directory means ids stay as ids, which is
      // the honest fallback. It is not worth a visible error on every row.
    }
    cache = directory;
    inFlight = null;
    subscribers.forEach((notify) => notify(directory));
    return directory;
  })();
  return inFlight;
}

/** The display name for a `user_id`, or the id itself when unknown. */
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
    void loadDirectory().then(notify);
    return () => {
      active = false;
      subscribers.delete(notify);
    };
  }, [user]);

  if (!id) return '';
  const found = directory?.get(id);
  return found?.name || found?.username || id;
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
    void loadDirectory().then(notify);
    return () => {
      active = false;
      subscribers.delete(notify);
    };
  }, [user]);

  return (id?: string | null) => {
    if (!id) return '';
    const found = directory?.get(id);
    return found?.name || found?.username || id;
  };
}

interface StaffNameProps {
  /** The stored actor: a `user_id`, or already a name. */
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
