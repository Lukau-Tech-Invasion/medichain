import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { getOrderSets, useTranslation } from '@medichain/shared';
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
  const { t } = useTranslation();
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
      setError(t('docOrderSets.errorLoad'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrderSets();
  }, [fetchOrderSets]);

  const handleCreateOrderSet = () => {
    if (!newOrderSet.name || !newOrderSet.specialty || !newOrderSet.description || !newOrderSet.orders?.length) {
      showWarning(t('docOrderSets.warningCreateFields'));
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
    showSuccess(t('docOrderSets.createdSuccess'));
  };

  const handleAddOrderToNewSet = () => {
    if (!newOrder.description) {
      showWarning(t('docOrderSets.warningOrderDescription'));
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
      name: `${set.name}${t('docOrderSets.copySuffix')}`,
      createdBy: user?.userId || 'UNKNOWN',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      usageCount: 0,
    };

    setOrderSets([...orderSets, duplicatedSet]);
    showSuccess(t('docOrderSets.duplicatedSuccess'));
  };

  const handleDeleteSet = (setId: string) => {
    if (confirm(t('docOrderSets.confirmDelete'))) {
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
        return 'bg-notice-subtle text-notice-subtle-fg';
      case 'discharge':
        return 'bg-ok-subtle text-ok-subtle-fg';
      case 'procedure':
        return 'bg-purple-100 text-purple-800';
      case 'protocol':
        return 'bg-orange-100 text-orange-800';
      case 'emergency':
        return 'bg-critical-subtle text-critical-subtle-fg';
      case 'specialty':
        return 'bg-indigo-100 text-indigo-800';
      default:
        return 'bg-surface-sunken text-content-secondary';
    }
  };

  const getPriorityBadge = (priority: OrderPriority) => {
    switch (priority) {
      case 'stat':
        return 'bg-critical-subtle text-critical-subtle-fg';
      case 'urgent':
        return 'bg-orange-100 text-orange-800';
      case 'routine':
        return 'bg-notice-subtle text-notice-subtle-fg';
      case 'prn':
        return 'bg-surface-sunken text-content-secondary';
      default:
        return 'bg-surface-sunken text-content-secondary';
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
            <h1 className="text-3xl font-bold">{t('docOrderSets.title')}</h1>
            <p className="text-teal-50 mt-1">{t('docOrderSets.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-6 border-b border-border-strong">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'all'
              ? 'border-b-2 border-teal-600 text-teal-600'
              : 'text-content-muted hover:text-content'
          }`}
        >
          {t('docOrderSets.tabAllOrderSets', { count: orderSets.length })}
        </button>
        <button
          onClick={() => setActiveTab('new')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new'
              ? 'border-b-2 border-teal-600 text-teal-600'
              : 'text-content-muted hover:text-content'
          }`}
        >
          {t('docOrderSets.tabNewOrderSet')}
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'templates'
              ? 'border-b-2 border-teal-600 text-teal-600'
              : 'text-content-muted hover:text-content'
          }`}
        >
          {t('docOrderSets.tabTemplates')}
        </button>
      </div>

      {activeTab === 'all' && (
        <div className="space-y-6">
          <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="col-span-2">
                <label htmlFor="orderset-search" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.searchOrderSetsLabel')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted w-5 h-5" />
                  <input
                    id="orderset-search"
                    type="text"
                    placeholder={t('docOrderSets.searchOrderSetsPh')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="orderset-filter-type" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.filterByTypeLabel')}</label>
                <select
                  id="orderset-filter-type"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as OrderSetType | 'all')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="all">{t('docOrderSets.allTypes')}</option>
                  <option value="admission">{t('docOrderSets.type_admission')}</option>
                  <option value="discharge">{t('docOrderSets.type_discharge')}</option>
                  <option value="procedure">{t('docOrderSets.type_procedure')}</option>
                  <option value="protocol">{t('docOrderSets.type_protocol')}</option>
                  <option value="emergency">{t('docOrderSets.type_emergency')}</option>
                  <option value="specialty">{t('docOrderSets.type_specialty')}</option>
                </select>
              </div>
            </div>

            {filteredSets.length > 0 ? (
              <div className="space-y-4">
                {filteredSets.map((set) => (
                  <div key={set.setId} className="border border-border-strong rounded-lg p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-xl font-bold text-content">{set.name}</h3>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getTypeBadge(set.type)}`}>
                            {t(`docOrderSets.type_${set.type}`).toUpperCase()}
                          </span>
                          {!set.isActive && (
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface-sunken text-content-muted">
                              {t('docOrderSets.inactiveBadge')}
                            </span>
                          )}
                        </div>
                        <p className="text-content-secondary mb-2">{set.description}</p>
                        <div className="flex items-center gap-4 text-sm text-content-muted">
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
                            {t('docOrderSets.usedTimesLine', { count: set.usageCount })}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDuplicateSet(set)}
                          className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                        >
                          <Copy className="w-4 h-4" />
                          {t('docOrderSets.duplicateButton')}
                        </button>
                        <button
                          onClick={() => {
                            setSelectedSet(set);
                            setShowEditModal(true);
                          }}
                          className="px-3 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                        >
                          <Edit className="w-4 h-4" />
                          {t('docOrderSets.editButton')}
                        </button>
                        <button
                          onClick={() => handleDeleteSet(set.setId)}
                          className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          {t('docOrderSets.deleteButton')}
                        </button>
                      </div>
                    </div>

                    {set.indication && (
                      <div className="bg-caution-subtle border border-caution rounded-lg p-3 mb-4">
                        <p className="text-sm font-semibold text-caution-subtle-fg mb-1">{t('docOrderSets.indicationLabel')}</p>
                        <p className="text-sm text-caution-subtle-fg">{set.indication}</p>
                      </div>
                    )}

                    <div className="bg-surface-sunken rounded-lg p-4 mb-4">
                      <p className="text-sm font-semibold text-content mb-3">{t('docOrderSets.ordersCount', { count: set.orders.length })}</p>
                      <div className="space-y-2">
                        {set.orders.map((order) => (
                          <div key={order.orderId} className="flex items-start gap-3 bg-surface border border-border rounded-lg p-3">
                            <div className="text-content-muted">{getTypeIcon(order.type)}</div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-semibold text-content">{order.description}</p>
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${getPriorityBadge(order.priority)}`}>
                                  {t(`docOrderSets.priority_${order.priority}`)}
                                </span>
                                <span className="px-2 py-1 rounded text-xs font-semibold bg-surface-sunken text-content-muted">
                                  {t(`docOrderSets.orderType_${order.type}`)}
                                </span>
                              </div>
                              {order.instructions && (
                                <p className="text-sm text-content-muted mb-1">{order.instructions}</p>
                              )}
                              <div className="flex gap-3 text-xs text-content-muted">
                                {order.route && <span>{t('docOrderSets.routeLine', { route: order.route })}</span>}
                                {order.frequency && <span>{t('docOrderSets.frequencyLine', { frequency: order.frequency })}</span>}
                                {order.duration && <span>{t('docOrderSets.durationLine', { duration: order.duration })}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {set.tags.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-content-secondary">{t('docOrderSets.tagsLabel')}</p>
                        {set.tags.map((tag, idx) => (
                          <span key={idx} className="px-3 py-1 bg-teal-100 text-teal-800 rounded-full text-xs font-semibold">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4 text-sm text-content-muted">
                      <div className="bg-notice-subtle rounded p-2">
                        <span className="font-semibold">{t('docOrderSets.createdLabel')}</span> {formatDate(set.createdAt)}
                      </div>
                      <div className="bg-ok-subtle rounded p-2">
                        <span className="font-semibold">{t('docOrderSets.lastModifiedLabel')}</span> {formatDate(set.lastModified)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <FileText className="w-16 h-16 text-content-muted mx-auto mb-4" />
                <p className="text-content-muted">{t('docOrderSets.noOrderSetsFound')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'new' && (
        <div className="space-y-6">
          <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
            <h2 className="text-xl font-bold text-content mb-6">{t('docOrderSets.createNewOrderSetHeading')}</h2>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="orderset-name" className="block text-sm font-semibold text-content-secondary mb-2">
                    {t('docOrderSets.orderSetNameRequired')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="orderset-name"
                    type="text"
                    value={newOrderSet.name || ''}
                    onChange={(e) => setNewOrderSet({ ...newOrderSet, name: e.target.value })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                    placeholder={t('docOrderSets.orderSetNamePh')}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="orderset-type" className="block text-sm font-semibold text-content-secondary mb-2">
                    {t('docOrderSets.typeRequired')} <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="orderset-type"
                    value={newOrderSet.type || 'admission'}
                    onChange={(e) => setNewOrderSet({ ...newOrderSet, type: e.target.value as OrderSetType })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  >
                    <option value="admission">{t('docOrderSets.type_admission')}</option>
                    <option value="discharge">{t('docOrderSets.type_discharge')}</option>
                    <option value="procedure">{t('docOrderSets.type_procedure')}</option>
                    <option value="protocol">{t('docOrderSets.type_protocol')}</option>
                    <option value="emergency">{t('docOrderSets.type_emergency')}</option>
                    <option value="specialty">{t('docOrderSets.type_specialty')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="orderset-specialty" className="block text-sm font-semibold text-content-secondary mb-2">
                    {t('docOrderSets.specialtyRequired')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="orderset-specialty"
                    type="text"
                    value={newOrderSet.specialty || ''}
                    onChange={(e) => setNewOrderSet({ ...newOrderSet, specialty: e.target.value })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                    placeholder={t('docOrderSets.specialtyPh')}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="orderset-tags" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.tagsFieldLabel')}</label>
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
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                    placeholder={t('docOrderSets.tagsFieldPh')}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="orderset-description" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docOrderSets.descriptionRequired')} <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="orderset-description"
                  value={newOrderSet.description || ''}
                  onChange={(e) => setNewOrderSet({ ...newOrderSet, description: e.target.value })}
                  rows={3}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  placeholder={t('docOrderSets.descriptionPh')}
                  required
                />
              </div>

              <div>
                <label htmlFor="orderset-indication" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.indicationFieldLabel')}</label>
                <textarea
                  id="orderset-indication"
                  value={newOrderSet.indication || ''}
                  onChange={(e) => setNewOrderSet({ ...newOrderSet, indication: e.target.value })}
                  rows={2}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  placeholder={t('docOrderSets.indicationFieldPh')}
                />
              </div>

              <div className="border-t pt-6">
                <h3 className="text-lg font-bold text-content mb-4">{t('docOrderSets.ordersRequired')} <span className="text-red-500">*</span></h3>

                {(newOrderSet.orders || []).length > 0 && (
                  <div className="space-y-2 mb-4">
                    {(newOrderSet.orders || []).map((order) => (
                      <div key={order.orderId} className="flex items-start gap-3 bg-surface-sunken border border-border rounded-lg p-3">
                        <div className="text-content-muted">{getTypeIcon(order.type)}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-content">{order.description}</p>
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${getPriorityBadge(order.priority)}`}>
                              {t(`docOrderSets.priority_${order.priority}`)}
                            </span>
                          </div>
                          {order.instructions && <p className="text-sm text-content-muted">{order.instructions}</p>}
                        </div>
                        <button
                          onClick={() => handleDeleteOrder(order.orderId)}
                          className="text-red-500 hover:text-critical-subtle-fg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                  <h4 className="font-semibold text-content mb-3">{t('docOrderSets.addOrderHeading')}</h4>
                  <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <label htmlFor="orderset-order-type" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.orderTypeLabel')}</label>
                      <select
                        id="orderset-order-type"
                        value={newOrder.type || 'medication'}
                        onChange={(e) => setNewOrder({ ...newOrder, type: e.target.value as OrderType })}
                        className="w-full border border-border-strong rounded-lg px-3 py-2"
                      >
                        <option value="medication">{t('docOrderSets.orderTypeOption_medication')}</option>
                        <option value="lab">{t('docOrderSets.orderTypeOption_lab')}</option>
                        <option value="imaging">{t('docOrderSets.orderTypeOption_imaging')}</option>
                        <option value="consult">{t('docOrderSets.orderTypeOption_consult')}</option>
                        <option value="nursing">{t('docOrderSets.orderTypeOption_nursing')}</option>
                        <option value="diet">{t('docOrderSets.orderTypeOption_diet')}</option>
                        <option value="activity">{t('docOrderSets.orderTypeOption_activity')}</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="orderset-priority" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.priorityLabel')}</label>
                      <select
                        id="orderset-priority"
                        value={newOrder.priority || 'routine'}
                        onChange={(e) => setNewOrder({ ...newOrder, priority: e.target.value as OrderPriority })}
                        className="w-full border border-border-strong rounded-lg px-3 py-2"
                      >
                        <option value="stat">{t('docOrderSets.priority_stat')}</option>
                        <option value="urgent">{t('docOrderSets.priority_urgent')}</option>
                        <option value="routine">{t('docOrderSets.priority_routine')}</option>
                        <option value="prn">{t('docOrderSets.priority_prn')}</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label htmlFor="orderset-order-description" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.orderDescriptionLabel')}</label>
                    <input
                      id="orderset-order-description"
                      type="text"
                      value={newOrder.description || ''}
                      onChange={(e) => setNewOrder({ ...newOrder, description: e.target.value })}
                      className="w-full border border-border-strong rounded-lg px-3 py-2"
                      placeholder={t('docOrderSets.orderDescriptionPh')}
                    />
                  </div>

                  <div className="mb-3">
                    <label htmlFor="orderset-instructions" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.instructionsLabel')}</label>
                    <input
                      id="orderset-instructions"
                      type="text"
                      value={newOrder.instructions || ''}
                      onChange={(e) => setNewOrder({ ...newOrder, instructions: e.target.value })}
                      className="w-full border border-border-strong rounded-lg px-3 py-2"
                      placeholder={t('docOrderSets.instructionsPh')}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-3">
                    <div>
                      <label htmlFor="orderset-route" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.routeLabel')}</label>
                      <input
                        id="orderset-route"
                        type="text"
                        value={newOrder.route || ''}
                        onChange={(e) => setNewOrder({ ...newOrder, route: e.target.value })}
                        className="w-full border border-border-strong rounded-lg px-3 py-2"
                        placeholder={t('docOrderSets.routePh')}
                      />
                    </div>
                    <div>
                      <label htmlFor="orderset-frequency" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.frequencyLabel')}</label>
                      <input
                        id="orderset-frequency"
                        type="text"
                        value={newOrder.frequency || ''}
                        onChange={(e) => setNewOrder({ ...newOrder, frequency: e.target.value })}
                        className="w-full border border-border-strong rounded-lg px-3 py-2"
                        placeholder={t('docOrderSets.frequencyPh')}
                      />
                    </div>
                    <div>
                      <label htmlFor="orderset-duration" className="block text-sm font-semibold text-content-secondary mb-2">{t('docOrderSets.durationLabel')}</label>
                      <input
                        id="orderset-duration"
                        type="text"
                        value={newOrder.duration || ''}
                        onChange={(e) => setNewOrder({ ...newOrder, duration: e.target.value })}
                        className="w-full border border-border-strong rounded-lg px-3 py-2"
                        placeholder={t('docOrderSets.durationPh')}
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleAddOrderToNewSet}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    {t('docOrderSets.addOrderButton')}
                  </button>
                </div>
              </div>

              <button
                onClick={handleCreateOrderSet}
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                {t('docOrderSets.createOrderSetButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-xl font-bold text-content mb-4">{t('docOrderSets.orderSetTemplatesHeading')}</h2>
          <p className="text-content-muted mb-6">{t('docOrderSets.templatesIntro')}</p>

          <div className="grid grid-cols-3 gap-4">
            <div className="border border-border-strong rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center gap-2 mb-3">
                <Heart className="w-6 h-6 text-critical-subtle-fg" />
                <h3 className="font-bold text-content">{t('docOrderSets.stemiName')}</h3>
              </div>
              <p className="text-sm text-content-muted mb-3">{t('docOrderSets.stemiDesc')}</p>
              <span className="inline-block px-3 py-1 bg-critical-subtle text-critical-subtle-fg rounded-full text-xs font-semibold">
                {t('docOrderSets.type_emergency')}
              </span>
            </div>

            <div className="border border-border-strong rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-6 h-6 text-purple-600" />
                <h3 className="font-bold text-content">{t('docOrderSets.strokeName')}</h3>
              </div>
              <p className="text-sm text-content-muted mb-3">{t('docOrderSets.strokeDesc')}</p>
              <span className="inline-block px-3 py-1 bg-critical-subtle text-critical-subtle-fg rounded-full text-xs font-semibold">
                {t('docOrderSets.type_emergency')}
              </span>
            </div>

            <div className="border border-border-strong rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-6 h-6 text-orange-600" />
                <h3 className="font-bold text-content">{t('docOrderSets.traumaName')}</h3>
              </div>
              <p className="text-sm text-content-muted mb-3">{t('docOrderSets.traumaDesc')}</p>
              <span className="inline-block px-3 py-1 bg-critical-subtle text-critical-subtle-fg rounded-full text-xs font-semibold">
                {t('docOrderSets.type_emergency')}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderSetsPage;
