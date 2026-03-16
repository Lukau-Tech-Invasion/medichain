import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { getOrderSets } from '@medichain/shared';
import {
  FileText,
  Plus,
  Search,
  Edit,
  Copy,
  Trash2,
  User,
  Activity,
  Pill,
  TestTube,
  Stethoscope,
  Heart,
  Brain,
  Shield,
} from 'lucide-react';

type OrderSetType = 'admission' | 'discharge' | 'procedure' | 'protocol' | 'emergency' | 'specialty';
type OrderType = 'medication' | 'lab' | 'imaging' | 'consult' | 'nursing' | 'diet' | 'activity';
type OrderPriority = 'stat' | 'urgent' | 'routine' | 'prn';

interface Order {
  orderId: string;
  type: OrderType;
  description: string;
  instructions?: string;
  priority: OrderPriority;
  duration?: string;
  frequency?: string;
  route?: string;
}

interface OrderSet {
  setId: string;
  name: string;
  type: OrderSetType;
  specialty: string;
  description: string;
  indication: string;
  orders: Order[];
  createdBy: string;
  createdAt: string;
  lastModified: string;
  usageCount: number;
  isActive: boolean;
  tags: string[];
}

/**
 * OrderSetsPage
 * 
 * Page for managing standard order sets (protocols).
 */
const OrderSetsPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showWarning } = useToastActions();
  const [orderSets, setOrderSets] = useState<OrderSet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'new' | 'templates'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<OrderSetType | 'all'>('all');
  const [_selectedSet, setSelectedSet] = useState<OrderSet | null>(null);
  const [_showEditModal, setShowEditModal] = useState(false);
  const [newOrderSet, setNewOrderSet] = useState<Partial<OrderSet>>({
    name: '',
    type: 'admission',
    specialty: '',
    description: '',
    indication: '',
    orders: [],
    tags: [],
    isActive: true,
  });
  const [newOrder, setNewOrder] = useState<Partial<Order>>({
    type: 'medication',
    description: '',
    priority: 'routine',
  });

  const fetchOrderSets = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getOrderSets();
      if (response && Array.isArray(response)) {
        setOrderSets(response as OrderSet[]);
      } else if (response && typeof response === 'object' && 'items' in response) {
        setOrderSets((response as { items: OrderSet[] }).items);
      }
    } catch (err) {
      console.error('Error fetching order sets:', err);
      setError('Failed to load order sets');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrderSets();
  }, [fetchOrderSets]);

  const handleCreateOrderSet = () => {
    if (!newOrderSet.name || !newOrderSet.specialty || !newOrderSet.description || !newOrderSet.orders?.length) {
      showWarning('Please fill all required fields and add at least one order');
      return;
    }

    const orderSet: OrderSet = {
      setId: `OS-${String(orderSets.length + 1).padStart(3, '0')}`,
      name: newOrderSet.name!,
      type: newOrderSet.type!,
      specialty: newOrderSet.specialty!,
      description: newOrderSet.description!,
      indication: newOrderSet.indication || '',
      orders: newOrderSet.orders!,
      createdBy: user?.userId || 'UNKNOWN',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      usageCount: 0,
      isActive: true,
      tags: newOrderSet.tags || [],
    };

    setOrderSets([...orderSets, orderSet]);
    setNewOrderSet({
      name: '',
      type: 'admission',
      specialty: '',
      description: '',
      indication: '',
      orders: [],
      tags: [],
      isActive: true,
    });
    setActiveTab('all');
    showSuccess('Order set created successfully!');
  };

  const handleAddOrderToNewSet = () => {
    if (!newOrder.description) {
      showWarning('Please enter order description');
      return;
    }

    const order: Order = {
      orderId: `O-${String((newOrderSet.orders?.length || 0) + 1).padStart(3, '0')}`,
      type: newOrder.type!,
      description: newOrder.description!,
      instructions: newOrder.instructions,
      priority: newOrder.priority!,
      duration: newOrder.duration,
      frequency: newOrder.frequency,
      route: newOrder.route,
    };

    setNewOrderSet({
      ...newOrderSet,
      orders: [...(newOrderSet.orders || []), order],
    });

    setNewOrder({
      type: 'medication',
      description: '',
      priority: 'routine',
    });
  };

  const handleDeleteOrder = (orderId: string) => {
    setNewOrderSet({
      ...newOrderSet,
      orders: (newOrderSet.orders || []).filter((o) => o.orderId !== orderId),
    });
  };

  const handleDuplicateSet = (set: OrderSet) => {
    const duplicatedSet: OrderSet = {
      ...set,
      setId: `OS-${String(orderSets.length + 1).padStart(3, '0')}`,
      name: `${set.name} (Copy)`,
      createdBy: user?.userId || 'UNKNOWN',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      usageCount: 0,
    };

    setOrderSets([...orderSets, duplicatedSet]);
    showSuccess('Order set duplicated successfully!');
  };

  const handleDeleteSet = (setId: string) => {
    if (confirm('Are you sure you want to delete this order set?')) {
      setOrderSets(orderSets.filter((s) => s.setId !== setId));
    }
  };

  const getTypeIcon = (type: OrderType) => {
    switch (type) {
      case 'medication':
        return <Pill className="w-5 h-5" />;
      case 'lab':
        return <TestTube className="w-5 h-5" />;
      case 'imaging':
        return <Activity className="w-5 h-5" />;
      case 'consult':
        return <Stethoscope className="w-5 h-5" />;
      case 'nursing':
        return <Heart className="w-5 h-5" />;
      case 'diet':
        return <Pill className="w-5 h-5" />;
      case 'activity':
        return <Activity className="w-5 h-5" />;
      default:
        return <FileText className="w-5 h-5" />;
    }
  };

  const getTypeBadge = (type: OrderSetType) => {
    switch (type) {
      case 'admission':
        return 'bg-blue-100 text-blue-800';
      case 'discharge':
        return 'bg-green-100 text-green-800';
      case 'procedure':
        return 'bg-purple-100 text-purple-800';
      case 'protocol':
        return 'bg-orange-100 text-orange-800';
      case 'emergency':
        return 'bg-red-100 text-red-800';
      case 'specialty':
        return 'bg-indigo-100 text-indigo-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityBadge = (priority: OrderPriority) => {
    switch (priority) {
      case 'stat':
        return 'bg-red-100 text-red-800';
      case 'urgent':
        return 'bg-orange-100 text-orange-800';
      case 'routine':
        return 'bg-blue-100 text-blue-800';
      case 'prn':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredSets = orderSets.filter((set) => {
    const matchesSearch =
      set.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      set.specialty.toLowerCase().includes(searchTerm.toLowerCase()) ||
      set.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'all' || set.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-teal-600 to-cyan-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center gap-3">
          <Shield className="w-10 h-10" />
          <div>
            <h1 className="text-3xl font-bold">Order Sets</h1>
            <p className="text-teal-50 mt-1">Pre-defined clinical order templates and protocols</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-6 border-b border-gray-300">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'all'
              ? 'border-b-2 border-teal-600 text-teal-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          All Order Sets ({orderSets.length})
        </button>
        <button
          onClick={() => setActiveTab('new')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new'
              ? 'border-b-2 border-teal-600 text-teal-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          New Order Set
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'templates'
              ? 'border-b-2 border-teal-600 text-teal-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Templates
        </button>
      </div>

      {activeTab === 'all' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="col-span-2">
                <label htmlFor="orderset-search" className="block text-sm font-semibold text-gray-700 mb-2">Search Order Sets</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    id="orderset-search"
                    type="text"
                    placeholder="Search by name, specialty, or description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="orderset-filter-type" className="block text-sm font-semibold text-gray-700 mb-2">Filter by Type</label>
                <select
                  id="orderset-filter-type"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as OrderSetType | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">All Types</option>
                  <option value="admission">Admission</option>
                  <option value="discharge">Discharge</option>
                  <option value="procedure">Procedure</option>
                  <option value="protocol">Protocol</option>
                  <option value="emergency">Emergency</option>
                  <option value="specialty">Specialty</option>
                </select>
              </div>
            </div>

            {filteredSets.length > 0 ? (
              <div className="space-y-4">
                {filteredSets.map((set) => (
                  <div key={set.setId} className="border border-gray-300 rounded-lg p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-xl font-bold text-gray-900">{set.name}</h3>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getTypeBadge(set.type)}`}>
                            {set.type.toUpperCase()}
                          </span>
                          {!set.isActive && (
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                              INACTIVE
                            </span>
                          )}
                        </div>
                        <p className="text-gray-700 mb-2">{set.description}</p>
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                          <span className="flex items-center gap-1">
                            <Brain className="w-4 h-4" />
                            {set.specialty}
                          </span>
                          <span className="flex items-center gap-1">
                            <User className="w-4 h-4" />
                            {set.createdBy}
                          </span>
                          <span className="flex items-center gap-1">
                            <Activity className="w-4 h-4" />
                            Used {set.usageCount} times
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDuplicateSet(set)}
                          className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                        >
                          <Copy className="w-4 h-4" />
                          Duplicate
                        </button>
                        <button
                          onClick={() => {
                            setSelectedSet(set);
                            setShowEditModal(true);
                          }}
                          className="px-3 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                        >
                          <Edit className="w-4 h-4" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteSet(set.setId)}
                          className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    </div>

                    {set.indication && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                        <p className="text-sm font-semibold text-yellow-900 mb-1">Indication</p>
                        <p className="text-sm text-yellow-800">{set.indication}</p>
                      </div>
                    )}

                    <div className="bg-gray-50 rounded-lg p-4 mb-4">
                      <p className="text-sm font-semibold text-gray-900 mb-3">Orders ({set.orders.length})</p>
                      <div className="space-y-2">
                        {set.orders.map((order) => (
                          <div key={order.orderId} className="flex items-start gap-3 bg-white border border-gray-200 rounded-lg p-3">
                            <div className="text-gray-600">{getTypeIcon(order.type)}</div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-semibold text-gray-900">{order.description}</p>
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${getPriorityBadge(order.priority)}`}>
                                  {order.priority.toUpperCase()}
                                </span>
                                <span className="px-2 py-1 rounded text-xs font-semibold bg-gray-100 text-gray-600">
                                  {order.type}
                                </span>
                              </div>
                              {order.instructions && (
                                <p className="text-sm text-gray-600 mb-1">{order.instructions}</p>
                              )}
                              <div className="flex gap-3 text-xs text-gray-500">
                                {order.route && <span>Route: {order.route}</span>}
                                {order.frequency && <span>Frequency: {order.frequency}</span>}
                                {order.duration && <span>Duration: {order.duration}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {set.tags.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-700">Tags:</p>
                        {set.tags.map((tag, idx) => (
                          <span key={idx} className="px-3 py-1 bg-teal-100 text-teal-800 rounded-full text-xs font-semibold">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4 text-sm text-gray-600">
                      <div className="bg-blue-50 rounded p-2">
                        <span className="font-semibold">Created:</span> {formatDate(set.createdAt)}
                      </div>
                      <div className="bg-green-50 rounded p-2">
                        <span className="font-semibold">Last Modified:</span> {formatDate(set.lastModified)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No order sets found</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'new' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Create New Order Set</h2>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="orderset-name" className="block text-sm font-semibold text-gray-700 mb-2">
                    Order Set Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="orderset-name"
                    type="text"
                    value={newOrderSet.name || ''}
                    onChange={(e) => setNewOrderSet({ ...newOrderSet, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="e.g., Chest Pain Protocol"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="orderset-type" className="block text-sm font-semibold text-gray-700 mb-2">
                    Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="orderset-type"
                    value={newOrderSet.type || 'admission'}
                    onChange={(e) => setNewOrderSet({ ...newOrderSet, type: e.target.value as OrderSetType })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="admission">Admission</option>
                    <option value="discharge">Discharge</option>
                    <option value="procedure">Procedure</option>
                    <option value="protocol">Protocol</option>
                    <option value="emergency">Emergency</option>
                    <option value="specialty">Specialty</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="orderset-specialty" className="block text-sm font-semibold text-gray-700 mb-2">
                    Specialty <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="orderset-specialty"
                    type="text"
                    value={newOrderSet.specialty || ''}
                    onChange={(e) => setNewOrderSet({ ...newOrderSet, specialty: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="e.g., Emergency Medicine"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="orderset-tags" className="block text-sm font-semibold text-gray-700 mb-2">Tags</label>
                  <input
                    id="orderset-tags"
                    type="text"
                    value={(newOrderSet.tags || []).join(', ')}
                    onChange={(e) =>
                      setNewOrderSet({
                        ...newOrderSet,
                        tags: e.target.value.split(',').map((t) => t.trim()),
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="e.g., cardiology, emergency (comma-separated)"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="orderset-description" className="block text-sm font-semibold text-gray-700 mb-2">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="orderset-description"
                  value={newOrderSet.description || ''}
                  onChange={(e) => setNewOrderSet({ ...newOrderSet, description: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="Brief description of the order set"
                  required
                />
              </div>

              <div>
                <label htmlFor="orderset-indication" className="block text-sm font-semibold text-gray-700 mb-2">Indication</label>
                <textarea
                  id="orderset-indication"
                  value={newOrderSet.indication || ''}
                  onChange={(e) => setNewOrderSet({ ...newOrderSet, indication: e.target.value })}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="When to use this order set"
                />
              </div>

              <div className="border-t pt-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Orders <span className="text-red-500">*</span></h3>

                {(newOrderSet.orders || []).length > 0 && (
                  <div className="space-y-2 mb-4">
                    {(newOrderSet.orders || []).map((order) => (
                      <div key={order.orderId} className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="text-gray-600">{getTypeIcon(order.type)}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-gray-900">{order.description}</p>
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${getPriorityBadge(order.priority)}`}>
                              {order.priority.toUpperCase()}
                            </span>
                          </div>
                          {order.instructions && <p className="text-sm text-gray-600">{order.instructions}</p>}
                        </div>
                        <button
                          onClick={() => handleDeleteOrder(order.orderId)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Add Order</h4>
                  <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <label htmlFor="orderset-order-type" className="block text-sm font-semibold text-gray-700 mb-2">Order Type</label>
                      <select
                        id="orderset-order-type"
                        value={newOrder.type || 'medication'}
                        onChange={(e) => setNewOrder({ ...newOrder, type: e.target.value as OrderType })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      >
                        <option value="medication">Medication</option>
                        <option value="lab">Lab</option>
                        <option value="imaging">Imaging</option>
                        <option value="consult">Consult</option>
                        <option value="nursing">Nursing</option>
                        <option value="diet">Diet</option>
                        <option value="activity">Activity</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="orderset-priority" className="block text-sm font-semibold text-gray-700 mb-2">Priority</label>
                      <select
                        id="orderset-priority"
                        value={newOrder.priority || 'routine'}
                        onChange={(e) => setNewOrder({ ...newOrder, priority: e.target.value as OrderPriority })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      >
                        <option value="stat">STAT</option>
                        <option value="urgent">Urgent</option>
                        <option value="routine">Routine</option>
                        <option value="prn">PRN</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label htmlFor="orderset-order-description" className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                    <input
                      id="orderset-order-description"
                      type="text"
                      value={newOrder.description || ''}
                      onChange={(e) => setNewOrder({ ...newOrder, description: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      placeholder="e.g., Aspirin 325mg PO"
                    />
                  </div>

                  <div className="mb-3">
                    <label htmlFor="orderset-instructions" className="block text-sm font-semibold text-gray-700 mb-2">Instructions</label>
                    <input
                      id="orderset-instructions"
                      type="text"
                      value={newOrder.instructions || ''}
                      onChange={(e) => setNewOrder({ ...newOrder, instructions: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      placeholder="Optional detailed instructions"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-3">
                    <div>
                      <label htmlFor="orderset-route" className="block text-sm font-semibold text-gray-700 mb-2">Route</label>
                      <input
                        id="orderset-route"
                        type="text"
                        value={newOrder.route || ''}
                        onChange={(e) => setNewOrder({ ...newOrder, route: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        placeholder="e.g., PO, IV"
                      />
                    </div>
                    <div>
                      <label htmlFor="orderset-frequency" className="block text-sm font-semibold text-gray-700 mb-2">Frequency</label>
                      <input
                        id="orderset-frequency"
                        type="text"
                        value={newOrder.frequency || ''}
                        onChange={(e) => setNewOrder({ ...newOrder, frequency: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        placeholder="e.g., Q4H, Daily"
                      />
                    </div>
                    <div>
                      <label htmlFor="orderset-duration" className="block text-sm font-semibold text-gray-700 mb-2">Duration</label>
                      <input
                        id="orderset-duration"
                        type="text"
                        value={newOrder.duration || ''}
                        onChange={(e) => setNewOrder({ ...newOrder, duration: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        placeholder="e.g., 7 days"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleAddOrderToNewSet}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    Add Order
                  </button>
                </div>
              </div>

              <button
                onClick={handleCreateOrderSet}
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Create Order Set
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Order Set Templates</h2>
          <p className="text-gray-600 mb-6">Browse and use pre-built order set templates from common clinical scenarios.</p>

          <div className="grid grid-cols-3 gap-4">
            <div className="border border-gray-300 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center gap-2 mb-3">
                <Heart className="w-6 h-6 text-red-600" />
                <h3 className="font-bold text-gray-900">STEMI Protocol</h3>
              </div>
              <p className="text-sm text-gray-600 mb-3">Immediate management of ST-elevation myocardial infarction</p>
              <span className="inline-block px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold">
                Emergency
              </span>
            </div>

            <div className="border border-gray-300 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-6 h-6 text-purple-600" />
                <h3 className="font-bold text-gray-900">Stroke Code</h3>
              </div>
              <p className="text-sm text-gray-600 mb-3">Rapid assessment and treatment protocol for acute stroke</p>
              <span className="inline-block px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold">
                Emergency
              </span>
            </div>

            <div className="border border-gray-300 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-6 h-6 text-orange-600" />
                <h3 className="font-bold text-gray-900">Trauma Activation</h3>
              </div>
              <p className="text-sm text-gray-600 mb-3">Multi-trauma patient evaluation and resuscitation</p>
              <span className="inline-block px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold">
                Emergency
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderSetsPage;
