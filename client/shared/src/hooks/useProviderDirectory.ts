import { useEffect, useState } from 'react';
import { apiUrl } from '../config';

interface ProviderRow {
  name: string;
  role: string;
  specialty: string | null;
  username: string | null;
  wallet_address: string;
}

/**
 * Resolve a wallet address to the clinician's name.
 *
 * Clinical records store the acting clinician as a wallet address, because that
 * is the API's canonical caller identity. Rendering it directly puts a 48-character
 * SS58 string where a reader expects a person, which is what several documentation
 * pages were doing. `GET /api/providers` is readable by any registered caller and
 * gives the mapping.
 *
 * The unresolved value falls back to the address itself rather than to a blank or
 * an invented name: an unknown author must stay visibly attributable.
 */
export function useProviderDirectory(walletAddress: string | undefined) {
  const [directory, setDirectory] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    fetch(apiUrl('/api/providers'), {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': walletAddress },
    })
      .then(response => (response.ok ? response.json() : { providers: [] }))
      .then((body: { providers?: ProviderRow[] }) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const provider of body.providers || []) {
          if (provider.wallet_address && provider.name) {
            map[provider.wallet_address] = provider.name;
          }
        }
        setDirectory(map);
      })
      .catch(() => {
        // A directory lookup failing must never break the page that uses it;
        // callers fall back to showing the raw address.
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  /** The clinician's name, or the address when it cannot be resolved. */
  const providerName = (address: string | null | undefined): string => {
    if (!address) return '—';
    return directory[address] || address;
  };

  return { directory, providerName };
}
