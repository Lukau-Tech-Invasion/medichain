import React, { useState, useEffect } from 'react';
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
  Shield
} from 'lucide-react';

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

const OfflineSyncPage: React.FC = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [isSyncing, setIsSyncing] = useState(false);
  const [cachedItems, setCachedItems] = useState<CachedItem[]>([]);
  const [syncQueue, setSyncQueue] = useState<SyncQueue[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo>({ used: 0, available: 0, quota: 0 });
  const [lastFullSync, setLastFullSync] = useState<string>('2025-01-15T10:30:00Z');
  const [activeTab, setActiveTab] = useState<'status' | 'cache' | 'settings'>('status');

  useEffect(() => {
    // Monitor online/offline status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Sample cached items
    const items: CachedItem[] = [
      { id: '1', category: 'medical-records', name: 'Medical History Summary', size: 256000, lastSynced: '2025-01-15T10:30:00Z', status: 'synced', priority: 'high' },
      { id: '2', category: 'medications', name: 'Current Medications List', size: 12000, lastSynced: '2025-01-15T10:30:00Z', status: 'synced', priority: 'high' },
      { id: '3', category: 'appointments', name: 'Upcoming Appointments', size: 8000, lastSynced: '2025-01-15T10:30:00Z', status: 'synced', priority: 'high' },
      { id: '4', category: 'lab-results', name: 'Recent Lab Results', size: 145000, lastSynced: '2025-01-15T09:00:00Z', status: 'pending', priority: 'medium' },
      { id: '5', category: 'documents', name: 'Insurance Cards', size: 320000, lastSynced: '2025-01-14T15:00:00Z', status: 'synced', priority: 'medium' },
      { id: '6', category: 'images', name: 'Profile Photo', size: 180000, lastSynced: '2025-01-10T12:00:00Z', status: 'synced', priority: 'low' },
      { id: '7', category: 'documents', name: 'Vaccination Records', size: 95000, lastSynced: '2025-01-12T08:00:00Z', status: 'synced', priority: 'medium' },
      { id: '8', category: 'medical-records', name: 'Allergy Information', size: 5000, lastSynced: '2025-01-15T10:30:00Z', status: 'synced', priority: 'high' }
    ];
    setCachedItems(items);

    // Sample sync queue
    const queue: SyncQueue[] = [
      { id: 'q1', action: 'upload', description: 'Symptom diary entry', timestamp: '2025-01-15T11:00:00Z', status: 'pending', retryCount: 0 },
      { id: 'q2', action: 'download', description: 'Lab results update', timestamp: '2025-01-15T10:45:00Z', status: 'pending', retryCount: 0 }
    ];
    setSyncQueue(queue);

    // Estimate storage
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(estimate => {
        setStorageInfo({
          used: estimate.usage || 2500000,
          available: (estimate.quota || 50000000) - (estimate.usage || 2500000),
          quota: estimate.quota || 50000000
        });
      });
    } else {
      setStorageInfo({ used: 2500000, available: 47500000, quota: 50000000 });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

  const handleSync = () => {
    if (!isOnline) return;
    setIsSyncing(true);
    setSyncStatus('syncing');
    
    // Simulate sync
    setTimeout(() => {
      setIsSyncing(false);
      setSyncStatus('synced');
      setLastFullSync(new Date().toISOString());
      setSyncQueue([]);
      setCachedItems(prev => prev.map(item => ({ ...item, status: 'synced' as SyncStatus, lastSynced: new Date().toISOString() })));
    }, 2000);
  };

  const handleClearCache = (category?: DataCategory) => {
    if (category) {
      setCachedItems(prev => prev.filter(item => item.category !== category));
    } else {
      setCachedItems([]);
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className={`bg-gradient-to-r ${isOnline ? 'from-sky-600 to-blue-500' : 'from-gray-600 to-gray-500'} text-white p-6 transition-colors`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            {isOnline ? <Cloud className="w-8 h-8" /> : <CloudOff className="w-8 h-8" />}
            <h1 className="text-2xl font-bold">Offline Sync</h1>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${isOnline ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
            {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            <span className="text-sm font-medium">{isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
        <p className="text-sky-100">Manage your offline data and synchronization</p>
      </div>

      {/* Sync Button */}
      <div className="p-4 -mt-4">
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
          {isSyncing ? 'Syncing...' : 'Sync Now'}
          {pendingCount > 0 && (
            <span className="bg-yellow-500 text-white text-xs px-2 py-0.5 rounded-full">
              {pendingCount} pending
            </span>
          )}
        </button>
      </div>

      {/* Tabs */}
      <div className="px-4 mb-4">
        <div className="bg-white rounded-lg shadow p-1 flex">
          {[
            { id: 'status', label: 'Status' },
            { id: 'cache', label: 'Cache' },
            { id: 'settings', label: 'Settings' }
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
          {/* Last Sync Info */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">Last Full Sync</h3>
                <p className="text-sm text-gray-500">{formatDate(lastFullSync)}</p>
              </div>
              <div className="flex items-center gap-2">
                {getStatusIcon(syncStatus)}
                <span className="text-sm font-medium text-gray-700 capitalize">{syncStatus}</span>
              </div>
            </div>
          </div>

          {/* Storage Usage */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-gray-400" />
                <h3 className="font-medium text-gray-900">Storage</h3>
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
            <p className="text-xs text-gray-500 mt-2">{formatBytes(storageInfo.available)} available</p>
          </div>

          {/* Sync Queue */}
          {syncQueue.length > 0 && (
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-medium text-gray-900 mb-3">Sync Queue</h3>
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
                      {item.status}
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
              <div className="text-xs text-gray-500">Synced Items</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
              <div className="text-xs text-gray-500">Pending Changes</div>
            </div>
          </div>
        </div>
      )}

      {/* Cache Tab */}
      {activeTab === 'cache' && (
        <div className="px-4 pb-8 space-y-4">
          {/* Category Summary */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-medium text-gray-900 mb-3">Cached Data by Category</h3>
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
                        <p className="text-sm font-medium text-gray-900 capitalize">
                          {category.replace('-', ' ')}
                        </p>
                        <p className="text-xs text-gray-500">{items.length} items</p>
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
              <h3 className="font-medium text-gray-900">All Cached Items</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {cachedItems.map(item => (
                <div key={item.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getCategoryIcon(item.category)}
                    <div>
                      <p className="text-sm font-medium text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-500">
                        {formatBytes(item.size)} • Last synced {formatDate(item.lastSynced)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(item.status)}
                    {item.priority === 'high' && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">High</span>
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
            Clear All Cached Data
          </button>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="px-4 pb-8 space-y-4">
          <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">Auto-Sync</h3>
                <p className="text-sm text-gray-500">Sync when connected to WiFi</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5 text-sky-600 rounded" />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">Background Sync</h3>
                <p className="text-sm text-gray-500">Sync data in background</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5 text-sky-600 rounded" />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">Download Lab Results</h3>
                <p className="text-sm text-gray-500">Cache for offline viewing</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5 text-sky-600 rounded" />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">Sync on Mobile Data</h3>
                <p className="text-sm text-gray-500">May use cellular data</p>
              </div>
              <input type="checkbox" className="w-5 h-5 text-sky-600 rounded" />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">High Priority Only</h3>
                <p className="text-sm text-gray-500">Only cache essential data</p>
              </div>
              <input type="checkbox" className="w-5 h-5 text-sky-600 rounded" />
            </div>
          </div>

          {/* Service Worker Info */}
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Settings className="w-5 h-5 text-blue-500 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-900">Service Worker Active</h4>
                <p className="text-sm text-blue-700 mt-1">
                  Your app is configured for offline use. Essential features will work without an internet connection.
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
