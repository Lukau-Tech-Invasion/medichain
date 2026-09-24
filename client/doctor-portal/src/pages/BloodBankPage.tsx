import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import {
  getPatients,
  listBloodBank,
  createBloodTypeScreen,
  createTransfusion,
  useTranslation,
  Alert,
  LoadingSpinner,
  Input,
  useValidatedForm,
  transfusionStartSchema,
} from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { Droplets, AlertTriangle, CheckCircle, FileText, Search, Plus, Activity, RefreshCw } from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import { useToastActions } from '../components/Toast';

/**
 * BloodBankPage
 * 
 * Full blood bank management system
 * - Blood product ordering (RBC, Platelets, FFP, Cryoprecipitate)
 * - Type & Screen, Cross-match workflow
 * - Transfusion reaction monitoring
 * - Pre-transfusion vital signs
 * - Blood product release tracking
 * - Compatibility testing documentation
 */

interface BloodOrder {
  orderId: string;
  patientId: string;
  patientName: string;
  bloodType: string;
  orderDate: string;
  orderTime: string;
  orderedBy: string;
  product: 'RBC' | 'Platelets' | 'FFP' | 'Cryoprecipitate' | 'Whole Blood';
  units: number;
  indication: string;
  priority: 'routine' | 'urgent' | 'emergency';
  status: 'ordered' | 'type-screen' | 'crossmatch' | 'ready' | 'issued' | 'transfusing' | 'completed' | 'cancelled';
  typeScreen?: {
    abo: string;
    rh: string;
    antibodyScreen: 'positive' | 'negative';
    antibodies?: string[];
    performedBy: string;
    performedAt: string;
  };
  crossmatch?: {
    compatible: boolean;
    method: 'immediate-spin' | 'full-crossmatch';
    unitNumbers: string[];
    performedBy: string;
    performedAt: string;
  };
  releaseInfo?: {
    releasedBy: string;
    releasedAt: string;
    unitNumbers: string[];
    expiryDates: string[];
  };
  transfusionInfo?: {
    startTime: string;
    endTime?: string;
    administeredBy: string;
    witnessedBy: string;
    preVitals: {
      bp: string;
      hr: number;
      temp: number;
      rr: number;
    };
    postVitals?: {
      bp: string;
      hr: number;
      temp: number;
      rr: number;
    };
    reactions?: string[];
    notes?: string;
  };
}

type BloodBankRecord = Record<string, unknown>;

const BLOOD_PRODUCTS = new Set<BloodOrder['product']>([
  'RBC',
  'Platelets',
  'FFP',
  'Cryoprecipitate',
  'Whole Blood',
]);

function readString(record: BloodBankRecord, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Convert persisted snake-case blood-bank records into this screen's view model. */
function toBloodOrder(
  value: unknown,
  patientNames: Map<string, string>,
): BloodOrder | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as BloodBankRecord;
  const patientId = readString(record, 'patient_id') ?? readString(record, 'patientId');
  const orderId =
    readString(record, 'order_id') ??
    readString(record, 'orderId') ??
    readString(record, 'transfusion_id');
  if (!patientId || !orderId) return null;

  const rawProduct = readString(record, 'product');
  const product = BLOOD_PRODUCTS.has(rawProduct as BloodOrder['product'])
    ? (rawProduct as BloodOrder['product'])
    : 'RBC';
  const units = typeof record.units === 'number' && Number.isFinite(record.units)
    ? record.units
    : 0;
  const rawStatus = readString(record, 'status') ?? 'ordered';
  const status = [
    'ordered', 'type-screen', 'crossmatch', 'ready', 'issued', 'transfusing', 'completed', 'cancelled',
  ].includes(rawStatus)
    ? rawStatus as BloodOrder['status']
    : 'ordered';
  const rawPriority = readString(record, 'priority') ?? 'routine';
  const priority = ['routine', 'urgent', 'emergency'].includes(rawPriority)
    ? rawPriority as BloodOrder['priority']
    : 'routine';

  return {
    orderId,
    patientId,
    // A transfusion event does not duplicate the patient name. Resolve it from
    // the already-authorized roster; falling back to the identifier is honest
    // and searchable, unlike manufacturing a name.
    patientName: readString(record, 'patient_name') ?? patientNames.get(patientId) ?? patientId,
    bloodType: readString(record, 'blood_type') ?? 'Unknown',
    orderDate: readString(record, 'order_date') ?? '',
    orderTime: readString(record, 'order_time') ?? '',
    orderedBy: readString(record, 'ordered_by') ?? readString(record, 'recorded_by') ?? '',
    product,
    units,
    indication: readString(record, 'indication') ?? '',
    priority,
    status,
  };
}

const BloodBankPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [orders, setOrders] = useState<BloodOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'newOrder' | 'transfusion'>('orders');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedOrder, setSelectedOrder] = useState<BloodOrder | null>(null);

  // New order form state
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [product, setProduct] = useState<'RBC' | 'Platelets' | 'FFP' | 'Cryoprecipitate' | 'Whole Blood'>('RBC');
  const [units, setUnits] = useState(1);
  const [indication, setIndication] = useState('');
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'emergency'>('routine');

  // Transfusion form state
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [administeredBy, setAdministeredBy] = useState('');
  const [witnessedBy, setWitnessedBy] = useState('');
  const [preBP, setPreBP] = useState('');
  const [preHR, setPreHR] = useState('');
  const [preTemp, setPreTemp] = useState('');
  const [preRR, setPreRR] = useState('');
  const [postBP, setPostBP] = useState('');
  const [postHR, setPostHR] = useState('');
  const [postTemp, setPostTemp] = useState('');
  const [postRR, setPostRR] = useState('');
  const [reactions, setReactions] = useState<string[]>([]);
  const [transfusionNotes, setTransfusionNotes] = useState('');

  const fetchBloodBankOrders = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await listBloodBank();
      if (response.success) {
        const patientNames = new Map(patients.map((patient) => [patient.patient_id, patient.full_name]));
        // The register uses persisted snake-case data while this screen uses
        // camel-case view fields. Mapping at the boundary keeps a recorded
        // transfusion visible instead of silently producing undefined table
        // cells (or crashing the search filter).
        const typeScreenItems = response.type_screens?.items || [];
        const transfusionItems = response.transfusions?.items || [];
        const allOrders = [...typeScreenItems, ...transfusionItems]
          .map((item) => toBloodOrder(item, patientNames))
          .filter((item): item is BloodOrder => item !== null);
        setOrders(allOrders);
      }
    } catch (err) {
      console.error('Error fetching blood bank orders:', err);
      setError(t('docBloodBank.errorLoadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [patients, t]);

  useEffect(() => {
    const loadPatients = async () => {
      const loadedPatients = await getPatients();
      setPatients(loadedPatients);
    };
    loadPatients();
    fetchBloodBankOrders();
  }, [user, fetchBloodBankOrders]);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !indication) {
      showError(t('docBloodBank.errorRequiredFields'));
      return;
    }

    const patient = patients.find(p => p.patient_id === selectedPatientId);
    if (!patient) return;

    const newOrder: BloodOrder = {
      // Assigned by the server, which ignores any id sent.
      orderId: '',
      patientId: selectedPatientId,
      patientName: patient.full_name,
      // The patient's blood type, which is already on file — this was
      // hardcoded 'Unknown' while `patient` sat right here holding it. Every
      // blood-product order was filed as an unknown type by a system that knew
      // it, and blood type is what the crossmatch is against.
      //
      // Still 'Unknown' when the profile genuinely has none, which is a real
      // state and the reason the order needs a type-and-screen first.
      bloodType: patient.emergency_info?.blood_type || 'Unknown',
      orderDate: new Date().toISOString().split('T')[0],
      orderTime: new Date().toTimeString().slice(0, 5),
      orderedBy: user?.userId || 'Unknown',
      product,
      units,
      indication,
      priority,
      status: 'ordered'
    };

    try {
      setIsLoading(true);
      setError(null);
      const response = await createBloodTypeScreen(newOrder) as { success?: boolean; error?: string; id?: string };
      if (response.success !== false) {
        // The server assigns the order ID and signed orderer.  Reload those
        // durable values instead of displaying the browser's provisional one.
        await fetchBloodBankOrders();
        showSuccess(t('docBloodBank.successOrderSubmitted', { orderId: response.id ?? '' }));
        setSelectedPatientId('');
        setProduct('RBC');
        setUnits(1);
        setIndication('');
        setPriority('routine');
        setActiveTab('orders');
      } else {
        setError(response.error || t('docBloodBank.errorSubmitFailed'));
      }
    } catch (err) {
      console.error('Error submitting blood bank order:', err);
      setError(t('docBloodBank.errorGenericSubmit'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenTransfusion = (order: BloodOrder) => {
    setSelectedOrder(order);
    setStartTime('');
    setEndTime('');
    setAdministeredBy(user?.userId || '');
    setWitnessedBy('');
    setPreBP('');
    setPreHR('');
    setPreTemp('');
    setPreRR('');
    setPostBP('');
    setPostHR('');
    setPostTemp('');
    setPostRR('');
    setReactions([]);
    setTransfusionNotes('');
    setActiveTab('transfusion');
  };

  // One hook for the whole transfusion form: the two-person check and the
  // baseline observations are recorded together, and two hooks would mean two
  // `errors` objects with each field bound to only one of them.
  const { errors, validate, validateField, clearField } =
    useValidatedForm(transfusionStartSchema);

  /** The check and the baseline a reaction is judged against. */
  const preTransfusionVitals = () => ({
    preBP,
    preHR,
    preTemp,
    preRR,
    startTime,
    administeredBy,
    witnessedBy,
  });

  const handleSubmitTransfusion = async (e: React.FormEvent) => {
    e.preventDefault();
    // Transfusion is a two-person check: the administering nurse and the
    // witness verify the unit against the patient independently. A record with
    // one name is a record of a check that was not performed as designed, so
    // both names are field errors rather than one shared toast.
    if (!selectedOrder) {
      showError(t('docBloodBank.errorRequiredFields'));
      return;
    }
    if (!validate(preTransfusionVitals())) {
      return;
    }

    // Was one toast for four fields. A transfusion reaction is recognised by
    // comparing observations taken during the transfusion against this
    // baseline, so which of the four is missing is precisely what the nurse
    // needs told -- and on the box, not above the form.
    if (!validate(preTransfusionVitals())) {
      return;
    }

    const updatedOrder: BloodOrder = {
      ...selectedOrder,
      status: endTime ? 'completed' : 'transfusing',
      transfusionInfo: {
        startTime,
        endTime: endTime || undefined,
        administeredBy,
        witnessedBy,
        preVitals: {
          bp: preBP,
          hr: parseInt(preHR),
          temp: parseFloat(preTemp),
          rr: parseInt(preRR)
        },
        postVitals: postBP && postHR && postTemp && postRR ? {
          bp: postBP,
          hr: parseInt(postHR),
          temp: parseFloat(postTemp),
          rr: parseInt(postRR)
        } : undefined,
        reactions: reactions.length > 0 ? reactions : undefined,
        notes: transfusionNotes || undefined
      }
    };

    try {
      setIsLoading(true);
      setError(null);
      const response = await createTransfusion(updatedOrder) as { success?: boolean; error?: string };
      if (response.success !== false) {
        // A transfusion is a separate durable event. Re-read the register so
        // the worklist reflects its server-generated event ID and audit data.
        await fetchBloodBankOrders();
        showSuccess(endTime ? t('docBloodBank.successTransfusionCompleted') : t('docBloodBank.successTransfusionStarted'));
        setActiveTab('orders');
        setSelectedOrder(null);
      } else {
        setError(response.error || t('docBloodBank.errorSaveTransfusionFailed'));
      }
    } catch (err) {
      console.error('Error saving transfusion record:', err);
      setError(t('docBloodBank.errorGenericTransfusion'));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleReaction = (reaction: string) => {
    if (reactions.includes(reaction)) {
      setReactions(reactions.filter(r => r !== reaction));
    } else {
      setReactions([...reactions, reaction]);
    }
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      order.orderId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.product.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      ordered: 'bg-notice-subtle text-notice-subtle-fg',
      'type-screen': 'bg-surface-sunken text-content-secondary',
      crossmatch: 'bg-caution-subtle text-caution-subtle-fg',
      ready: 'bg-ok-subtle text-ok-subtle-fg',
      issued: 'bg-surface-sunken text-content-secondary',
      transfusing: 'bg-surface-sunken text-content-secondary',
      completed: 'bg-surface-sunken text-content-secondary',
      cancelled: 'bg-critical-subtle text-critical-subtle-fg'
    };
    return styles[status] || 'bg-surface-sunken text-content-secondary';
  };

  const getPriorityBadge = (priority: string) => {
    const styles: Record<string, string> = {
      emergency: 'bg-critical text-critical-fg',
      urgent: 'bg-caution text-caution-fg',
      routine: 'bg-gray-500 text-white'
    };
    return styles[priority] || 'bg-gray-500 text-white';
  };

  return (
    <div className="p-6">
      {/* Header with gradient */}
      <div className="bg-gradient-to-r from-red-700 to-pink-800 text-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Droplets className="h-8 w-8" />
            <div>
              <h1 className="text-3xl font-bold">{t('docBloodBank.title')}</h1>
              <p className="text-white">{t('docBloodBank.subtitle')}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-white">{t('docBloodBank.loggedInAs')}</p>
            <p className="font-semibold">{user?.username || user?.userId}</p>
          </div>
        </div>
      </div>

      {/* The page already tracked this; it just never showed it. A failed
          save left the screen unchanged, which reads as success. */}
      {error && (
        <Alert variant="error" className="mb-6" onClose={() => setError(null)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void fetchBloodBankOrders()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 min-h-[24px] rounded-lg border border-critical text-critical-subtle-fg hover:bg-critical-subtle disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('common.refresh')}
            </button>
          </div>
        </Alert>
      )}
      {isLoading && (
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-content-muted">
          <LoadingSpinner size="sm" />
          {t('common.loading')}
        </div>
      )}

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'orders'
              ? 'text-critical-subtle-fg border-b-2 border-red-600'
              : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          <FileText className="inline h-4 w-4 mr-2" />
          {t('docBloodBank.tabOrders')}
        </button>
        <button
          onClick={() => setActiveTab('newOrder')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'newOrder'
              ? 'text-critical-subtle-fg border-b-2 border-red-600'
              : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          <Plus className="inline h-4 w-4 mr-2" />
          {t('docBloodBank.tabNewOrder')}
        </button>
        {selectedOrder && (
          <button
            onClick={() => setActiveTab('transfusion')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'transfusion'
                ? 'text-critical-subtle-fg border-b-2 border-red-600'
                : 'text-content-muted hover:text-content-secondary'
            }`}
          >
            <Activity className="inline h-4 w-4 mr-2" />
            {t('docBloodBank.tabTransfusion', { orderId: selectedOrder.orderId })}
          </button>
        )}
      </div>

      {/* Orders Tab */}
      {activeTab === 'orders' && (
        <div>
          {/* Search and Filters */}
          <div className="bg-surface rounded-lg shadow p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="bloodbank-search" className="block text-sm font-medium text-content-secondary mb-1">
                  <Search className="inline h-4 w-4 mr-1" />
                  {t('docBloodBank.searchLabel')}
                </label>
                <input
                  id="bloodbank-search"
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('docBloodBank.searchPh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              <div>
                <label htmlFor="bloodbank-status-filter" className="block text-sm font-medium text-content-secondary mb-1">{t('docBloodBank.statusLabel')}</label>
                <select
                  id="bloodbank-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="all">{t('docBloodBank.filterAllStatuses')}</option>
                  <option value="ordered">{t('docBloodBank.status_ordered')}</option>
                  <option value="type-screen">{t('docBloodBank.status_type-screen')}</option>
                  <option value="crossmatch">{t('docBloodBank.status_crossmatch')}</option>
                  <option value="ready">{t('docBloodBank.status_ready')}</option>
                  <option value="issued">{t('docBloodBank.status_issued')}</option>
                  <option value="transfusing">{t('docBloodBank.status_transfusing')}</option>
                  <option value="completed">{t('docBloodBank.status_completed')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Orders Table */}
          <div className="bg-surface rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-surface-sunken">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docBloodBank.colPriority')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docBloodBank.colOrderId')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docBloodBank.colPatient')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docBloodBank.colBloodType')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docBloodBank.colProductUnits')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docBloodBank.colIndication')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docBloodBank.colStatus')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docBloodBank.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-border">
                  {filteredOrders.map((order) => (
                    <tr
                      key={order.orderId}
                      className={`${order.priority === 'emergency' ? 'bg-critical-subtle' : ''} hover:bg-surface-sunken`}
                    >
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getPriorityBadge(order.priority)}`}>
                          {t(`docBloodBank.priority_${order.priority}`).toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-content">{order.orderId}</div>
                        <div className="text-xs text-content-muted">{order.orderDate} {order.orderTime}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-content">{order.patientName}</div>
                        <div className="text-xs text-content-muted">{order.patientId}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-bold text-critical-subtle-fg">{order.bloodType}</div>
                        {order.typeScreen?.antibodyScreen === 'positive' && (
                          <div className="text-xs text-critical-subtle-fg flex items-center">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {t('docBloodBank.abPositive')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-content">{order.product}</div>
                        <div className="text-xs text-content-muted">{order.units > 1 ? t('docBloodBank.unitCountPlural', { count: order.units }) : t('docBloodBank.unitCountSingular', { count: order.units })}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-content-muted">{order.indication}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getStatusBadge(order.status)}`}>
                          {t(`docBloodBank.status_${order.status}`)}
                        </span>
                        {order.crossmatch && !order.crossmatch.compatible && (
                          <div className="text-xs text-critical-subtle-fg mt-1 flex items-center">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {t('docBloodBank.incompatible')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {(order.status === 'ready' || order.status === 'issued' || order.status === 'transfusing') && (
                          <button
                            onClick={() => handleOpenTransfusion(order)}
                            className="text-critical-subtle-fg hover:text-critical-subtle-fg text-sm font-medium flex items-center min-h-[24px] py-1"
                          >
                            <Activity className="h-4 w-4 mr-1" />
                            {order.status === 'transfusing' ? t('docBloodBank.updateAction') : t('docBloodBank.startTransfusionBtn')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* New Order Tab */}
      {activeTab === 'newOrder' && (
        <div className="bg-surface rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">{t('docBloodBank.newOrderTitle')}</h2>
          <form onSubmit={handleSubmitOrder}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Patient Selection */}
              <div>
                <PatientSelect
                  id="bloodbank-patient"
                  label={t('docBloodBank.patientLabel')}
                  value={selectedPatientId}
                  onChange={(selectedPatientId) => setSelectedPatientId(selectedPatientId)}
                  required
                />
              </div>

              {/* Product */}
              <div>
                <label htmlFor="bloodbank-product" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docBloodBank.bloodProductLabel')} <span className="text-critical">*</span>
                </label>
                <select
                  id="bloodbank-product"
                  value={product}
                  onChange={(e) => setProduct(e.target.value as typeof product)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="RBC">{t('docBloodBank.product_RBC')}</option>
                  <option value="Platelets">{t('docBloodBank.product_Platelets')}</option>
                  <option value="FFP">{t('docBloodBank.product_FFP')}</option>
                  <option value="Cryoprecipitate">{t('docBloodBank.product_Cryoprecipitate')}</option>
                  <option value="Whole Blood">{t('docBloodBank.product_Whole Blood')}</option>
                </select>
              </div>

              {/* Units */}
              <div>
                <label htmlFor="bloodbank-units" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docBloodBank.unitsLabel')} <span className="text-critical">*</span>
                </label>
                <input
                  id="bloodbank-units"
                  type="number"
                  min="1"
                  max="10"
                  value={units}
                  onChange={(e) => setUnits(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Priority */}
              <div>
                <label htmlFor="bloodbank-priority" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docBloodBank.priorityLabel')} <span className="text-critical">*</span>
                </label>
                <select
                  id="bloodbank-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as typeof priority)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="routine">{t('docBloodBank.priority_routine')}</option>
                  <option value="urgent">{t('docBloodBank.priority_urgent')}</option>
                  <option value="emergency">{t('docBloodBank.priority_emergency')}</option>
                </select>
              </div>

              {/* Indication */}
              <div className="md:col-span-2">
                <label htmlFor="bloodbank-indication" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docBloodBank.indicationLabel')} <span className="text-critical">*</span>
                </label>
                <textarea
                  id="bloodbank-indication"
                  value={indication}
                  onChange={(e) => setIndication(e.target.value)}
                  rows={3}
                  placeholder={t('docBloodBank.indicationPh')}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>
            </div>

            {/* Information Panel */}
            <div className="mt-6 bg-notice-subtle border border-notice rounded-lg p-4">
              <h3 className="font-medium text-notice-subtle-fg mb-2">{t('docBloodBank.workflowTitle')}</h3>
              <ol className="text-sm text-notice-subtle-fg space-y-1">
                <li>{t('docBloodBank.workflow1')}</li>
                <li>{t('docBloodBank.workflow2')}</li>
                <li>{t('docBloodBank.workflow3')}</li>
                <li>{t('docBloodBank.workflow4')}</li>
                <li>{t('docBloodBank.workflow5')}</li>
              </ol>
            </div>

            {/* Submit Button */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setActiveTab('orders')}
                className="px-4 py-2 border border-border-strong rounded-md text-content-secondary hover:bg-surface-sunken"
              >
                {t('docBloodBank.cancelBtn')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-critical text-critical-fg rounded-md hover:bg-critical flex items-center"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('docBloodBank.submitOrderBtn')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Transfusion Tab */}
      {activeTab === 'transfusion' && selectedOrder && (
        <div className="space-y-6">
          {/* Order Information */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">{t('docBloodBank.transfusionRecordTitle')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium text-content-secondary">{t('docBloodBank.lblOrderId')}</span>
                <p className="text-content">{selectedOrder.orderId}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docBloodBank.lblPatient')}</span>
                <p className="text-content">{selectedOrder.patientName}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docBloodBank.lblBloodType')}</span>
                <p className="text-critical-subtle-fg font-bold">{selectedOrder.bloodType}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docBloodBank.lblProduct')}</span>
                <p className="text-content">{selectedOrder.product} ({selectedOrder.units > 1 ? t('docBloodBank.unitCountPlural', { count: selectedOrder.units }) : t('docBloodBank.unitCountSingular', { count: selectedOrder.units })})</p>
              </div>
              {selectedOrder.releaseInfo && (
                <>
                  <div className="md:col-span-2">
                    <span className="font-medium text-content-secondary">{t('docBloodBank.lblUnitNumbers')}</span>
                    <p className="text-content">{selectedOrder.releaseInfo.unitNumbers.join(', ')}</p>
                  </div>
                  <div className="md:col-span-2">
                    <span className="font-medium text-content-secondary">{t('docBloodBank.lblExpiryDates')}</span>
                    <p className="text-content">{selectedOrder.releaseInfo.expiryDates.join(', ')}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Transfusion Form */}
          <form onSubmit={handleSubmitTransfusion}>
            {/* Pre-Transfusion Vitals */}
            <div className="bg-surface rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-bold mb-3">{t('docBloodBank.preVitalsTitle')}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="bloodbank-pre-bp" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('docBloodBank.bpLabel')} <span className="text-critical">*</span>
                  </label>
                  <Input
                    type="text"
                    placeholder="120/80"
                    id="bloodbank-pre-bp"
                    value={preBP}
                    onChange={(e) => { clearField('preBP'); setPreBP(e.target.value); }}
                    onBlur={() => validateField('preBP', preTransfusionVitals())}
                    error={errors.preBP}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bloodbank-pre-hr" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('docBloodBank.hrLabel')} <span className="text-critical">*</span>
                  </label>
                  <Input
                    type="number"
                    placeholder={t('docBloodBank.bpmPh')}
                    id="bloodbank-pre-hr"
                    value={preHR}
                    onChange={(e) => { clearField('preHR'); setPreHR(e.target.value); }}
                    onBlur={() => validateField('preHR', preTransfusionVitals())}
                    error={errors.preHR}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bloodbank-pre-temp" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('docBloodBank.tempLabel')} <span className="text-critical">*</span>
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder={t('docBloodBank.celsiusPh')}
                    id="bloodbank-pre-temp"
                    value={preTemp}
                    onChange={(e) => { clearField('preTemp'); setPreTemp(e.target.value); }}
                    onBlur={() => validateField('preTemp', preTransfusionVitals())}
                    error={errors.preTemp}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bloodbank-pre-rr" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('docBloodBank.rrLabel')} <span className="text-critical">*</span>
                  </label>
                  <Input
                    type="number"
                    placeholder={t('docBloodBank.breathsPh')}
                    id="bloodbank-pre-rr"
                    value={preRR}
                    onChange={(e) => { clearField('preRR'); setPreRR(e.target.value); }}
                    onBlur={() => validateField('preRR', preTransfusionVitals())}
                    error={errors.preRR}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Transfusion Times */}
            <div className="bg-surface rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-bold mb-3">{t('docBloodBank.timesTitle')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="bloodbank-start-time" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('docBloodBank.startTimeLabel')} <span className="text-critical">*</span>
                  </label>
                  <input
                    id="bloodbank-start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bloodbank-end-time" className="block text-sm font-medium text-content-secondary mb-1">{t('docBloodBank.endTimeLabel')}</label>
                  <input
                    id="bloodbank-end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md"
                  />
                </div>
              </div>
            </div>

            {/* Staff */}
            <div className="bg-surface rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-bold mb-3">{t('docBloodBank.staffTitle')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="bloodbank-administered-by" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('docBloodBank.administeredByLabel')} <span className="text-critical">*</span>
                  </label>
                  <Input
                    type="text"
                    placeholder={t('docBloodBank.administeredByPh')}
                    id="bloodbank-administered-by"
                    value={administeredBy}
                    onChange={(e) => { clearField('administeredBy'); setAdministeredBy(e.target.value); }}
                    onBlur={() => validateField('administeredBy', preTransfusionVitals())}
                    error={errors.administeredBy}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bloodbank-witnessed-by" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('docBloodBank.witnessedByLabel')} <span className="text-critical">*</span>
                  </label>
                  <Input
                    type="text"
                    placeholder={t('docBloodBank.witnessedByPh')}
                    id="bloodbank-witnessed-by"
                    value={witnessedBy}
                    onChange={(e) => { clearField('witnessedBy'); setWitnessedBy(e.target.value); }}
                    onBlur={() => validateField('witnessedBy', preTransfusionVitals())}
                    error={errors.witnessedBy}
                    required
                  />
                </div>
              </div>
              <p className="text-xs text-content-muted mt-2">
                {t('docBloodBank.twoNurseNote')}
              </p>
            </div>

            {/* Post-Transfusion Vitals (if ended) */}
            {endTime && (
              <div className="bg-surface rounded-lg shadow p-6 mb-6">
                <h3 className="text-lg font-bold mb-3">{t('docBloodBank.postVitalsTitle')}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label htmlFor="bloodbank-post-bp" className="block text-sm font-medium text-content-secondary mb-1">{t('docBloodBank.bpLabel')}</label>
                    <input
                      id="bloodbank-post-bp"
                      type="text"
                      value={postBP}
                      onChange={(e) => setPostBP(e.target.value)}
                      placeholder="120/80"
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>
                  <div>
                    <label htmlFor="bloodbank-post-hr" className="block text-sm font-medium text-content-secondary mb-1">{t('docBloodBank.hrLabel')}</label>
                    <input
                      id="bloodbank-post-hr"
                      type="number"
                      value={postHR}
                      onChange={(e) => setPostHR(e.target.value)}
                      placeholder={t('docBloodBank.bpmPh')}
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>
                  <div>
                    <label htmlFor="bloodbank-post-temp" className="block text-sm font-medium text-content-secondary mb-1">{t('docBloodBank.tempLabel')}</label>
                    <input
                      id="bloodbank-post-temp"
                      type="number"
                      step="0.1"
                      value={postTemp}
                      onChange={(e) => setPostTemp(e.target.value)}
                      placeholder={t('docBloodBank.celsiusPh')}
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>
                  <div>
                    <label htmlFor="bloodbank-post-rr" className="block text-sm font-medium text-content-secondary mb-1">{t('docBloodBank.rrLabel')}</label>
                    <input
                      id="bloodbank-post-rr"
                      type="number"
                      value={postRR}
                      onChange={(e) => setPostRR(e.target.value)}
                      placeholder={t('docBloodBank.breathsPh')}
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Transfusion Reactions */}
            <div className="bg-surface rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-bold mb-3">{t('docBloodBank.reactionsTitle')}</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  'None',
                  'Fever',
                  'Chills/Rigors',
                  'Urticaria/Rash',
                  'Pruritus',
                  'Dyspnea',
                  'Hypotension',
                  'Tachycardia',
                  'Hemoglobinuria',
                  'Back/Flank Pain',
                  'Nausea/Vomiting',
                  'Anaphylaxis'
                ].map((reaction) => (
                  <label key={reaction} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={reactions.includes(reaction)}
                      onChange={() => toggleReaction(reaction)}
                      className="mr-2"
                    />
                    <span className="text-sm">{reaction}</span>
                  </label>
                ))}
              </div>
              {reactions.length > 0 && reactions[0] !== 'None' && (
                <div className="mt-4 bg-critical-subtle border border-critical rounded p-3">
                  <p className="text-sm text-critical-subtle-fg font-medium flex items-center min-h-[24px] py-1">
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    {t('docBloodBank.reactionWarning')}
                  </p>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="bg-surface rounded-lg shadow p-6 mb-6">
              <label htmlFor="bloodbank-transfusion-notes" className="block text-sm font-medium text-content-secondary mb-2">{t('docBloodBank.notesLabel')}</label>
              <textarea
                id="bloodbank-transfusion-notes"
                value={transfusionNotes}
                onChange={(e) => setTransfusionNotes(e.target.value)}
                rows={4}
                placeholder={t('docBloodBank.notesPh')}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            {/* Submit Buttons */}
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('orders');
                  setSelectedOrder(null);
                }}
                className="px-4 py-2 border border-border-strong rounded-md text-content-secondary hover:bg-surface-sunken"
              >
                {t('docBloodBank.cancelBtn')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-critical text-critical-fg rounded-md hover:bg-critical flex items-center"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {endTime ? t('docBloodBank.completeTransfusionBtn') : t('docBloodBank.startTransfusionBtn')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default BloodBankPage;
