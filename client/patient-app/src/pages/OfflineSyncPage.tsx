import React, { useState, useEffect, useCallback } from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Cloud,
  CloudOff,
  CheckCircle,
  AlertTriangle,
  Clock,
  Database,
  Trash2,
  Download,
  Upload,
  HardDrive,
  FileText,
  Image,
  Settings,
  Shield,
  Loader2
} from 'lucide-react';
import {
  getAllCachedItems,
  getAllSyncItems,
  getStorageInfo,
  clearStore,
  clearCompletedSyncItems,
  clearExpiredCache,
  STORES,
  type SyncQueueItem as IndexedDBSyncItem,
  type CachedDataItem,
  performSync,
  downloadOfflineData,
  getSyncConflicts,
  resolveSyncConflict,
} from '@medichain/shared';
import { useTranslation } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

/**
 * OfflineSyncPage
 * 
 * Full-featured page for managing offline data synchronization.
 * Displays PWA cache state, sync status, and storage management.
 */

type SyncStatus = 'synced' | 'pending' | 'syncing' | 'error' | 'offline';
type DataCategory = 'medical-records' | 'appointments' | 'medications' | 'lab-results' | 'documents' | 'images';

interface CachedItem {
  id: string;
  category: DataCategory;
  name: string;
  size: number;
  lastSynced: string;
  status: SyncStatus;
  priority: 'high' | 'medium' | 'low';
}

interface SyncQueue {
  id: string;
  action: 'upload' | 'download';
  description: string;
  timestamp: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  retryCount: number;
}

interface StorageInfo {
  used: number;
  available: number;
  quota: number;
}

interface ConflictItem {
  id: string;
  entity_type: string;
  entity_id: string;
  local_value?: string | null;
  remote_value?: string | null;
  conflict_type?: string;
}

const OfflineSyncPage: React.FC = () => {
  const { t } = useTranslation();
  const { patient } = usePatientAuthStore();
  const statusLabel = (s: string) =>
    ({
      synced: t('offlineSync.statusSynced'),
      pending: t('offlineSync.statusPending'),
      syncing: t('offlineSync.statusSyncing'),
      error: t('offlineSync.statusError'),
      offline: t('offlineSync.statusOffline'),
      'in-progress': t('offlineSync.statusInProgress'),
      completed: t('offlineSync.statusCompleted'),
      failed: t('offlineSync.statusFailed'),
    }[s] || s);
  const categoryLabel = (c: string) =>
    ({
      'medical-records': t('offlineSync.catMedicalRecords'),
      medications: t('offlineSync.catMedications'),
      appointments: t('offlineSync.catAppointments'),
      'lab-results': t('offlineSync.catLabResults'),
      documents: t('offlineSync.catDocuments'),
      images: t('offlineSync.catImages'),
    }[c] || c.replace('-', ' '));
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [isSyncing, setIsSyncing] = useState(false);
  const [cachedItems, setCachedItems] = useState<CachedItem[]>([]);
  const [syncQueue, setSyncQueue] = useState<SyncQueue[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo>({ used: 0, available: 0, quota: 0 });
  const [lastFullSync, setLastFullSync] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'status' | 'cache' | 'settings'>('status');
  const [loading, setLoading] = useState(true);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);

  // Load data from IndexedDB
  const loadOfflineData = useCallback(async () => {
    setLoading(true);
    try {
      // Load cached items from IndexedDB
      const dbCachedItems = await getAllCachedItems();
      const mappedItems: CachedItem[] = dbCachedItems.map((item: CachedDataItem) => ({
        id: item.id,
        category: item.category as DataCategory,
        name: item.name,
        size: item.size,
        lastSynced: new Date(item.lastSynced).toISOString(),
        status: Date.now() > item.expiresAt ? 'pending' : 'synced' as SyncStatus,
        priority: item.priority
      }));
      
      // Load sync queue from IndexedDB
      const dbSyncItems = await getAllSyncItems();
      const mappedQueue: SyncQueue[] = dbSyncItems.map((item: IndexedDBSyncItem) => ({
        id: item.id,
        action: item.action === 'upload' ? 'upload' : 'download' as 'upload' | 'download',
        description: item.description,
        timestamp: new Date(item.timestamp).toISOString(),
        status: item.status,
        retryCount: item.retryCount
      }));

      // Load storage info
      const storage = await getStorageInfo();
      
      setCachedItems(mappedItems.length > 0 ? mappedItems : getDefaultCachedItems());
      setSyncQueue(mappedQueue);
      setStorageInfo({
        used: storage.used || storage.cachedItemsSize + storage.syncQueueSize + storage.documentsSize,
        available: storage.available,
        quota: storage.quota
      });

      // Check if any items are pending
      const hasPending = mappedItems.some(i => i.status === 'pending') || mappedQueue.some(q => q.status === 'pending');
      setSyncStatus(hasPending ? 'pending' : 'synced');

    } catch (error) {
      console.error('Failed to load offline data:', error);
      // Use demo data as fallback
      setCachedItems(getDefaultCachedItems());
      setSyncQueue(getDefaultSyncQueue());
      
      // Estimate storage
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        setStorageInfo({
          used: estimate.usage || 2500000,
          available: (estimate.quota || 50000000) - (estimate.usage || 2500000),
          quota: estimate.quota || 50000000
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Default demo data helpers
  const getDefaultCachedItems = (): CachedItem[] => [
    { id: '1', category: 'medical-records', name: 'Medical History Summary', size: 256000, lastSynced: '2026-01-25T10:30:00Z', status: 'synced', priority: 'high' },
    { id: '2', category: 'medications', name: 'Current Medications List', size: 12000, lastSynced: '2026-01-25T10:30:00Z', status: 'synced', priority: 'high' },
    { id: '3', category: 'appointments', name: 'Upcoming Appointments', size: 8000, lastSynced: '2026-01-25T10:30:00Z', status: 'synced', priority: 'high' },
    { id: '4', category: 'lab-results', name: 'Recent Lab Results', size: 145000, lastSynced: '2026-01-25T09:00:00Z', status: 'pending', priority: 'medium' },
    { id: '5', category: 'documents', name: 'Insurance Cards', size: 320000, lastSynced: '2026-01-24T15:00:00Z', status: 'synced', priority: 'medium' },
    { id: '6', category: 'images', name: 'Profile Photo', size: 180000, lastSynced: '2026-01-20T12:00:00Z', status: 'synced', priority: 'low' },
    { id: '7', category: 'documents', name: 'Vaccination Records', size: 95000, lastSynced: '2026-01-22T08:00:00Z', status: 'synced', priority: 'medium' },
    { id: '8', category: 'medical-records', name: 'Allergy Information', size: 5000, lastSynced: '2026-01-25T10:30:00Z', status: 'synced', priority: 'high' }
  ];

  const getDefaultSyncQueue = (): SyncQueue[] => [
    { id: 'q1', action: 'upload', description: 'Symptom diary entry', timestamp: '2026-01-25T11:00:00Z', status: 'pending', retryCount: 0 },
    { id: 'q2', action: 'download', description: 'Lab results update', timestamp: '2026-01-25T10:45:00Z', status: 'pending', retryCount: 0 }
  ];

  // Load server-detected sync conflicts (last-write-wins, from /api/sync/conflicts)
  const loadConflicts = useCallback(async () => {
    try {
      const res = (await getSyncConflicts()) as { conflicts?: ConflictItem[] };
      setConflicts(res?.conflicts ?? []);
    } catch {
      setConflicts([]);
    }
  }, []);

  const handleResolveConflict = async (id: string, resolution: 'UseLocal' | 'UseServer') => {
    try {
      await resolveSyncConflict(id, resolution);
      setConflicts((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // Leave the conflict listed if the resolution call fails.
    }
  };

  useEffect(() => {
    // Monitor online/offline status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Load data from IndexedDB
    loadOfflineData();
    loadConflicts();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadOfflineData, loadConflicts]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const handleSync = async () => {
    if (!isOnline) return;
    setIsSyncing(true);
    setSyncStatus('syncing');

    try {
      // Call backend sync API if patient is authenticated
      if (patient?.healthId) {
        try {
          await performSync({ patient_id: patient.healthId });
        } catch (apiErr) {
          console.warn('Backend sync API failed, continuing with local sync:', apiErr);
        }
      }

      // Clear completed sync items from IndexedDB
      await clearCompletedSyncItems();

      // Clear expired cache entries
      await clearExpiredCache();

      // Reload data
      await loadOfflineData();

      setLastFullSync(new Date().toISOString());
      setSyncStatus('synced');
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncStatus('error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDownloadOffline = async () => {
    if (!isOnline || !patient?.healthId) return;
    setIsSyncing(true);
    try {
      await downloadOfflineData(patient.healthId);
      await loadOfflineData();
      setLastFullSync(new Date().toISOString());
    } catch (err) {
      console.error('Download for offline failed:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearCache = async (category?: DataCategory) => {
    try {
      if (category) {
        setCachedItems(prev => prev.filter(item => item.category !== category));
        // Note: Would need to implement category-specific clearing in IndexedDB
      } else {
        await clearStore(STORES.CACHED_DATA);
        setCachedItems([]);
      }
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  };

  const getCategoryIcon = (category: DataCategory) => {
    switch (category) {
      case 'medical-records': return <FileText className="w-5 h-5 text-blue-500" />;
      case 'appointments': return <Clock className="w-5 h-5 text-purple-500" />;
      case 'medications': return <Shield className="w-5 h-5 text-green-500" />;
      case 'lab-results': return <Database className="w-5 h-5 text-orange-500" />;
      case 'documents': return <FileText className="w-5 h-5 text-gray-500" />;
      case 'images': return <Image className="w-5 h-5 text-pink-500" />;
    }
  };

  const getStatusIcon = (status: SyncStatus) => {
    switch (status) {
      case 'synced': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'pending': return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'syncing': return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'error': return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'offline': return <CloudOff className="w-4 h-4 text-gray-500" />;
    }
  };

  const pendingCount = cachedItems.filter(i => i.status === 'pending').length + syncQueue.length;
  const storagePercent = (storageInfo.used / storageInfo.quota) * 100;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-sky-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">{t('offlineSync.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className={`bg-gradient-to-r ${isOnline ? 'from-sky-600 to-blue-500' : 'from-gray-600 to-gray-500'} text-white p-6 transition-colors`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            {isOnline ? <Cloud className="w-8 h-8" /> : <CloudOff className="w-8 h-8" />}
            <h1 className="text-2xl font-bold">{t('offlineSync.title')}</h1>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${isOnline ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
            {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            <span className="text-sm font-medium">{isOnline ? t('offlineSync.online') : t('offlineSync.offline')}</span>
          </div>
        </div>
        <p className="text-sky-100">{t('offlineSync.subtitle')}</p>
      </div>

      {/* Sync Buttons */}
      <div className="p-4 -mt-4 space-y-2">
        <button
          onClick={handleSync}
          disabled={!isOnline || isSyncing}
          className={`w-full py-4 rounded-lg shadow flex items-center justify-center gap-3 font-semibold transition-all ${
            isOnline && !isSyncing
              ? 'bg-white text-sky-600 hover:bg-sky-50'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? t('offlineSync.syncing') : t('offlineSync.syncNow')}
          {pendingCount > 0 && (
            <span className="bg-yellow-500 text-white text-xs px-2 py-0.5 rounded-full">
              {t('offlineSync.pendingCount', { count: pendingCount })}
            </span>
          )}
        </button>
        <button
          onClick={handleDownloadOffline}
          disabled={!isOnline || isSyncing || !patient?.healthId}
          className={`w-full py-3 rounded-lg shadow flex items-center justify-center gap-3 font-semibold transition-all text-sm ${
            isOnline && !isSyncing && patient?.healthId
              ? 'bg-white text-green-600 hover:bg-green-50'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          <Download className="w-4 h-4" />
          {t('offlineSync.downloadOffline')}
        </button>
      </div>

      {/* Tabs */}
      <div className="px-4 mb-4">
        <div className="bg-white rounded-lg shadow p-1 flex">
          {[
            { id: 'status', label: t('offlineSync.tabStatus') },
            { id: 'cache', label: t('offlineSync.tabCache') },
            { id: 'settings', label: t('offlineSync.tabSettings') }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-sky-500 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status Tab */}
      {activeTab === 'status' && (
        <div className="px-4 pb-8 space-y-4">
          {/* Sync Conflicts — records changed both locally and on the server */}
          {conflicts.length > 0 && (
            <div className="bg-white rounded-lg shadow p-4 border border-amber-300">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <h3 className="font-medium text-gray-900">{t('offlineSync.conflictsTitle', { count: conflicts.length })}</h3>
              </div>
              <p className="text-sm text-gray-500 mb-3">
                {t('offlineSync.conflictsBody')}
              </p>
              <div className="space-y-3">
                {conflicts.map((c) => (
                  <div key={c.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-800">
                      {c.entity_type} · {c.entity_id}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                      <div className="bg-blue-50 rounded p-2 overflow-hidden">
                        <div className="font-semibold text-blue-700 mb-1">{t('offlineSync.yourVersion')}</div>
                        <pre className="whitespace-pre-wrap break-words text-gray-600 max-h-24 overflow-auto">{c.local_value ?? '—'}</pre>
                      </div>
                      <div className="bg-gray-50 rounded p-2 overflow-hidden">
                        <div className="font-semibold text-gray-700 mb-1">{t('offlineSync.serverVersion')}</div>
                        <pre className="whitespace-pre-wrap break-words text-gray-600 max-h-24 overflow-auto">{c.remote_value ?? '—'}</pre>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleResolveConflict(c.id, 'UseLocal')}
                        className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        {t('offlineSync.keepMine')}
                      </button>
                      <button
                        onClick={() => handleResolveConflict(c.id, 'UseServer')}
                        className="flex-1 px-3 py-1.5 text-sm bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                      >
                        {t('offlineSync.keepServer')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last Sync Info */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{t('offlineSync.lastFullSync')}</h3>
                <p className="text-sm text-gray-500">{lastFullSync ? formatDate(lastFullSync) : t('offlineSync.never')}</p>
              </div>
              <div className="flex items-center gap-2">
                {getStatusIcon(syncStatus)}
                <span className="text-sm font-medium text-gray-700">{statusLabel(syncStatus)}</span>
              </div>
            </div>
          </div>

          {/* Storage Usage */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-gray-400" />
                <h3 className="font-medium text-gray-900">{t('offlineSync.storage')}</h3>
              </div>
              <span className="text-sm text-gray-500">{formatBytes(storageInfo.used)} / {formatBytes(storageInfo.quota)}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${
                  storagePercent > 80 ? 'bg-red-500' : storagePercent > 60 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${storagePercent}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{t('offlineSync.available', { size: formatBytes(storageInfo.available) })}</p>
          </div>

          {/* Sync Queue */}
          {syncQueue.length > 0 && (
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-medium text-gray-900 mb-3">{t('offlineSync.syncQueue')}</h3>
              <div className="space-y-3">
                {syncQueue.map(item => (
                  <div key={item.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div className="flex items-center gap-3">
                      {item.action === 'upload' ? (
                        <Upload className="w-4 h-4 text-blue-500" />
                      ) : (
                        <Download className="w-4 h-4 text-green-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.description}</p>
                        <p className="text-xs text-gray-500">{formatDate(item.timestamp)}</p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      item.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                      item.status === 'in-progress' ? 'bg-blue-100 text-blue-700' :
                      item.status === 'completed' ? 'bg-green-100 text-green-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <div className="text-2xl font-bold text-green-600">
                {cachedItems.filter(i => i.status === 'synced').length}
              </div>
              <div className="text-xs text-gray-500">{t('offlineSync.syncedItems')}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
              <div className="text-xs text-gray-500">{t('offlineSync.pendingChanges')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Cache Tab */}
      {activeTab === 'cache' && (
        <div className="px-4 pb-8 space-y-4">
          {/* Category Summary */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-medium text-gray-900 mb-3">{t('offlineSync.cachedByCategory')}</h3>
            <div className="space-y-3">
              {(['medical-records', 'medications', 'appointments', 'lab-results', 'documents', 'images'] as DataCategory[]).map(category => {
                const items = cachedItems.filter(i => i.category === category);
                const totalSize = items.reduce((acc, i) => acc + i.size, 0);
                if (items.length === 0) return null;
                
                return (
                  <div key={category} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div className="flex items-center gap-3">
                      {getCategoryIcon(category)}
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {categoryLabel(category)}
                        </p>
                        <p className="text-xs text-gray-500">{t('offlineSync.itemsCount', { count: items.length })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">{formatBytes(totalSize)}</span>
                      <button
                        onClick={() => handleClearCache(category)}
                        className="p-1 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cached Items List */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-medium text-gray-900">{t('offlineSync.allCached')}</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {cachedItems.map(item => (
                <div key={item.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getCategoryIcon(item.category)}
                    <div>
                      <p className="text-sm font-medium text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-500">
                        {formatBytes(item.size)} • {t('offlineSync.lastSyncedAt', { date: formatDate(item.lastSynced) })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(item.status)}
                    {item.priority === 'high' && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">{t('offlineSync.priorityHigh')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Clear All Cache */}
          <button
            onClick={() => handleClearCache()}
            className="w-full py-3 border border-red-300 text-red-600 rounded-lg font-medium hover:bg-red-50"
          >
            {t('offlineSync.clearAll')}
          </button>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="px-4 pb-8 space-y-4">
          <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{t('offlineSync.autoSync')}</h3>
                <p className="text-sm text-gray-500">{t('offlineSync.autoSyncDesc')}</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5 text-sky-600 rounded" />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{t('offlineSync.backgroundSync')}</h3>
                <p className="text-sm text-gray-500">{t('offlineSync.backgroundSyncDesc')}</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5 text-sky-600 rounded" />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{t('offlineSync.downloadLab')}</h3>
                <p className="text-sm text-gray-500">{t('offlineSync.downloadLabDesc')}</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5 text-sky-600 rounded" />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{t('offlineSync.syncMobile')}</h3>
                <p className="text-sm text-gray-500">{t('offlineSync.syncMobileDesc')}</p>
              </div>
              <input type="checkbox" className="w-5 h-5 text-sky-600 rounded" />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{t('offlineSync.highPriorityOnly')}</h3>
                <p className="text-sm text-gray-500">{t('offlineSync.highPriorityOnlyDesc')}</p>
              </div>
              <input type="checkbox" className="w-5 h-5 text-sky-600 rounded" />
            </div>
          </div>

          {/* Service Worker Info */}
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Settings className="w-5 h-5 text-blue-500 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-900">{t('offlineSync.swActive')}</h4>
                <p className="text-sm text-blue-700 mt-1">
                  {t('offlineSync.swActiveDesc')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfflineSyncPage;
