import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getApiClient, useTranslation } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import { ChartAccessPrompt, ReasonPrompt, applyAccess, declaredAccessFor } from './ChartAccess';
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

  useEffect(() => {
    if (!patientId || !access) return undefined;
    applyAccess(patientId, access);
    return () => getApiClient().setPatientAccessContext(undefined);
  }, [patientId, access]);

  if (!patientId || access) {
    return <>{children}</>;
  }
  return <ChartAccessPrompt patientId={patientId} title={t('accessReason.title')} onReady={setAccess} />;
}

/** Ask once per portal session before any patient directory search is issued. */
export function DirectoryReasonGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const role = useAuthStore((state) => state.user?.role);
  const [reason, setReason] = useState<string>();

  useEffect(() => () => getApiClient().setDirectoryPurpose(undefined), []);

  if (role === 'Paramedic') return <>{children}</>;

  if (!reason) {
    return <ReasonPrompt
      title={t('accessReason.directoryTitle')}
      onDeclare={(chosen) => {
        getApiClient().setDirectoryPurpose(chosen);
        setReason(chosen);
      }}
    />;
  }
  return <>{children}</>;
}
