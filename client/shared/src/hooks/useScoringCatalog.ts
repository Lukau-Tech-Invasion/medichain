import { useEffect, useState } from 'react';
import { getScoringCatalog, type ScoringCatalog } from '../clinical/scoring';

/**
 * Module-level cache. The catalog describes protocol, changes only when the
 * server is redeployed, and is fetched by several pages at once — a per-mount
 * request would put four identical calls on the wire every time a clinician
 * opens the burn page.
 */
let cached: ScoringCatalog | null = null;
let inFlight: Promise<ScoringCatalog> | null = null;

/**
 * The clinical scoring thresholds, for live previews.
 *
 * `catalog` is `null` until it loads and stays `null` if the request fails.
 * That is deliberate and the callers depend on it: every preview helper in
 * `clinical/scoring` returns `null` for a null catalog, so a page with no
 * catalog shows a dash rather than a score computed from numbers it made up.
 *
 * A stored score never comes from here. It comes back in the create response.
 */
export function useScoringCatalog(): {
  catalog: ScoringCatalog | null;
  isLoading: boolean;
  error: string | null;
} {
  const [catalog, setCatalog] = useState<ScoringCatalog | null>(cached);
  const [isLoading, setIsLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cached) return;
    let active = true;

    inFlight ??= getScoringCatalog();
    inFlight
      .then((result) => {
        cached = result;
        if (active) {
          setCatalog(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        // Cleared so a later mount retries rather than being stuck on a
        // transient failure for the life of the tab.
        inFlight = null;
        if (active) {
          setError(err instanceof Error ? err.message : 'Scoring catalog unavailable');
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return { catalog, isLoading, error };
}
