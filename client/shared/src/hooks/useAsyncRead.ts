import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRequest } from './useLatestRequest';

export type AsyncReadStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface AsyncRead<T> {
  /** The value for the current key, or null while it is not `ready`. */
  data: T | null;
  status: AsyncReadStatus;
  /** What the loader threw, while `failed`. */
  error: unknown;
  /** Read again for the current key. The previous value is cleared first. */
  reload: () => Promise<void>;
}

interface Held<T> {
  key: string;
  data: T | null;
  status: 'loading' | 'ready' | 'failed';
  error: unknown;
}

/**
 * Load one resource for `key` and keep the answer only while it is still the
 * answer to the question being asked.
 *
 * A page that fetches in a bare effect has a race: the reply for the previous
 * patient can arrive after the next patient is selected and overwrite what is
 * on screen. Here every request takes a number, and a reply whose number is no
 * longer the latest is dropped -- on a key change, a reload, and unmount
 * (`useLatestRequest`).
 *
 * - `key` names what is being read (a patient id, an account id, a filter).
 *   `null` or `''` means there is nothing to read yet: the status is `idle`
 *   and the loader is not called.
 * - A new key never shows the old key's value, not even for one render.
 * - A failed read is `failed` with `data: null`. It is never an empty list:
 *   "could not load" and "there are none" are different answers.
 * - There is no dependency array. The read re-runs when `key` changes or
 *   `reload` is called; the loader itself is read through a ref, so passing an
 *   inline function is safe and does not re-fetch on every render.
 */
export function useAsyncRead<T>(
  key: string | null | undefined,
  load: (key: string) => Promise<T>,
): AsyncRead<T> {
  const activeKey = key ? key : null;
  const beginRead = useLatestRequest();
  const loader = useRef(load);
  loader.current = load;
  const [held, setHeld] = useState<Held<T> | null>(null);

  const read = useCallback(async (forKey: string) => {
    const current = beginRead();
    setHeld({ key: forKey, data: null, status: 'loading', error: null });
    try {
      const data = await loader.current(forKey);
      if (current()) setHeld({ key: forKey, data, status: 'ready', error: null });
    } catch (error) {
      if (current()) setHeld({ key: forKey, data: null, status: 'failed', error });
    }
  }, [beginRead]);

  useEffect(() => {
    if (activeKey !== null) void read(activeKey);
    else beginRead(); // nothing to read any more: whatever is in flight is obsolete
  }, [activeKey, read, beginRead]);

  const reload = useCallback(async () => {
    if (activeKey !== null) await read(activeKey);
  }, [activeKey, read]);

  if (activeKey === null) return { data: null, status: 'idle', error: null, reload };
  if (!held || held.key !== activeKey) return { data: null, status: 'loading', error: null, reload };
  return { data: held.data, status: held.status, error: held.error, reload };
}
