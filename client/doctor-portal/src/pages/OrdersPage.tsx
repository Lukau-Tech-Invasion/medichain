import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { apiUrl } from '@medichain/shared';
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
  { value: 'stat', label: 'STAT', color: 'bg-red-100 text-red-800' },
  { value: 'urgent', label: 'Urgent', color: 'bg-orange-100 text-orange-800' },
  { value: 'routine', label: 'Routine', color: 'bg-blue-100 text-blue-800' },
];

const STATUSES = [
  { value: 'pending', label: 'Pending', icon: Clock, color: 'text-yellow-600' },
  { value: 'in_progress', label: 'In Progress', icon: Activity, color: 'text-blue-600' },
  { value: 'completed', label: 'Completed', icon: CheckCircle, color: 'text-green-600' },
  { value: 'cancelled', label: 'Cancelled', icon: XCircle, color: 'text-gray-600' },
];

function OrdersPage() {
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

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchOrders();
    }
  }, [isAuthenticated, user]);

  const fetchOrders = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const response = await fetch(apiUrl('/api/clinical/orders'), {
        headers: { 
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setOrders(data.orders || []);
        setError(null);
      } else {
        setError('Failed to connect to server');
        setOrders([]);
      }
    } catch (err) {
      setError('Failed to fetch orders. Please ensure the API server is running.');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    try {
      const response = await fetch(apiUrl('/api/clinical/order'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify(newOrder),
      });

      if (response.ok) {
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
        setError('Failed to create order');
      }
    } catch (err) {
      setError('Failed to create order. Please ensure the API server is running.');
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    if (!user) return;
    try {
      await fetch(apiUrl(`/api/clinical/orders/${orderId}/status`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {
      // Update locally
    }
    
    setOrders(prev => prev.map(o => 
      o.order_id === orderId 
        ? { ...o, status: newStatus, completed_at: newStatus === 'completed' ? Date.now() : undefined }
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
    return ORDER_TYPES.find(t => t.value === type) || ORDER_TYPES[0];
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Physician Orders</h1>
          <p className="text-gray-500 mt-1">Manage and track clinical orders</p>
        </div>
        <button
          onClick={() => setShowNewOrder(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <Plus size={20} />
          New Order
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-4 rounded-xl shadow">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Clock className="text-yellow-600" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{orders.filter(o => o.status === 'pending').length}</p>
              <p className="text-sm text-gray-500">Pending</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Activity className="text-blue-600" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{orders.filter(o => o.status === 'in_progress').length}</p>
              <p className="text-sm text-gray-500">In Progress</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <AlertTriangle className="text-red-600" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{orders.filter(o => o.priority === 'stat').length}</p>
              <p className="text-sm text-gray-500">STAT Orders</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <CheckCircle className="text-green-600" size={24} />
            </div>
            <div>
              <p className="text-2xl font-bold">{orders.filter(o => o.status === 'completed').length}</p>
              <p className="text-sm text-gray-500">Completed Today</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow mb-6">
        <div className="flex gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search orders..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="all">All Statuses</option>
            {STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="all">All Types</option>
            {ORDER_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-white rounded-xl shadow">
        <div className="p-4 border-b flex items-center gap-2">
          <ClipboardList className="text-gray-400" size={20} />
          <span className="font-medium">{filteredOrders.length} Orders</span>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="mx-auto animate-spin text-primary-500" size={48} />
            <p className="text-gray-500 mt-3">Loading orders...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center text-red-500">{error}</div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center text-gray-500">No orders found</div>
        ) : (
          <div className="divide-y">
            {filteredOrders.map(order => {
              const statusInfo = getStatusInfo(order.status);
              const priorityInfo = getPriorityInfo(order.priority);
              const typeInfo = getTypeInfo(order.order_type);
              const TypeIcon = typeInfo.icon;
              const StatusIcon = statusInfo.icon;

              return (
                <div key={order.order_id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="p-2 bg-gray-100 rounded-lg">
                        <TypeIcon className="text-gray-600" size={24} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{order.order_details}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityInfo.color}`}>
                            {priorityInfo.label}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {order.patient_name || order.patient_id} • {typeInfo.label}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          Ordered: {formatTime(order.ordered_at)}
                          {order.completed_at && ` • Completed: ${formatTime(order.completed_at)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`flex items-center gap-1 ${statusInfo.color}`}>
                        <StatusIcon size={16} />
                        <span className="text-sm">{statusInfo.label}</span>
                      </div>
                      {order.status !== 'completed' && order.status !== 'cancelled' && (
                        <select
                          value={order.status}
                          onChange={(e) => handleUpdateStatus(order.order_id, e.target.value)}
                          className="text-sm border rounded px-2 py-1"
                        >
                          {STATUSES.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">Create New Order</h2>
            <form onSubmit={handleCreateOrder} className="space-y-4">
              <div>
                <label htmlFor="order-patient-id" className="block text-sm font-medium text-gray-700 mb-1">Patient ID</label>
                <input
                  id="order-patient-id"
                  type="text"
                  value={newOrder.patient_id}
                  onChange={(e) => setNewOrder({ ...newOrder, patient_id: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Enter patient ID or wallet address"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="order-type" className="block text-sm font-medium text-gray-700 mb-1">Order Type</label>
                  <select
                    id="order-type"
                    value={newOrder.order_type}
                    onChange={(e) => setNewOrder({ ...newOrder, order_type: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                  >
                    {ORDER_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="order-priority" className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    id="order-priority"
                    value={newOrder.priority}
                    onChange={(e) => setNewOrder({ ...newOrder, priority: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                  >
                    {PRIORITIES.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="order-details" className="block text-sm font-medium text-gray-700 mb-1">Order Details</label>
                <textarea
                  id="order-details"
                  value={newOrder.order_details}
                  onChange={(e) => setNewOrder({ ...newOrder, order_details: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  rows={3}
                  placeholder="Enter order details..."
                  required
                />
              </div>
              <div>
                <label htmlFor="order-notes" className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  id="order-notes"
                  value={newOrder.notes}
                  onChange={(e) => setNewOrder({ ...newOrder, notes: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  rows={2}
                  placeholder="Additional notes..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNewOrder(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  Create Order
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
