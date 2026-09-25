import { useState, useEffect, useCallback } from 'react';
import PatientSelect from '../components/PatientSelect';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { createOrder, listOrders, updateOrderStatus, useTranslation } from '@medichain/shared';
import { 
  ClipboardList, Plus, Clock, CheckCircle, XCircle, AlertTriangle,
  Pill, FlaskConical, Stethoscope, Activity, FileText, Loader2, Search
} from 'lucide-react';

interface PhysicianOrder {
  order_id: string;
  patient_id: string;
  patient_name?: string;
  order_type: string;
  order_details: string;
  priority: string;
  status: string;
  ordered_by: string;
  ordered_at: number;
  completed_at?: number;
  notes?: string;
}

const ORDER_TYPES = [
  { value: 'medication', label: 'Medication', icon: Pill },
  { value: 'lab', label: 'Laboratory', icon: FlaskConical },
  { value: 'imaging', label: 'Imaging', icon: Activity },
  { value: 'consult', label: 'Consult', icon: Stethoscope },
  { value: 'procedure', label: 'Procedure', icon: FileText },
];

const PRIORITIES = [
  { value: 'stat', label: 'STAT', color: 'bg-critical-subtle text-critical-subtle-fg' },
  { value: 'urgent', label: 'Urgent', color: 'bg-surface-sunken text-content-secondary' },
  { value: 'routine', label: 'Routine', color: 'bg-notice-subtle text-notice-subtle-fg' },
];

const STATUSES = [
  { value: 'pending', label: 'Pending', icon: Clock, color: 'text-caution-subtle-fg' },
  { value: 'active', label: 'In Progress', icon: Activity, color: 'text-notice-subtle-fg' },
  { value: 'completed', label: 'Completed', icon: CheckCircle, color: 'text-ok-subtle-fg' },
  { value: 'cancelled', label: 'Cancelled', icon: XCircle, color: 'text-content-muted' },
];

function OrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [orders, setOrders] = useState<PhysicianOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // New order form
  const [newOrder, setNewOrder] = useState({
    patient_id: '',
    order_type: 'medication',
    order_details: '',
    priority: 'routine',
    notes: '',
  });

  // Auth redirect
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const rows = await listOrders();
      setOrders(rows.map((order) => ({
          ...order,
          order_type: order.order_type.toLowerCase() === 'laboratory'
            ? 'lab'
            : order.order_type.toLowerCase(),
          status: order.status === 'in_progress' ? 'active' : order.status,
          ordered_by: order.ordering_provider,
          ordered_at: Date.parse(order.ordered_at) || 0,
          notes: order.notes || '',
        })));
      // A request that resolved IS the success signal. The old code also
      // required a `success` flag the response does not carry, so it reported
      // a connection failure on every load and discarded the orders with it.
      setError(null);
    } catch (err) {
      setError(t('docOrders.failFetch'));
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [t, user]);

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchOrders();
    }
  }, [isAuthenticated, user, fetchOrders]);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    try {
      const response = await createOrder({
        patient_id: newOrder.patient_id,
        category: newOrder.order_type === 'lab' ? 'Laboratory' : newOrder.order_type,
        order_text: newOrder.order_details,
        priority: newOrder.priority,
        instructions: newOrder.notes || null,
        cosign_required: false,
      });

      if (response.success) {
        await fetchOrders();
        setShowNewOrder(false);
        setNewOrder({
          patient_id: '',
          order_type: 'medication',
          order_details: '',
          priority: 'routine',
          notes: '',
        });
      } else {
        setError(t('docOrders.failCreate'));
      }
    } catch (err) {
      setError(t('docOrders.failCreateApi'));
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    if (!user) return;
    let persistedStatus: string;
    try {
      persistedStatus = (await updateOrderStatus(orderId, newStatus)).status;
    } catch {
      // The local update below used to happen regardless, with a comment
      // saying "Update locally" -- so an order the server refused to advance
      // showed as advanced, and the next person to read the board acted on a
      // status that exists only in this browser tab.
      setError(t('docOrders.failUpdateStatus'));
      return;
    }
    
    setOrders(prev => prev.map(o => 
      o.order_id === orderId 
        ? { ...o, status: persistedStatus, completed_at: persistedStatus === 'completed' ? Date.now() : undefined }
        : o
    ));
  };

  const filteredOrders = orders.filter(order => {
    if (filterStatus !== 'all' && order.status !== filterStatus) return false;
    if (filterType !== 'all' && order.order_type !== filterType) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        order.patient_id.toLowerCase().includes(query) ||
        order.patient_name?.toLowerCase().includes(query) ||
        order.order_details.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const getStatusInfo = (status: string) => {
    return STATUSES.find(s => s.value === status) || STATUSES[0];
  };

  const getPriorityInfo = (priority: string) => {
    return PRIORITIES.find(p => p.value === priority) || PRIORITIES[2];
  };

  const getTypeInfo = (type: string) => {
    return ORDER_TYPES.find(ot => ot.value === type) || ORDER_TYPES[0];
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const orderTypeLabel = (value: string): string => {
    switch (value) {
      case 'medication': return t('docOrders.typeMedication');
      case 'lab': return t('docOrders.typeLab');
      case 'imaging': return t('docOrders.typeImaging');
      case 'consult': return t('docOrders.typeConsult');
      case 'procedure': return t('docOrders.typeProcedure');
      default: return value;
    }
  };

  const priorityLabel = (value: string): string => {
    switch (value) {
      case 'stat': return t('docOrders.priStat');
      case 'urgent': return t('docOrders.priUrgent');
      case 'routine': return t('docOrders.priRoutine');
      default: return value;
    }
  };

  const statusLabel = (value: string): string => {
    switch (value) {
      case 'pending': return t('docOrders.stPending');
      case 'active': return t('docOrders.stInProgress');
      case 'in_progress': return t('docOrders.stInProgress');
      case 'completed': return t('docOrders.stCompleted');
      case 'cancelled': return t('docOrders.stCancelled');
      default: return value;
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-content">{t('docOrders.title')}</h1>
          <p className="text-content-muted mt-1">{t('docOrders.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowNewOrder(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand"
        >
          <Plus size={20} />
          {t('docOrders.newOrder')}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-surface p-4 rounded-xl shadow">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-caution-subtle rounded-lg">
              <Clock className="text-caution-subtle-fg" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{orders.filter(o => o.status === 'pending').length}</p>
              <p className="text-sm text-content-muted">{t('docOrders.statPending')}</p>
            </div>
          </div>
        </div>
        <div className="bg-surface p-4 rounded-xl shadow">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-notice-subtle rounded-lg">
              <Activity className="text-notice-subtle-fg" size={24} />
            </div>
            <div>
              <p data-testid="orders-in-progress-count" className="text-2xl font-bold">{orders.filter(o => o.status === 'active').length}</p>
              <p className="text-sm text-content-muted">{t('docOrders.statInProgress')}</p>
            </div>
          </div>
        </div>
        <div className="bg-surface p-4 rounded-xl shadow">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-critical-subtle rounded-lg">
              <AlertTriangle className="text-critical-subtle-fg" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{orders.filter(o => o.priority === 'stat').length}</p>
              <p className="text-sm text-content-muted">{t('docOrders.statStat')}</p>
            </div>
          </div>
        </div>
        <div className="bg-surface p-4 rounded-xl shadow">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-ok-subtle rounded-lg">
              <CheckCircle className="text-ok-subtle-fg" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{orders.filter(o => o.status === 'completed').length}</p>
              <p className="text-sm text-content-muted">{t('docOrders.statCompleted')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface p-4 rounded-xl shadow mb-6">
        <div className="flex gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('docOrders.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="all">{t('docOrders.allStatuses')}</option>
            {STATUSES.map(s => (
              <option key={s.value} value={s.value}>{statusLabel(s.value)}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="all">{t('docOrders.allTypes')}</option>
            {ORDER_TYPES.map(ot => (
              <option key={ot.value} value={ot.value}>{orderTypeLabel(ot.value)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-surface rounded-xl shadow">
        <div className="p-4 border-b flex items-center gap-2">
          <ClipboardList className="text-content-muted" size={20} />
          <span className="font-medium">{t('docOrders.ordersCount', { count: filteredOrders.length })}</span>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="mx-auto animate-spin text-brand" size={48} />
            <p className="text-content-muted mt-3">{t('docOrders.loading')}</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center text-critical-subtle-fg">{error}</div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center text-content-muted">{t('docOrders.noneFound')}</div>
        ) : (
          <div className="divide-y">
            {filteredOrders.map(order => {
              const statusInfo = getStatusInfo(order.status);
              const priorityInfo = getPriorityInfo(order.priority);
              const typeInfo = getTypeInfo(order.order_type);
              const TypeIcon = typeInfo.icon;
              const StatusIcon = statusInfo.icon;

              return (
                <div key={order.order_id} className="p-4 hover:bg-surface-sunken">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="p-2 bg-surface-sunken rounded-lg">
                        <TypeIcon className="text-content-muted" size={24} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{order.order_details}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityInfo.color}`}>
                            {priorityLabel(order.priority)}
                          </span>
                        </div>
                        <p className="text-sm text-content-muted mt-1">
                          {t('docOrders.patientType', { patient: order.patient_name || order.patient_id, type: orderTypeLabel(order.order_type) })}
                        </p>
                        <p className="text-xs text-content-muted mt-1">
                          {t('docOrders.orderedAt', { time: formatTime(order.ordered_at) })}
                          {order.completed_at && t('docOrders.completedAt', { time: formatTime(order.completed_at) })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`flex items-center gap-1 ${statusInfo.color}`}>
                        <StatusIcon size={16} />
                        <span className="text-sm">{statusLabel(order.status)}</span>
                      </div>
                      {order.status !== 'completed' && order.status !== 'cancelled' && (
                        <select
                          value={order.status}
                          onChange={(e) => handleUpdateStatus(order.order_id, e.target.value)}
                          className="text-sm border rounded px-2 py-1"
                        >
                          {STATUSES.map(s => (
                            <option key={s.value} value={s.value}>{statusLabel(s.value)}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Order Modal */}
      {showNewOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">{t('docOrders.createNewOrder')}</h2>
            <form onSubmit={handleCreateOrder} className="space-y-4">
              {/* Search by name, not a remembered identifier. This was a bare
                  text box asking for a patient id: nobody memorises those, so
                  the order was either abandoned or filed against a typo. */}
              <PatientSelect
                id="order-patient-id"
                label={t('docOrders.patientId')}
                value={newOrder.patient_id}
                onChange={(patientId) => setNewOrder({ ...newOrder, patient_id: patientId })}
                required
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="order-type" className="block text-sm font-medium text-content-secondary mb-1">{t('docOrders.orderType')}</label>
                  <select
                    id="order-type"
                    value={newOrder.order_type}
                    onChange={(e) => setNewOrder({ ...newOrder, order_type: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                  >
                    {ORDER_TYPES.map(ot => (
                      <option key={ot.value} value={ot.value}>{orderTypeLabel(ot.value)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="order-priority" className="block text-sm font-medium text-content-secondary mb-1">{t('docOrders.priority')}</label>
                  <select
                    id="order-priority"
                    value={newOrder.priority}
                    onChange={(e) => setNewOrder({ ...newOrder, priority: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                  >
                    {PRIORITIES.map(p => (
                      <option key={p.value} value={p.value}>{priorityLabel(p.value)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="order-details" className="block text-sm font-medium text-content-secondary mb-1">{t('docOrders.orderDetails')}</label>
                <textarea
                  id="order-details"
                  value={newOrder.order_details}
                  onChange={(e) => setNewOrder({ ...newOrder, order_details: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  rows={3}
                  placeholder={t('docOrders.orderDetailsPlaceholder')}
                  required
                />
              </div>
              <div>
                <label htmlFor="order-notes" className="block text-sm font-medium text-content-secondary mb-1">{t('docOrders.notesOptional')}</label>
                <textarea
                  id="order-notes"
                  value={newOrder.notes}
                  onChange={(e) => setNewOrder({ ...newOrder, notes: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  rows={2}
                  placeholder={t('docOrders.notesPlaceholder')}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNewOrder(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-surface-sunken"
                >
                  {t('docOrders.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand"
                >
                  {t('docOrders.createOrder')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrdersPage;
