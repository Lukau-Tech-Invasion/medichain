import { useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getApiClient, useTranslation } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import { ChartAccessPrompt, applyAccess, declaredAccessFor } from './ChartAccess';
import type { DeclaredAccess } from './ChartAccess';

interface AccessReasonGateProps {
  /** The patient whose chart is being opened. */
  patientId: string | undefined;
  /** The chart; rendered only after access is open. */
  children: ReactNode;
}

/**
 * Asks a clinician why they are opening a patient's chart before any of the
 * patient's data is requested, and opens a server-issued access context for
 * it (WP10). The server checks the clinician's authority first; without a
 * care relationship the prompt offers break-glass.
 *
 * Every read of the chart then cites the context, and the patient's "Who
 * viewed my records" page shows the reason. The chart's children are not
 * mounted until the context is open, so no read can go out unexplained. The
 * context is cleared when the chart closes, so another patient's reads can
 * never inherit it.
 */
export function AccessReasonGate({ patientId, children }: AccessReasonGateProps) {
  const { t } = useTranslation();
  const [access, setAccess] = useState<DeclaredAccess | undefined>(() => declaredAccessFor(patientId));

  useEffect(() => {
    setAccess(declaredAccessFor(patientId));
  }, [patientId]);

  useLayoutEffect(() => {
    if (!patientId || !access) return undefined;
    applyAccess(patientId, access);
    return () => getApiClient().setPatientAccessContext(undefined);
  }, [patientId, access]);

  if (!patientId || access) {
    return <>{children}</>;
  }
  return <ChartAccessPrompt patientId={patientId} title={t('accessReason.title')} onReady={setAccess} />;
}

/**
 * Initialise directory audit context without interrupting portal navigation.
 * This labels the actual directory operation, not a clinician-declared reason
 * for accessing a chart. Selecting a patient still opens ChartAccessPrompt.
 * Children wait until the header is installed so their first search is audited.
 */
export function DirectoryReasonGate({ children }: { children: ReactNode }) {
  const role = useAuthStore((state) => state.user?.role);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getApiClient().setDirectoryPurpose('Patient directory lookup');
    setReady(true);
    return () => getApiClient().setDirectoryPurpose(undefined);
  }, []);

  if (role === 'Paramedic' || ready) return <>{children}</>;
  return null;
}

