import { useEffect } from 'react';
import { getApiClient } from '../api/client';
import { useStepUp } from '../hooks/useStepUp';
import { StepUpDialog } from './StepUpDialog';

/**
 * Where a Class C confirmation is asked for (ADR-0008).
 *
 * A gated mutation -- deciding access, changing consent, changing someone's
 * role or account status, revoking another person's emergency grant, deciding
 * or executing retention -- answers `428 TRANSACTION_AUTHORIZATION_REQUIRED`
 * naming exactly what to confirm. The API client asks this host for a verified
 * authorization bound to that request's exact bytes, then resends it.
 *
 * Mounted once per application, so no page handles the exchange itself and a
 * newly gated route needs no page change. Cancelling the dialog rejects the
 * held request with the server's original refusal.
 */
export function TransactionAuthorizationHost() {
  const stepUp = useStepUp();
  const { authorize } = stepUp;

  useEffect(() => {
    const client = getApiClient();
    client.setTransactionAuthorizer(authorize);
    return () => client.setTransactionAuthorizer(null);
  }, [authorize]);

  return <StepUpDialog state={stepUp} />;
}
