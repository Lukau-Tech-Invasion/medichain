/**
 * Pharmacist Dashboard Page
 * 
 * Pharmacist-specific dashboard with drug interactions, prescription queue,
 * allergy alerts, controlled substances, and IV admixtures
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pill,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Clock,
  ShieldAlert,
  FileCheck,
  Beaker,
  BarChart3,
} from 'lucide-react';
import {
  getPharmacistDashboard,
  useTranslation,
  receivePrescription,
  startPrescriptionFill,
  dispensePrescription,
  requestPrescriptionVerification,
  decidePrescriptionVerification,
  revokePrescriptionVerification,
  getPatientPharmacyDecisions,
  getDispenseEvents,
  reverseDispense,
  getApiErrorCode,
  getApiErrorMessage,
  recordPharmacyDecision,
  controlledSubstanceReport,
  promptDialog,
  formatTimestamp,
} from '@medichain/shared';

interface SecondaryVerification {
  required: boolean;
  status: 'NotRequired' | 'Required' | 'Pending' | 'Verified' | 'Rejected' | 'Expired' | 'Revoked';
  first_pharmacist_id?: string | null;
  requested_by?: string | null;
  verified_by?: string | null;
}
import type { PharmacyDecision } from '@medichain/shared';
import {
  StatCard,
  CriticalAlertsBanner,
  QuickActionsPanel,
  type CriticalAlert,
  type QuickAction,
} from '../components/dashboard';

interface Prescription {
  prescription_id: string;
  patient_id: string;
  patient_name?: string;
  medication_name: string;
  dosage: string;
  frequency?: string;
  priority?: 'STAT' | 'Urgent' | 'Routine';
  status: string;
  prescribed_quantity?: number;
  dispensed_quantity?: number;
  prescribed_by?: string;
  created_at?: string;
  secondary_verification?: SecondaryVerification;
}

interface DispenseEvent {
  dispense_event_id: string;
  quantity: number;
  pharmacist_id?: string;
  reversed?: boolean;
  correction?: boolean;
  reverses_event_id?: string;
  reason?: string;
}

interface DrugInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: 'Major' | 'Moderate' | 'Minor';
  description: string;
  patient_name?: string;
  patient_id?: string;
}

interface AllergyAlert {
  id: string;
  patient_id: string;
  patient_name?: string;
  allergen: string;
  /** The reaction recorded on the patient's allergy list, when known. */
  reaction?: string | null;
  severity: string;
}

interface PharmacistDashboardData {
  role: string;
  pharmacist_id?: string;
  prescriptions: {
    pending_fill: number;
    in_progress: number;
    completed_today: number;
    list: Prescription[];
  };
  drug_interactions: DrugInteraction[];
  allergy_alerts: AllergyAlert[];
  alerts: {
    pending_rx_count: number;
    interactions_count: number;
    allergy_alerts_count: number;
  };
}

export default function PharmacistDashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<PharmacistDashboardData | null>(null);
  // A pharmacist's decision on an allergy alert needs a reason: a refusal
  // nobody can account for is not a clinical decision, and the prescriber and
  // the patient both have to be able to find out why a medicine did not come.
  const [decisionFor, setDecisionFor] = useState<
    { alert: AllergyAlert; decision: 'refused_to_dispense' | 'prescriber_queried' } | null
  >(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [reportNotice, setReportNotice] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  // What was already decided about each alert. The alerts are derived from the
  // patients' allergy lists and so reappear on every load; without this a
  // pharmacist could not tell an alert already dealt with from a new one.
  const [decisionsOnFile, setDecisionsOnFile] = useState<Record<string, PharmacyDecision>>({});
  const loadDecisionsFor = async (alerts: AllergyAlert[]) => {
    const patientIds = [...new Set(alerts.map((a) => a.patient_id))];
    const results = await Promise.allSettled(patientIds.map((id) => getPatientPharmacyDecisions(id)));
    const latest: Record<string, PharmacyDecision> = {};
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const decision of result.value.decisions ?? []) {
        const key = `${decision.patient_id}|${decision.allergen.toLowerCase()}`;
        if (!latest[key] || latest[key].decided_at < decision.decided_at) latest[key] = decision;
      }
    }
    setDecisionsOnFile(latest);
  };

  /** Send the pharmacist's decision, with the reason they gave. */
  const submitDecision = async () => {
    if (!decisionFor) return;
    if (!decisionReason.trim()) {
      setDecisionError(t('docPharmDashboard.decisionReasonRequired'));
      return;
    }
    setDecisionBusy(true);
    setDecisionError('');
    try {
      await recordPharmacyDecision({
        patientId: decisionFor.alert.patient_id,
        allergen: decisionFor.alert.allergen,
        decision: decisionFor.decision,
        reason: decisionReason.trim(),
      });
      void loadDecisionsFor(data?.allergy_alerts ?? []);
      setDecisionFor(null);
      setDecisionReason('');
      await loadDashboard();
    } catch (err) {
      setDecisionError(getApiErrorMessage(err, t('docPharmDashboard.decisionFailed')));
    } finally {
      setDecisionBusy(false);
    }
  };

  /**
   * Produce the controlled-substance register as a file.
   *
   * The link had no endpoint, so the register could be read on screen and
   * never produced as the document a regulator asks for. CSV rather than a
   * rendered PDF: it is what an inspector imports, and the rows are the
   * evidence.
   */
  const downloadControlledSubstanceReport = async () => {
    setReportNotice('');
    try {
      const report = await controlledSubstanceReport();
      const columns = [
        'dispense_id',
        'prescription_id',
        'patient_id',
        'medication',
        'quantity',
        'dispensed_by',
        'dispensed_at',
        'status',
      ];
      const escape = (value: unknown) =>
        `"${String(value ?? '').replace(/"/g, '""')}"`;
      const csv = [
        columns.join(','),
        ...report.events.map((row) =>
          columns.map((column) => escape((row as Record<string, unknown>)[column])).join(',')
        ),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `controlled-substances-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setReportNotice(
        t('docPharmDashboard.reportReady', { count: report.count })
      );
    } catch (err) {
      setReportNotice(getApiErrorMessage(err, t('docPharmDashboard.reportFailed')));
    }
  };

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const response = await getPharmacistDashboard();
      const dashboard = response as unknown as PharmacistDashboardData;
      setData(dashboard);
      void loadDecisionsFor(dashboard.allergy_alerts ?? []);
    } catch (error) {
      console.error('Failed to load pharmacist dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  // Map drug interaction alerts for the critical banner
  const criticalAlerts: CriticalAlert[] = [
    // Drug interactions (major = critical)
    ...(data?.drug_interactions?.filter(d => d.severity === 'Major').map((d): CriticalAlert => ({
      id: d.id,
      type: 'drug_interaction',
      title: t('docPharmDashboard.drugInteractionTitle', { drug1: d.drug1, drug2: d.drug2 }),
      description: d.description,
      patient_name: d.patient_name || t('docPharmDashboard.unknown'),
      timestamp: new Date().toISOString(),
      severity: 'critical',
    })) || []),
    // Allergy alerts
    ...(data?.allergy_alerts?.map((a): CriticalAlert => ({
      id: a.id,
      type: 'allergy',
      title: t('docPharmDashboard.allergyAlertTitle', { allergen: a.allergen }),
      description: a.reaction
        ? t('docPharmDashboard.allergyReaction', { reaction: a.reaction, severity: a.severity })
        : t('docPharmDashboard.allergyOnRecord', { severity: a.severity }),
      patient_name: a.patient_name || t('docPharmDashboard.unknown'),
      timestamp: new Date().toISOString(),
      severity: 'high',
    })) || []),
  ];

  // Quick actions for pharmacists
  const quickActions: QuickAction[] = [
    { id: 'verify', label: t('docPharmDashboard.qaVerify'), icon: FileCheck, href: '/e-prescribe', color: 'green' },
    { id: 'interactions', label: t('docPharmDashboard.qaInteractions'), icon: ShieldAlert, href: '/drug-interactions', color: 'emergency' },
    { id: 'dispense', label: t('docPharmDashboard.qaDispense'), icon: Pill, href: '/medication-admin', color: 'blue' },
    { id: 'iv-prep', label: t('docPharmDashboard.qaIv'), icon: Beaker, href: '/orders', color: 'purple' },
  ];

  const severityLabel = (severity: 'Major' | 'Moderate' | 'Minor'): string => {
    switch (severity) {
      case 'Major': return t('docPharmDashboard.sevMajor');
      case 'Moderate': return t('docPharmDashboard.sevModerate');
      case 'Minor': return t('docPharmDashboard.sevMinor');
    }
  };

  // Prepare prescription queue table data
  /** Which prescription has an action in flight, so its buttons disable. */
  const [busyRx, setBusyRx] = useState<string | null>(null);
  const [rxResult, setRxResult] = useState<Record<string, string>>({});
  const [dispenseHistory, setDispenseHistory] = useState<Record<string, DispenseEvent[]>>({});

  /**
   * Drive one pharmacy transition.
   *
   * Every outcome is reported. A conflict is the ordinary case rather than a
   * fault -- a colleague received or filled it first -- and saying so is more
   * useful than a generic failure. Nothing here reports success the API did not
   * confirm: `loadDashboard` reloads the queue so the row's state comes from the
   * server, not from what this component hoped happened.
   */
  const handlePharmacyAction = async (
    prescriptionId: string,
    action: 'receive' | 'start' | 'dispense' | 'requestVerification' | 'approve' | 'reject' | 'revoke'
  ) => {
    let quantity = 0;
    let rejectionReason: string | undefined;
    if (action === 'dispense') {
      const entered = await promptDialog({
        message: t('docPharmDashboard.dispenseQuantityPrompt'),
        inputType: 'number',
        required: true,
      });
      if (entered === null) return;
      quantity = Number.parseInt(entered, 10);
      // Refused here rather than sent: the API would reject it, and a refusal
      // the pharmacist did not ask for reads like a broken button.
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setRxResult((p) => ({ ...p, [prescriptionId]: t('docPharmDashboard.quantityInvalid') }));
        return;
      }
    }
    if (action === 'reject' || action === 'revoke') {
      const entered = await promptDialog({
        message: t(action === 'reject' ? 'docPharmDashboard.rejectionReasonPrompt' : 'docPharmDashboard.revokeReasonPrompt'),
        required: true,
      });
      if (entered === null) return;
      rejectionReason = entered.trim();
      if (!rejectionReason) {
        setRxResult((p) => ({ ...p, [prescriptionId]: t('docPharmDashboard.reasonRequired') }));
        return;
      }
    }

    setBusyRx(prescriptionId);
    setRxResult((p) => ({ ...p, [prescriptionId]: '' }));
    try {
      let message: string;
      if (action === 'receive') {
        await receivePrescription(prescriptionId);
        message = t('docPharmDashboard.received');
      } else if (action === 'start') {
        await startPrescriptionFill(prescriptionId);
        message = t('docPharmDashboard.fillStarted');
      } else if (action === 'requestVerification') {
        await requestPrescriptionVerification(prescriptionId);
        message = t('docPharmDashboard.verificationRequested');
      } else if (action === 'revoke') {
        await revokePrescriptionVerification(prescriptionId, rejectionReason ?? '');
        message = t('docPharmDashboard.verificationRevoked');
      } else if (action === 'approve' || action === 'reject') {
        await decidePrescriptionVerification(
          prescriptionId,
          action === 'approve',
          rejectionReason
        );
        message = action === 'approve'
          ? t('docPharmDashboard.verificationApproved')
          : t('docPharmDashboard.verificationRejected');
      } else {
        const result = await dispensePrescription(prescriptionId, quantity);
        // `remaining` is optional on the response type; treat an absent value
        // as nothing owed rather than interpolating `undefined` into a message
        // a pharmacist has to act on.
        const remaining = result.remaining ?? 0;
        message =
          remaining > 0
            ? t('docPharmDashboard.partiallyFilled', { remaining })
            : t('docPharmDashboard.fullyDispensed');
      }
      setRxResult((p) => ({ ...p, [prescriptionId]: message }));
      await loadDashboard();
    } catch (error) {
      const code = getApiErrorCode(error);
      const friendly =
        code === 'DISPENSE_RACE_DETECTED'
          ? t('docPharmDashboard.raceDetected')
          : code === 'QUANTITY_EXCEEDS_REMAINING'
            ? t('docPharmDashboard.exceedsRemaining')
            : code === 'PRESCRIPTION_NOT_IN_EXPECTED_STATE' ||
                code === 'PRESCRIPTION_NOT_DISPENSABLE'
              ? t('docPharmDashboard.stateChanged')
              : (error instanceof Error ? error.message : t('docPharmDashboard.actionFailed'));
      setRxResult((p) => ({ ...p, [prescriptionId]: friendly }));
      // The row's state is no longer trustworthy after a conflict; reload it.
      await loadDashboard();
    } finally {
      setBusyRx(null);
    }
  };

  /** Load the append-only dispense and correction trail for one prescription. */
  const loadDispenseHistory = async (prescriptionId: string) => {
    setBusyRx(prescriptionId);
    try {
      const response = await getDispenseEvents(prescriptionId);
      setDispenseHistory((previous) => ({
        ...previous,
        [prescriptionId]: response.dispense_events as unknown as DispenseEvent[],
      }));
    } catch (error) {
      setRxResult((previous) => ({
        ...previous,
        [prescriptionId]: error instanceof Error ? error.message : t('docPharmDashboard.historyFailed'),
      }));
    } finally {
      setBusyRx(null);
    }
  };

  /** Reverse one event while retaining both the original and its correction. */
  const handleReverse = async (prescriptionId: string, eventId: string) => {
    const entered = await promptDialog({ message: t('docPharmDashboard.reversalReasonPrompt'), required: true });
    if (entered === null) return;
    const reason = entered.trim();
    if (!reason) {
      setRxResult((previous) => ({ ...previous, [prescriptionId]: t('docPharmDashboard.reasonRequired') }));
      return;
    }
    setBusyRx(prescriptionId);
    try {
      await reverseDispense(prescriptionId, eventId, reason);
      setRxResult((previous) => ({ ...previous, [prescriptionId]: t('docPharmDashboard.reversed') }));
      await Promise.all([loadDashboard(), loadDispenseHistory(prescriptionId)]);
    } catch (error) {
      setRxResult((previous) => ({
        ...previous,
        [prescriptionId]: error instanceof Error ? error.message : t('docPharmDashboard.actionFailed'),
      }));
    } finally {
      setBusyRx(null);
    }
  };

  // The rows carry the prescription itself, not a flattened array of strings:
  // the action column has to know the id and the current state.
  const prescriptionQueue = data?.prescriptions?.list?.slice(0, 10) || [];

  return (
    <div className="p-6 space-y-6 bg-surface-sunken min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-content">{t('docPharmDashboard.title')}</h1>
        <p className="text-sm text-content-muted mt-1">{t('docPharmDashboard.subtitle')}</p>
      </div>

      {/* Critical Alerts: Drug Interactions & Allergy Alerts */}
      <CriticalAlertsBanner
        alerts={criticalAlerts}
        onViewAll={() => navigate('/drug-interactions')}
      />

      {/* Stat Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('docPharmDashboard.statPendingRx')}
          value={data?.prescriptions?.pending_fill || 0}
          icon={<Pill className="text-caution-subtle-fg" size={24} />}
          color="bg-caution-subtle"
          onClick={() => navigate('/e-prescribe')}
          loading={loading}
        />
        <StatCard
          label={t('docPharmDashboard.statStatOrders')}
          value={data?.prescriptions?.list?.filter(rx => rx.priority === 'STAT').length || 0}
          icon={<AlertTriangle className="text-critical-subtle-fg" size={24} />}
          color="bg-critical-subtle"
          onClick={() => navigate('/e-prescribe?priority=STAT')}
          loading={loading}
        />
        <StatCard
          label={t('docPharmDashboard.statVerifiedToday')}
          value={data?.prescriptions?.completed_today || 0}
          icon={<CheckCircle className="text-ok-subtle-fg" size={24} />}
          color="bg-ok-subtle"
          loading={loading}
        />
        <StatCard
          label={t('docPharmDashboard.statInteractions')}
          value={data?.drug_interactions?.length || 0}
          icon={<ShieldAlert className="text-critical-subtle-fg" size={24} />}
          color="bg-critical-subtle"
          onClick={() => navigate('/drug-interactions')}
          loading={loading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Prescription Verification Queue */}
        <div className="bg-surface rounded-lg shadow p-4 border border-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-content-secondary min-h-[24px] py-1">
              <FileCheck size={16} aria-hidden="true" /> {t('docPharmDashboard.ordersToVerify')}
            </h3>
            <button
              onClick={() => navigate('/e-prescribe')}
              className="inline-flex items-center min-h-[24px] py-1 text-xs text-notice-subtle-fg hover:text-notice-subtle-fg"
            >
              {t('docPharmDashboard.viewAll')}
            </button>
          </div>
          {prescriptionQueue.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-sunken">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colPriority')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colPatient')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colMedication')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colDose')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colStatus')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colAction')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {prescriptionQueue.map((rx) => (
                    <tr key={rx.prescription_id} className="hover:bg-surface-sunken">
                      <td className="px-3 py-2 text-content">{rx.priority || t('docPharmDashboard.routine')}</td>
                      <td className="px-3 py-2 text-content-muted">{rx.patient_name || rx.patient_id || t('docPharmDashboard.noPatientRecorded')}</td>
                      <td className="px-3 py-2 font-medium text-content">{rx.medication_name}</td>
                      <td className="px-3 py-2 text-content-muted">{rx.dosage}</td>
                      <td className="px-3 py-2 text-content-muted">
                        <span>{rx.status}</span>
                        {(rx.prescribed_quantity ?? 0) > 0 && (
                          <span className="block text-xs">
                            {t('docPharmDashboard.quantityProgress', {
                              dispensed: rx.dispensed_quantity ?? 0,
                              prescribed: rx.prescribed_quantity ?? 0,
                            })}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {/*
                          The action offered is the one the prescription's state
                          actually permits. Showing every button and letting the
                          API refuse would train a pharmacist to expect refusals,
                          and a queue whose buttons do nothing is what this panel
                          was before the pharmacy endpoints existed.
                        */}
                        <div className="flex flex-wrap items-center gap-2">
                          {rx.status === 'Transmitted' && (
                            <button
                              type="button"
                              onClick={() => void handlePharmacyAction(rx.prescription_id, 'receive')}
                              disabled={busyRx === rx.prescription_id}
                              className="inline-flex items-center min-h-[24px] py-1 text-xs font-medium underline text-notice-subtle-fg disabled:no-underline disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed"
                            >
                              {t('docPharmDashboard.receive')}
                            </button>
                          )}
                          {rx.status === 'Received' && (
                            <button
                              type="button"
                              onClick={() => void handlePharmacyAction(rx.prescription_id, 'start')}
                              disabled={busyRx === rx.prescription_id}
                              className="inline-flex items-center min-h-[24px] py-1 text-xs font-medium underline text-notice-subtle-fg disabled:no-underline disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed"
                            >
                              {t('docPharmDashboard.startFill')}
                            </button>
                          )}
                          {(rx.status === 'InProgress' || rx.status === 'PartialFill') && (
                            rx.secondary_verification?.required &&
                            rx.secondary_verification.status !== 'Verified' ? null :
                            <button
                              type="button"
                              onClick={() => void handlePharmacyAction(rx.prescription_id, 'dispense')}
                              disabled={busyRx === rx.prescription_id}
                              className="inline-flex items-center min-h-[24px] py-1 text-xs font-medium underline text-notice-subtle-fg disabled:no-underline disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed"
                            >
                              {t('docPharmDashboard.dispense')}
                            </button>
                          )}
                          {rx.secondary_verification?.required &&
                            ['Required', 'Rejected', 'Expired', 'Revoked'].includes(rx.secondary_verification.status) &&
                            rx.secondary_verification.first_pharmacist_id === data?.pharmacist_id && (
                            <button
                              type="button"
                              onClick={() => void handlePharmacyAction(rx.prescription_id, 'requestVerification')}
                              disabled={busyRx === rx.prescription_id}
                              className="inline-flex items-center min-h-[24px] py-1 text-xs font-medium underline text-notice-subtle-fg disabled:no-underline disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
                            >
                              {t('docPharmDashboard.requestVerification')}
                            </button>
                          )}
                          {rx.secondary_verification?.required &&
                            rx.secondary_verification.status === 'Pending' &&
                            rx.secondary_verification.first_pharmacist_id !== data?.pharmacist_id &&
                            rx.secondary_verification.requested_by !== data?.pharmacist_id && (
                            <>
                              <button type="button" onClick={() => void handlePharmacyAction(rx.prescription_id, 'approve')} disabled={busyRx === rx.prescription_id} className="inline-flex items-center min-h-[24px] py-1 text-xs font-medium underline text-ok-subtle-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100">
                                {t('docPharmDashboard.approveVerification')}
                              </button>
                              <button type="button" onClick={() => void handlePharmacyAction(rx.prescription_id, 'reject')} disabled={busyRx === rx.prescription_id} className="inline-flex items-center min-h-[24px] py-1 text-xs font-medium underline text-critical-subtle-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100">
                                {t('docPharmDashboard.rejectVerification')}
                              </button>
                            </>
                          )}
                          {/* The server lets a party to the check withdraw it while it
                              is pending or approved; the earlier decision stays on record. */}
                          {rx.secondary_verification?.required &&
                            ['Pending', 'Verified'].includes(rx.secondary_verification.status) &&
                            rx.status !== 'Dispensed' &&
                            (rx.secondary_verification.requested_by === data?.pharmacist_id ||
                              rx.secondary_verification.verified_by === data?.pharmacist_id) && (
                            <button
                              type="button"
                              onClick={() => void handlePharmacyAction(rx.prescription_id, 'revoke')}
                              disabled={busyRx === rx.prescription_id}
                              className="inline-flex items-center min-h-[24px] py-1 text-xs font-medium underline text-critical-subtle-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
                            >
                              {t('docPharmDashboard.revokeVerification')}
                            </button>
                          )}
                          {rx.status === 'Dispensed' && (
                            <span className="text-xs text-content-muted">{t('docPharmDashboard.completed')}</span>
                          )}
                          {(rx.dispensed_quantity ?? 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => void loadDispenseHistory(rx.prescription_id)}
                              disabled={busyRx === rx.prescription_id}
                              className="inline-flex items-center min-h-[24px] py-1 text-xs font-medium underline text-notice-subtle-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
                            >
                              {t('docPharmDashboard.history')}
                            </button>
                          )}
                        </div>
                        {rxResult[rx.prescription_id] && (
                          <p role="status" className="mt-1 text-xs text-content-muted">
                            {rxResult[rx.prescription_id]}
                          </p>
                        )}
                        {dispenseHistory[rx.prescription_id] && (
                          <ul aria-label={t('docPharmDashboard.historyFor', { medication: rx.medication_name })} className="mt-2 space-y-1 text-xs text-content-muted">
                            {dispenseHistory[rx.prescription_id].map((event) => (
                              <li key={event.dispense_event_id}>
                                {event.correction
                                  ? t('docPharmDashboard.correctionEntry', { quantity: event.quantity, reason: event.reason ?? '' })
                                  : t('docPharmDashboard.dispenseEntry', { quantity: event.quantity })}
                                {event.reversed && ` ${t('docPharmDashboard.reversedMarker')}`}
                                {!event.correction && !event.reversed && (
                                  <button
                                    type="button"
                                    onClick={() => void handleReverse(rx.prescription_id, event.dispense_event_id)}
                                    disabled={busyRx === rx.prescription_id}
                                    className="ml-2 font-medium underline text-critical-subtle-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
                                  >
                                    {t('docPharmDashboard.reverse')}
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-content-muted text-center py-4">{t('docPharmDashboard.noPendingRx')}</p>
          )}
        </div>

        {/* Drug Interactions Panel */}
        <div className="bg-surface rounded-lg shadow p-4 border border-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-content-secondary flex items-center gap-2 min-h-[24px] py-1">
              <ShieldAlert className="text-critical" size={18} />
              {t('docPharmDashboard.interactionAlerts')}
            </h3>
            <button
              onClick={() => navigate('/drug-interactions')}
              className="inline-flex items-center min-h-[24px] py-1 text-xs text-notice-subtle-fg hover:text-notice-subtle-fg"
            >
              {t('docPharmDashboard.viewAll')}
            </button>
          </div>
          {data?.drug_interactions && data.drug_interactions.length > 0 ? (
            <div className="space-y-2">
              {data.drug_interactions.slice(0, 5).map((interaction) => (
                <div
                  key={interaction.id}
                  className={`p-3 rounded border ${
                    interaction.severity === 'Major'
                      ? 'bg-critical-subtle border-critical'
                      : interaction.severity === 'Moderate'
                      ? 'bg-surface-sunken border-orange-200'
                      : 'bg-caution-subtle border-caution'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                          interaction.severity === 'Major'
                            ? 'bg-critical text-critical-fg'
                            : interaction.severity === 'Moderate'
                            ? 'bg-orange-600 text-critical-fg'
                            : 'bg-caution text-critical-fg'
                        }`}
                      >
                        {severityLabel(interaction.severity)}
                      </span>
                      <p className="mt-1 font-medium text-content">
                        {interaction.drug1} + {interaction.drug2}
                      </p>
                      <p className="text-sm text-content-muted">{interaction.description}</p>
                    </div>
                  </div>
                  {interaction.patient_name && (
                    <p className="mt-2 text-xs text-content-muted">
                      {t('docPharmDashboard.patientLabel', { name: interaction.patient_name })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-content-muted text-center py-4">{t('docPharmDashboard.noInteractions')}</p>
          )}
        </div>
      </div>

      {/* Second Row: Allergy Alerts & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Allergy Alerts Panel */}
        <div className="bg-surface rounded-lg shadow p-4 border border-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-content-secondary flex items-center gap-2 min-h-[24px] py-1">
              <AlertCircle className="text-caution" size={18} />
              {t('docPharmDashboard.allergyAlerts')}
            </h3>
          </div>
          {data?.allergy_alerts && data.allergy_alerts.length > 0 ? (
            <div className="space-y-2">
              {data.allergy_alerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className="p-3 bg-surface-sunken border border-orange-200 rounded"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-content">{alert.patient_name}</p>
                      <p className="flex items-center gap-1.5 text-sm text-content-secondary min-h-[24px] py-1">
                        <AlertTriangle size={14} aria-hidden="true" /> {t('docPharmDashboard.allergicTo')} <strong>{alert.allergen}</strong>
                      </p>
                      <p className="text-sm text-content-muted">
                        {alert.reaction
                          ? t('docPharmDashboard.allergyReaction', { reaction: alert.reaction, severity: alert.severity })
                          : t('docPharmDashboard.allergyOnRecord', { severity: alert.severity })}
                      </p>
                      {(() => {
                        const onFile = decisionsOnFile[`${alert.patient_id}|${alert.allergen.toLowerCase()}`];
                        return onFile ? (
                          <p className="text-xs text-content-secondary mt-1" data-testid="decision-on-file">
                            {t('docPharmDashboard.decisionOnFile', {
                              decision: t(`docPharmDashboard.decision_${onFile.decision}`),
                              reason: onFile.reason,
                              when: formatTimestamp(onFile.decided_at),
                            })}
                          </p>
                        ) : null;
                      })()}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDecisionFor({ alert, decision: 'refused_to_dispense' });
                          setDecisionReason('');
                          setDecisionError('');
                        }}
                        className="px-3 py-1 text-xs bg-critical text-critical-fg rounded hover:bg-critical/90"
                      >
                        {t('docPharmDashboard.reject')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDecisionFor({ alert, decision: 'prescriber_queried' });
                          setDecisionReason('');
                          setDecisionError('');
                        }}
                        className="px-3 py-1 text-xs bg-surface-sunken text-content-secondary rounded hover:bg-surface"
                      >
                        {t('docPharmDashboard.contactMd')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-content-muted text-center py-4">{t('docPharmDashboard.noAllergyAlerts')}</p>
          )}
        </div>

        {/* Quick Actions */}
        <QuickActionsPanel actions={quickActions} title={t('docPharmDashboard.quickActions')} />
      </div>

      {/* Controlled Substance Log Section */}
      <div className="bg-surface rounded-lg shadow p-4 border border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-content-secondary flex items-center gap-2 min-h-[24px] py-1">
            <Clock className="text-purple-500" size={18} />
            {t('docPharmDashboard.controlledLog')}
          </h3>
          <button
            type="button"
            onClick={downloadControlledSubstanceReport}
            className="inline-flex items-center min-h-[24px] py-1 text-xs text-notice-subtle-fg hover:underline"
          >
            {t('docPharmDashboard.deaReport')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-sunken">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colTime')}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colMedication')}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colPatient')}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colQty')}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colPrescriber')}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docPharmDashboard.colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* Controlled substances, filtered from the real prescription
                  list. The comment here used to say "or mock data", which was
                  stale — no mock branch exists — but a reader auditing for
                  fabricated clinical data had no way to know that without
                  tracing the code. */}
              {data?.prescriptions?.list?.filter(rx => 
                rx.medication_name.toLowerCase().includes('morphine') ||
                rx.medication_name.toLowerCase().includes('oxycodone') ||
                rx.medication_name.toLowerCase().includes('lorazepam') ||
                rx.medication_name.toLowerCase().includes('alprazolam')
              ).slice(0, 5).map((rx, idx) => (
                <tr key={rx.prescription_id || idx} className="hover:bg-surface-sunken">
                  <td className="px-4 py-2 text-content">
                    {rx.created_at ? formatTimestamp(rx.created_at, { timeStyle: 'short' }) : '--:--'}
                  </td>
                  <td className="px-4 py-2 font-medium text-content">{rx.medication_name}</td>
                  <td className="px-4 py-2 text-content-muted">{rx.patient_name || rx.patient_id || t('docPharmDashboard.noPatientRecorded')}</td>
                  <td className="px-4 py-2 text-content-muted">{rx.dosage}</td>
                  <td className="px-4 py-2 text-content-muted">{rx.prescribed_by || t('docPharmDashboard.unknown')}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      rx.status === 'Filled' ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'
                    }`}>
                      {rx.status === 'Filled' ? (
                        <span className="inline-flex items-center gap-1"><CheckCircle size={12} aria-hidden="true" /> {t('docPharmDashboard.logged')}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden="true" /> {t('docPharmDashboard.pending')}</span>
                      )}
                    </span>
                  </td>
                </tr>
              )) || (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-content-muted">
                    {t('docPharmDashboard.noControlled')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Today's Metrics */}
      <div className="bg-surface rounded-lg shadow p-4 border border-border">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-content-secondary mb-3 min-h-[24px] py-1">
          <BarChart3 size={16} aria-hidden="true" /> {t('docPharmDashboard.todaysMetrics')}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center p-3 bg-surface-sunken rounded">
            <p className="text-2xl font-bold text-content">
              {data?.prescriptions?.completed_today || 0}
            </p>
            <p className="text-xs text-content-muted">{t('docPharmDashboard.mOrdersVerified')}</p>
          </div>
          <div className="text-center p-3 bg-surface-sunken rounded">
            <p className="text-2xl font-bold text-critical-subtle-fg">
              {data?.drug_interactions?.length || 0}
            </p>
            <p className="text-xs text-content-muted">{t('docPharmDashboard.mInteractionsCaught')}</p>
          </div>
          <div className="text-center p-3 bg-surface-sunken rounded">
            <p className="text-2xl font-bold text-content-secondary">
              {data?.allergy_alerts?.length || 0}
            </p>
            <p className="text-xs text-content-muted">{t('docPharmDashboard.mAllergyAlerts')}</p>
          </div>
          <div className="text-center p-3 bg-surface-sunken rounded">
            <p className="text-2xl font-bold text-content-secondary">
              {data?.prescriptions?.list?.filter(rx => 
                rx.medication_name.toLowerCase().includes('morphine') ||
                rx.medication_name.toLowerCase().includes('oxycodone')
              ).length || 0}
            </p>
            <p className="text-xs text-content-muted">{t('docPharmDashboard.mControlledDispensed')}</p>
          </div>
          <div className="text-center p-3 bg-surface-sunken rounded">
            <p className="text-2xl font-bold text-notice-subtle-fg">
              {data?.prescriptions?.in_progress || 0}
            </p>
            <p className="text-xs text-content-muted">{t('docPharmDashboard.mInProgress')}</p>
          </div>
        </div>
      </div>

      {reportNotice && (
        <p role="status" className="mt-2 text-xs text-content-muted">
          {reportNotice}
        </p>
      )}

      {/* The reason is the point. A refusal to dispense reaches the prescriber
          and the patient, and "the pharmacist said no" is not an answer either
          of them can act on. */}
      {decisionFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold text-content">
              {decisionFor.decision === 'refused_to_dispense'
                ? t('docPharmDashboard.refuseTitle')
                : t('docPharmDashboard.queryTitle')}
            </h2>
            <p className="text-sm text-content-secondary">
              {t('docPharmDashboard.decisionContext', {
                patient: decisionFor.alert.patient_name || decisionFor.alert.patient_id,
                allergen: decisionFor.alert.allergen,
              })}
            </p>
            {decisionError && (
              <p
                role="alert"
                className="rounded-lg border border-critical-subtle-fg/20 bg-critical-subtle p-3 text-sm text-critical-subtle-fg"
              >
                {decisionError}
              </p>
            )}
            <div>
              <label
                htmlFor="pharmacy-decision-reason"
                className="block text-sm font-medium text-content-secondary mb-1"
              >
                {t('docPharmDashboard.decisionReason')}
              </label>
              <textarea
                id="pharmacy-decision-reason"
                rows={3}
                value={decisionReason}
                onChange={(e) => setDecisionReason(e.target.value)}
                className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDecisionFor(null)}
                className="flex-1 px-4 py-2 border border-border rounded-lg text-content"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={submitDecision}
                disabled={decisionBusy}
                className="flex-1 px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:bg-disabled disabled:text-disabled-fg"
              >
                {t('docPharmDashboard.decisionSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
