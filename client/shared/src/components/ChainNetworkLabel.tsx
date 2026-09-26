import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n/react';
import { getApiClient } from '../api/client';

/** The part of `/api/health` this label reads. */
interface HealthChain {
  chain_network?: string;
}

/**
 * Footer label naming the blockchain network (WP8): "development chain"
 * until the deployment declares production validators. Reads the API's own
 * answer; shows nothing if the API cannot be asked, rather than guessing.
 */
export function ChainNetworkLabel() {
  const { t } = useTranslation();
  const [network, setNetwork] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApiClient()
      .get<HealthChain>('/api/health')
      .then((body) => {
        if (!cancelled) setNetwork(body.chain_network ?? null);
      })
      .catch((error: unknown) => console.warn('Chain network label unavailable', error));
    return () => {
      cancelled = true;
    };
  }, []);

  if (network === null) return null;
  return (
    <span className="block text-xs text-content-muted">
      {network === 'production' ? t('verification.productionChain') : t('verification.developmentChain')}
    </span>
  );
}
