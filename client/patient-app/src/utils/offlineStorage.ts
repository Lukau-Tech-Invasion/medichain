/**
 * Offline Storage Module
 * 
 * IndexedDB-based storage for offline data synchronization.
 * Provides persistent storage for medical records, appointments,
 * medications, and other health data when the user is offline.
 */

const DB_NAME = 'medichain-offline';
const DB_VERSION = 1;

// Store names
const STORES = {
  CACHED_DATA: 'cached_data',
  SYNC_QUEUE: 'sync_queue',
  METADATA: 'metadata'
} as const;

export type DataCategory = 
  | 'medical-records' 
  | 'appointments' 
  | 'medications' 
  | 'lab-results' 
  | 'documents' 
  | 'images'
  | 'allergies'
  | 'vitals'
  | 'immunizations';

export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'error' | 'offline';

export interface CachedItem {
  id: string;
  category: DataCategory;
  name: string;
  data: unknown;
  size: number;
  lastSynced: string;
  status: SyncStatus;
  priority: 'high' | 'medium' | 'low';
  patientId?: string;
}

export interface SyncQueueItem {
  id: string;
  action: 'upload' | 'download';
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  description: string;
  timestamp: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  retryCount: number;
  maxRetries: number;
  error?: string;
}

export interface StorageMetadata {
  lastFullSync: string;
  version: number;
  patientId: string;
}

/**
 * Open the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create cached_data store
      if (!db.objectStoreNames.contains(STORES.CACHED_DATA)) {
        const cachedStore = db.createObjectStore(STORES.CACHED_DATA, { keyPath: 'id' });
        cachedStore.createIndex('category', 'category', { unique: false });
        cachedStore.createIndex('patientId', 'patientId', { unique: false });
        cachedStore.createIndex('status', 'status', { unique: false });
        cachedStore.createIndex('lastSynced', 'lastSynced', { unique: false });
      }

      // Create sync_queue store
      if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id' });
        syncStore.createIndex('status', 'status', { unique: false });
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Create metadata store
      if (!db.objectStoreNames.contains(STORES.METADATA)) {
        db.createObjectStore(STORES.METADATA, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Get all cached items
 */
export async function getCachedItems(): Promise<CachedItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CACHED_DATA, 'readonly');
    const store = tx.objectStore(STORES.CACHED_DATA);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error('Failed to get cached items'));
    };
  });
}

/**
 * Get cached items by category
 */
export async function getCachedItemsByCategory(category: DataCategory): Promise<CachedItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CACHED_DATA, 'readonly');
    const store = tx.objectStore(STORES.CACHED_DATA);
    const index = store.index('category');
    const request = index.getAll(category);

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error('Failed to get cached items by category'));
    };
  });
}

/**
 * Save a cached item
 */
export async function saveCachedItem(item: CachedItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CACHED_DATA, 'readwrite');
    const store = tx.objectStore(STORES.CACHED_DATA);
    const request = store.put(item);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to save cached item'));
    };
  });
}

/**
 * Delete a cached item
 */
export async function deleteCachedItem(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CACHED_DATA, 'readwrite');
    const store = tx.objectStore(STORES.CACHED_DATA);
    const request = store.delete(id);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to delete cached item'));
    };
  });
}

/**
 * Clear all cached items
 */
export async function clearAllCachedItems(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CACHED_DATA, 'readwrite');
    const store = tx.objectStore(STORES.CACHED_DATA);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to clear cached items'));
    };
  });
}

/**
 * Get sync queue items
 */
export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SYNC_QUEUE, 'readonly');
    const store = tx.objectStore(STORES.SYNC_QUEUE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error('Failed to get sync queue'));
    };
  });
}

/**
 * Get pending sync queue items
 */
export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SYNC_QUEUE, 'readonly');
    const store = tx.objectStore(STORES.SYNC_QUEUE);
    const index = store.index('status');
    const request = index.getAll('pending');

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error('Failed to get pending sync items'));
    };
  });
}

/**
 * Add item to sync queue
 */
export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'timestamp' | 'retryCount' | 'status'>): Promise<SyncQueueItem> {
  const db = await openDB();
  const syncItem: SyncQueueItem = {
    ...item,
    id: `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    status: 'pending',
    retryCount: 0
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.SYNC_QUEUE);
    const request = store.put(syncItem);

    request.onsuccess = () => {
      resolve(syncItem);
    };

    request.onerror = () => {
      reject(new Error('Failed to add to sync queue'));
    };
  });
}

/**
 * Update sync queue item
 */
export async function updateSyncQueueItem(item: SyncQueueItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.SYNC_QUEUE);
    const request = store.put(item);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to update sync queue item'));
    };
  });
}

/**
 * Remove item from sync queue
 */
export async function removeFromSyncQueue(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.SYNC_QUEUE);
    const request = store.delete(id);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to remove from sync queue'));
    };
  });
}

/**
 * Clear completed sync items
 */
export async function clearCompletedSyncItems(): Promise<void> {
  const items = await getSyncQueue();
  const completedIds = items
    .filter(item => item.status === 'completed')
    .map(item => item.id);

  const db = await openDB();
  const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
  const store = tx.objectStore(STORES.SYNC_QUEUE);

  for (const id of completedIds) {
    store.delete(id);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('Failed to clear completed sync items'));
  });
}

/**
 * Get storage metadata
 */
export async function getStorageMetadata(): Promise<StorageMetadata | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.METADATA, 'readonly');
    const store = tx.objectStore(STORES.METADATA);
    const request = store.get('metadata');

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.value);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      reject(new Error('Failed to get storage metadata'));
    };
  });
}

/**
 * Update storage metadata
 */
export async function updateStorageMetadata(metadata: Partial<StorageMetadata>): Promise<void> {
  const db = await openDB();
  const existing = await getStorageMetadata();
  const updated = {
    ...existing,
    ...metadata,
    lastFullSync: metadata.lastFullSync || existing?.lastFullSync || new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.METADATA, 'readwrite');
    const store = tx.objectStore(STORES.METADATA);
    const request = store.put({ key: 'metadata', value: updated });

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to update storage metadata'));
    };
  });
}

/**
 * Get storage usage estimate
 */
export async function getStorageUsage(): Promise<{ used: number; available: number; quota: number }> {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage || 0,
        available: (estimate.quota || 0) - (estimate.usage || 0),
        quota: estimate.quota || 0
      };
    } catch {
      // Fallback to estimate from cached items
    }
  }

  // Fallback: estimate from cached items
  const items = await getCachedItems();
  const used = items.reduce((total, item) => total + item.size, 0);
  return {
    used,
    available: 50 * 1024 * 1024 - used, // Assume 50MB quota
    quota: 50 * 1024 * 1024
  };
}

/**
 * Cache medical records for offline access
 */
export async function cacheMedicalRecords(patientId: string, records: unknown[]): Promise<void> {
  const item: CachedItem = {
    id: `medical-records-${patientId}`,
    category: 'medical-records',
    name: 'Medical History Summary',
    data: records,
    size: JSON.stringify(records).length,
    lastSynced: new Date().toISOString(),
    status: 'synced',
    priority: 'high',
    patientId
  };
  await saveCachedItem(item);
}

/**
 * Cache appointments for offline access
 */
export async function cacheAppointments(patientId: string, appointments: unknown[]): Promise<void> {
  const item: CachedItem = {
    id: `appointments-${patientId}`,
    category: 'appointments',
    name: 'Upcoming Appointments',
    data: appointments,
    size: JSON.stringify(appointments).length,
    lastSynced: new Date().toISOString(),
    status: 'synced',
    priority: 'high',
    patientId
  };
  await saveCachedItem(item);
}

/**
 * Cache medications for offline access
 */
export async function cacheMedications(patientId: string, medications: unknown[]): Promise<void> {
  const item: CachedItem = {
    id: `medications-${patientId}`,
    category: 'medications',
    name: 'Current Medications List',
    data: medications,
    size: JSON.stringify(medications).length,
    lastSynced: new Date().toISOString(),
    status: 'synced',
    priority: 'high',
    patientId
  };
  await saveCachedItem(item);
}

/**
 * Cache lab results for offline access
 */
export async function cacheLabResults(patientId: string, results: unknown[]): Promise<void> {
  const item: CachedItem = {
    id: `lab-results-${patientId}`,
    category: 'lab-results',
    name: 'Recent Lab Results',
    data: results,
    size: JSON.stringify(results).length,
    lastSynced: new Date().toISOString(),
    status: 'synced',
    priority: 'medium',
    patientId
  };
  await saveCachedItem(item);
}

/**
 * Get cached medical records
 */
export async function getCachedMedicalRecords(patientId: string): Promise<unknown[] | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CACHED_DATA, 'readonly');
    const store = tx.objectStore(STORES.CACHED_DATA);
    const request = store.get(`medical-records-${patientId}`);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.data);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      reject(new Error('Failed to get cached medical records'));
    };
  });
}

/**
 * Sync manager - process pending sync items
 */
export async function processSyncQueue(): Promise<{ success: number; failed: number }> {
  const pending = await getPendingSyncItems();
  let success = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      // Update status to in-progress
      await updateSyncQueueItem({ ...item, status: 'in-progress' });

      // Attempt the sync operation
      const response = await fetch(item.endpoint, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: item.body ? JSON.stringify(item.body) : undefined
      });

      if (response.ok) {
        // Mark as completed
        await updateSyncQueueItem({ ...item, status: 'completed' });
        success++;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      // Increment retry count or mark as failed
      const newRetryCount = item.retryCount + 1;
      if (newRetryCount >= item.maxRetries) {
        await updateSyncQueueItem({
          ...item,
          status: 'failed',
          retryCount: newRetryCount,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        failed++;
      } else {
        await updateSyncQueueItem({
          ...item,
          status: 'pending',
          retryCount: newRetryCount
        });
      }
    }
  }

  return { success, failed };
}

/**
 * Initialize offline storage with sample data for demo
 */
export async function initializeDemoData(patientId: string): Promise<void> {
  const items: CachedItem[] = [
    { 
      id: `medical-records-${patientId}`, 
      category: 'medical-records', 
      name: 'Medical History Summary', 
      data: [], 
      size: 256000, 
      lastSynced: new Date().toISOString(), 
      status: 'synced', 
      priority: 'high',
      patientId 
    },
    { 
      id: `medications-${patientId}`, 
      category: 'medications', 
      name: 'Current Medications List', 
      data: [], 
      size: 12000, 
      lastSynced: new Date().toISOString(), 
      status: 'synced', 
      priority: 'high',
      patientId 
    },
    { 
      id: `appointments-${patientId}`, 
      category: 'appointments', 
      name: 'Upcoming Appointments', 
      data: [], 
      size: 8000, 
      lastSynced: new Date().toISOString(), 
      status: 'synced', 
      priority: 'high',
      patientId 
    },
    { 
      id: `lab-results-${patientId}`, 
      category: 'lab-results', 
      name: 'Recent Lab Results', 
      data: [], 
      size: 145000, 
      lastSynced: new Date(Date.now() - 3600000).toISOString(), 
      status: 'pending', 
      priority: 'medium',
      patientId 
    },
    { 
      id: `documents-insurance-${patientId}`, 
      category: 'documents', 
      name: 'Insurance Cards', 
      data: [], 
      size: 320000, 
      lastSynced: new Date(Date.now() - 86400000).toISOString(), 
      status: 'synced', 
      priority: 'medium',
      patientId 
    },
    { 
      id: `allergies-${patientId}`, 
      category: 'allergies', 
      name: 'Allergy Information', 
      data: [], 
      size: 5000, 
      lastSynced: new Date().toISOString(), 
      status: 'synced', 
      priority: 'high',
      patientId 
    },
    { 
      id: `immunizations-${patientId}`, 
      category: 'immunizations', 
      name: 'Vaccination Records', 
      data: [], 
      size: 95000, 
      lastSynced: new Date(Date.now() - 172800000).toISOString(), 
      status: 'synced', 
      priority: 'medium',
      patientId 
    }
  ];

  for (const item of items) {
    await saveCachedItem(item);
  }

  // Initialize metadata
  await updateStorageMetadata({
    lastFullSync: new Date().toISOString(),
    version: 1,
    patientId
  });
}
