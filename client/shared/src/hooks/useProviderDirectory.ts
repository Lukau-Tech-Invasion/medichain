import { useEffect, useState } from 'react';
import { getProviders } from '../api/endpoints';

/**
 * Resolve a `user_id` to the clinician's name.
 *
 * Clinical records store the acting clinician by `user_id`, because that is the
 * API's canonical caller identity. Rendering it directly puts a UUID where a
 * reader expects a person, which is what several documentation pages were
 * doing. `GET /api/providers` is readable by any registered caller and gives
 * the mapping.
 *
 * The unresolved value falls back to the id itself rather than to a blank or
 * an invented name: an unknown author must stay visibly attributable.
 */
export function useProviderDirectory(userId: string | undefined) {
  const [directory, setDirectory] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getProviders()
      .then(({ providers }) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const provider of providers) {
          if (provider.user_id && provider.name) {
            map[provider.user_id] = provider.name;
          }
        }
        setDirectory(map);
      })
      .catch(() => {
        // A directory lookup failing must never break the page that uses it;
        // callers fall back to showing the raw id.
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /** The clinician's name, or the id when it cannot be resolved. */
  const providerName = (id: string | null | undefined): string => {
    if (!id) return '—';
    return directory[id] || id;
  };

  return { directory, providerName };
}
