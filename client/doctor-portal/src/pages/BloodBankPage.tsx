import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { getPatients, listBloodBank, createBloodTypeScreen, createTransfusion, useTranslation } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { Droplets, AlertTriangle, CheckCircle, FileText, Search, Plus, Activity, RefreshCw } from 'lucide-react';
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

const BloodBankPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
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
        // Combine all blood bank records into orders array
        const typeScreenItems = response.type_screens?.items || [];
        const crossmatchItems = response.crossmatches?.items || [];
        const transfusionItems = response.transfusions?.items || [];
        
        const allOrders: BloodOrder[] = [
          ...typeScreenItems.map((item) => ({ ...(item as BloodOrder), orderType: 'type_screen' as const })),
          ...crossmatchItems.map((item) => ({ ...(item as BloodOrder), orderType: 'crossmatch' as const })),
          ...transfusionItems.map((item) => ({ ...(item as BloodOrder), orderType: 'transfusion' as const })),
        ];
        setOrders(allOrders);
      }
    } catch (err) {
      console.error('Error fetching blood bank orders:', err);
      setError(t('docBloodBank.errorLoadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      orderId: `BB-${String(orders.length + 1).padStart(3, '0')}`,
      patientId: selectedPatientId,
      patientName: patient.full_name,
      bloodType: 'Unknown',
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
      const response = await createBloodTypeScreen(newOrder) as { success?: boolean; error?: string };
      if (response.success !== false) {
        setOrders([newOrder, ...orders]);
        showSuccess(t('docBloodBank.successOrderSubmitted', { orderId: newOrder.orderId }));
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

  const handleSubmitTransfusion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || !startTime || !administeredBy || !witnessedBy) {
      showError(t('docBloodBank.errorRequiredFields'));
      return;
    }

    if (!preBP || !preHR || !preTemp || !preRR) {
      showError(t('docBloodBank.errorPreVitalsRequired'));
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
        setOrders(orders.map(o => o.orderId === selectedOrder.orderId ? updatedOrder : o));
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
      ordered: 'bg-blue-100 text-blue-800',
      'type-screen': 'bg-purple-100 text-purple-800',
      crossmatch: 'bg-yellow-100 text-yellow-800',
      ready: 'bg-green-100 text-green-800',
      issued: 'bg-cyan-100 text-cyan-800',
      transfusing: 'bg-indigo-100 text-indigo-800',
      completed: 'bg-gray-100 text-gray-800',
      cancelled: 'bg-red-100 text-red-800'
    };
    return styles[status] || 'bg-gray-100 text-gray-800';
  };

  const getPriorityBadge = (priority: string) => {
    const styles: Record<string, string> = {
      emergency: 'bg-red-600 text-white',
      urgent: 'bg-orange-500 text-white',
      routine: 'bg-gray-500 text-white'
    };
    return styles[priority] || 'bg-gray-500 text-white';
  };

  return (
    <div className="p-6">
      {/* Header with gradient */}
      <div className="bg-gradient-to-r from-red-600 to-pink-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Droplets className="h-8 w-8" />
            <div>
              <h1 className="text-3xl font-bold">{t('docBloodBank.title')}</h1>
              <p className="text-red-100">{t('docBloodBank.subtitle')}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-red-100">{t('docBloodBank.loggedInAs')}</p>
            <p className="font-semibold">{user?.userId || 'Unknown'}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'orders'
              ? 'text-red-600 border-b-2 border-red-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="inline h-4 w-4 mr-2" />
          {t('docBloodBank.tabOrders')}
        </button>
        <button
          onClick={() => setActiveTab('newOrder')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'newOrder'
              ? 'text-red-600 border-b-2 border-red-600'
              : 'text-gray-500 hover:text-gray-700'
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
                ? 'text-red-600 border-b-2 border-red-600'
                : 'text-gray-500 hover:text-gray-700'
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
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="bloodbank-search" className="block text-sm font-medium text-gray-700 mb-1">
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
                <label htmlFor="bloodbank-status-filter" className="block text-sm font-medium text-gray-700 mb-1">{t('docBloodBank.statusLabel')}</label>
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
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docBloodBank.colPriority')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docBloodBank.colOrderId')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docBloodBank.colPatient')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docBloodBank.colBloodType')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docBloodBank.colProductUnits')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docBloodBank.colIndication')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docBloodBank.colStatus')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docBloodBank.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredOrders.map((order) => (
                    <tr
                      key={order.orderId}
                      className={`${order.priority === 'emergency' ? 'bg-red-50' : ''} hover:bg-gray-50`}
                    >
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getPriorityBadge(order.priority)}`}>
                          {t(`docBloodBank.priority_${order.priority}`).toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{order.orderId}</div>
                        <div className="text-xs text-gray-500">{order.orderDate} {order.orderTime}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{order.patientName}</div>
                        <div className="text-xs text-gray-500">{order.patientId}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-bold text-red-700">{order.bloodType}</div>
                        {order.typeScreen?.antibodyScreen === 'positive' && (
                          <div className="text-xs text-red-600 flex items-center">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {t('docBloodBank.abPositive')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{order.product}</div>
                        <div className="text-xs text-gray-500">{order.units > 1 ? t('docBloodBank.unitCountPlural', { count: order.units }) : t('docBloodBank.unitCountSingular', { count: order.units })}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{order.indication}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getStatusBadge(order.status)}`}>
                          {t(`docBloodBank.status_${order.status}`)}
                        </span>
                        {order.crossmatch && !order.crossmatch.compatible && (
                          <div className="text-xs text-red-600 mt-1 flex items-center">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {t('docBloodBank.incompatible')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {(order.status === 'ready' || order.status === 'issued' || order.status === 'transfusing') && (
                          <button
                            onClick={() => handleOpenTransfusion(order)}
                            className="text-red-600 hover:text-red-800 text-sm font-medium flex items-center"
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
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">{t('docBloodBank.newOrderTitle')}</h2>
          <form onSubmit={handleSubmitOrder}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Patient Selection */}
              <div>
                <label htmlFor="bloodbank-patient" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docBloodBank.patientLabel')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="bloodbank-patient"
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="">{t('docBloodBank.selectPatientPh')}</option>
                  {patients.map((patient) => (
                    <option key={patient.patient_id} value={patient.patient_id}>
                      {patient.full_name} ({patient.patient_id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Product */}
              <div>
                <label htmlFor="bloodbank-product" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docBloodBank.bloodProductLabel')} <span className="text-red-500">*</span>
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
                <label htmlFor="bloodbank-units" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docBloodBank.unitsLabel')} <span className="text-red-500">*</span>
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
                <label htmlFor="bloodbank-priority" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docBloodBank.priorityLabel')} <span className="text-red-500">*</span>
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
                <label htmlFor="bloodbank-indication" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docBloodBank.indicationLabel')} <span className="text-red-500">*</span>
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
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-2">{t('docBloodBank.workflowTitle')}</h3>
              <ol className="text-sm text-blue-800 space-y-1">
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
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                {t('docBloodBank.cancelBtn')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center"
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
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">{t('docBloodBank.transfusionRecordTitle')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-700">{t('docBloodBank.lblOrderId')}</span>
                <p className="text-gray-900">{selectedOrder.orderId}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">{t('docBloodBank.lblPatient')}</span>
                <p className="text-gray-900">{selectedOrder.patientName}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">{t('docBloodBank.lblBloodType')}</span>
                <p className="text-red-700 font-bold">{selectedOrder.bloodType}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">{t('docBloodBank.lblProduct')}</span>
                <p className="text-gray-900">{selectedOrder.product} ({selectedOrder.units > 1 ? t('docBloodBank.unitCountPlural', { count: selectedOrder.units }) : t('docBloodBank.unitCountSingular', { count: selectedOrder.units })})</p>
              </div>
              {selectedOrder.releaseInfo && (
                <>
                  <div className="md:col-span-2">
                    <span className="font-medium text-gray-700">{t('docBloodBank.lblUnitNumbers')}</span>
                    <p className="text-gray-900">{selectedOrder.releaseInfo.unitNumbers.join(', ')}</p>
                  </div>
                  <div className="md:col-span-2">
                    <span className="font-medium text-gray-700">{t('docBloodBank.lblExpiryDates')}</span>
                    <p className="text-gray-900">{selectedOrder.releaseInfo.expiryDates.join(', ')}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Transfusion Form */}
          <form onSubmit={handleSubmitTransfusion}>
            {/* Pre-Transfusion Vitals */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-bold mb-3">{t('docBloodBank.preVitalsTitle')}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="bloodbank-pre-bp" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('docBloodBank.bpLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="bloodbank-pre-bp"
                    type="text"
                    value={preBP}
                    onChange={(e) => setPreBP(e.target.value)}
                    placeholder="120/80"
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bloodbank-pre-hr" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('docBloodBank.hrLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="bloodbank-pre-hr"
                    type="number"
                    value={preHR}
                    onChange={(e) => setPreHR(e.target.value)}
                    placeholder={t('docBloodBank.bpmPh')}
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bloodbank-pre-temp" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('docBloodBank.tempLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="bloodbank-pre-temp"
                    type="number"
                    step="0.1"
                    value={preTemp}
                    onChange={(e) => setPreTemp(e.target.value)}
                    placeholder={t('docBloodBank.celsiusPh')}
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bloodbank-pre-rr" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('docBloodBank.rrLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="bloodbank-pre-rr"
                    type="number"
                    value={preRR}
                    onChange={(e) => setPreRR(e.target.value)}
                    placeholder={t('docBloodBank.breathsPh')}
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Transfusion Times */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-bold mb-3">{t('docBloodBank.timesTitle')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="bloodbank-start-time" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('docBloodBank.startTimeLabel')} <span className="text-red-500">*</span>
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
                  <label htmlFor="bloodbank-end-time" className="block text-sm font-medium text-gray-700 mb-1">{t('docBloodBank.endTimeLabel')}</label>
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
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-bold mb-3">{t('docBloodBank.staffTitle')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="bloodbank-administered-by" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('docBloodBank.administeredByLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="bloodbank-administered-by"
                    type="text"
                    value={administeredBy}
                    onChange={(e) => setAdministeredBy(e.target.value)}
                    placeholder={t('docBloodBank.administeredByPh')}
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bloodbank-witnessed-by" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('docBloodBank.witnessedByLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="bloodbank-witnessed-by"
                    type="text"
                    value={witnessedBy}
                    onChange={(e) => setWitnessedBy(e.target.value)}
                    placeholder={t('docBloodBank.witnessedByPh')}
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {t('docBloodBank.twoNurseNote')}
              </p>
            </div>

            {/* Post-Transfusion Vitals (if ended) */}
            {endTime && (
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h3 className="text-lg font-bold mb-3">{t('docBloodBank.postVitalsTitle')}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label htmlFor="bloodbank-post-bp" className="block text-sm font-medium text-gray-700 mb-1">{t('docBloodBank.bpLabel')}</label>
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
                    <label htmlFor="bloodbank-post-hr" className="block text-sm font-medium text-gray-700 mb-1">{t('docBloodBank.hrLabel')}</label>
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
                    <label htmlFor="bloodbank-post-temp" className="block text-sm font-medium text-gray-700 mb-1">{t('docBloodBank.tempLabel')}</label>
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
                    <label htmlFor="bloodbank-post-rr" className="block text-sm font-medium text-gray-700 mb-1">{t('docBloodBank.rrLabel')}</label>
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
            <div className="bg-white rounded-lg shadow p-6 mb-6">
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
                <div className="mt-4 bg-red-50 border border-red-200 rounded p-3">
                  <p className="text-sm text-red-800 font-medium flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    {t('docBloodBank.reactionWarning')}
                  </p>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <label htmlFor="bloodbank-transfusion-notes" className="block text-sm font-medium text-gray-700 mb-2">{t('docBloodBank.notesLabel')}</label>
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
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                {t('docBloodBank.cancelBtn')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center"
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
