import { useCallback, useEffect, useRef } from 'react';

/**
 * Tell a reply that is still wanted from one that has been overtaken.
 *
 * A loader keyed on something that changes -- the selected patient, a filter,
 * a tab -- can be answered out of order: the slow reply for the previous
 * patient lands after the next patient is selected and is written to the
 * screen under the wrong name. Call the returned function when a read starts;
 * it hands back a check that is true only while no later read has started and
 * the component is still mounted. Test it after every `await`, before writing
 * state:
 *
 * ```ts
 * const beginRead = useLatestRequest();
 * const load = useCallback(async (patientId: string) => {
 *   const current = beginRead();
 *   setLoading(true);
 *   try {
 *     const data = await getFlowsheet(patientId);
 *     if (current()) setFlowsheet(data);
 *   } catch (err) {
 *     if (current()) setError(message(err));
 *   } finally {
 *     if (current()) setLoading(false);   // the newer read owns the spinner
 *   }
 * }, [beginRead]);
 * ```
 *
 * One instance per resource: two unrelated reads sharing one would cancel
 * each other. A page whose value is only ever read (never patched locally
 * after a save) should use `useAsyncRead`, which is built on this.
 */
export function useLatestRequest(): () => () => boolean {
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  return useCallback(() => {
    const mine = ++generation.current;
    return () => mine === generation.current;
  }, []);
}
