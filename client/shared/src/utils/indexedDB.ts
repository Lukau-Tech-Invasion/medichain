/**
 * IndexedDB Storage Service for MediChain
 * 
 * Provides persistent offline storage for:
 * - Medical records cache
 * - Sync queue for pending operations
 * - User preferences
 * - Cached documents
 */

const DB_NAME = 'MediChainOfflineDB';
const DB_VERSION = 1;

// Store names
export const STORES = {
  SYNC_QUEUE: 'syncQueue',
  CACHED_DATA: 'cachedData',
  DOCUMENTS: 'documents',
  USER_PREFS: 'userPreferences',
} as const;

export type StoreName = typeof STORES[keyof typeof STORES];

export interface SyncQueueItem {
  id: string;
  action: 'upload' | 'download' | 'update' | 'delete';
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  category: 'medical-records' | 'appointments' | 'medications' | 'lab-results' | 'documents' | 'images';
  description: string;
  timestamp: number;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  retryCount: number;
  priority: 'high' | 'medium' | 'low';
  patientId?: string;
  error?: string;
}

export interface CachedDataItem {
  id: string;
  category: string;
  name: string;
  data: unknown;
  size: number;
  lastSynced: number;
  expiresAt: number;
  priority: 'high' | 'medium' | 'low';
}

export interface CachedDocument {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  size: number;
  uploadedAt: number;
  ipfsHash?: string;
}

let dbInstance: IDBDatabase | null = null;

/**
 * Open IndexedDB connection
 */
export async function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[IndexedDB] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      console.log('[IndexedDB] Database opened successfully');
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      console.log('[IndexedDB] Upgrading database...');

      // Sync Queue store
      if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id' });
        syncStore.createIndex('status', 'status', { unique: false });
        syncStore.createIndex('category', 'category', { unique: false });
        syncStore.createIndex('priority', 'priority', { unique: false });
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Cached Data store
      if (!db.objectStoreNames.contains(STORES.CACHED_DATA)) {
        const cacheStore = db.createObjectStore(STORES.CACHED_DATA, { keyPath: 'id' });
        cacheStore.createIndex('category', 'category', { unique: false });
        cacheStore.createIndex('expiresAt', 'expiresAt', { unique: false });
      }

      // Documents store
      if (!db.objectStoreNames.contains(STORES.DOCUMENTS)) {
        const docStore = db.createObjectStore(STORES.DOCUMENTS, { keyPath: 'id' });
        docStore.createIndex('type', 'type', { unique: false });
      }

      // User Preferences store
      if (!db.objectStoreNames.contains(STORES.USER_PREFS)) {
        db.createObjectStore(STORES.USER_PREFS, { keyPath: 'key' });
      }

      console.log('[IndexedDB] Database upgrade complete');
    };
  });
}

/**
 * Generic function to add item to a store
 */
export async function addItem<T>(storeName: StoreName, item: T): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.add(item);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Generic function to update item in a store
 */
export async function updateItem<T>(storeName: StoreName, item: T): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get item by key
 */
export async function getItem<T>(storeName: StoreName, key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all items from a store
 */
export async function getAllItems<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete item by key
 */
export async function deleteItem(storeName: StoreName, key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all items from a store
 */
export async function clearStore(storeName: StoreName): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get items by index
 */
export async function getByIndex<T>(
  storeName: StoreName,
  indexName: string,
  value: IDBValidKey
): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);

    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

// ============================================================================
// Sync Queue Operations
// ============================================================================

/**
 * Add item to sync queue
 */
export async function enqueueSyncItem(
  item: Omit<SyncQueueItem, 'id' | 'timestamp' | 'status' | 'retryCount'>
): Promise<string> {
  const id = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const queueItem: SyncQueueItem = {
    ...item,
    id,
    timestamp: Date.now(),
    status: 'pending',
    retryCount: 0,
  };
  await addItem(STORES.SYNC_QUEUE, queueItem);
  console.log(`[IndexedDB] Enqueued sync item: ${id}`);
  return id;
}

/**
 * Get all pending sync items
 */
export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  return getByIndex<SyncQueueItem>(STORES.SYNC_QUEUE, 'status', 'pending');
}

/**
 * Get all sync queue items
 */
export async function getAllSyncItems(): Promise<SyncQueueItem[]> {
  return getAllItems<SyncQueueItem>(STORES.SYNC_QUEUE);
}

/**
 * Update sync item status
 */
export async function updateSyncStatus(
  id: string,
  status: SyncQueueItem['status'],
  error?: string
): Promise<void> {
  const item = await getItem<SyncQueueItem>(STORES.SYNC_QUEUE, id);
  if (item) {
    item.status = status;
    if (error) item.error = error;
    if (status === 'failed') item.retryCount++;
    await updateItem(STORES.SYNC_QUEUE, item);
  }
}

/**
 * Remove completed sync items
 */
export async function clearCompletedSyncItems(): Promise<number> {
  const items = await getAllSyncItems();
  let removed = 0;
  for (const item of items) {
    if (item.status === 'completed') {
      await deleteItem(STORES.SYNC_QUEUE, item.id);
      removed++;
    }
  }
  return removed;
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Cache data with expiration
 */
export async function cacheData(
  id: string,
  category: string,
  name: string,
  data: unknown,
  ttlMs: number = 24 * 60 * 60 * 1000, // Default 24 hours
  priority: 'high' | 'medium' | 'low' = 'medium'
): Promise<void> {
  const item: CachedDataItem = {
    id,
    category,
    name,
    data,
    size: JSON.stringify(data).length,
    lastSynced: Date.now(),
    expiresAt: Date.now() + ttlMs,
    priority,
  };
  await updateItem(STORES.CACHED_DATA, item);
  console.log(`[IndexedDB] Cached: ${category}/${name}`);
}

/**
 * Get cached data if not expired
 */
export async function getCachedData<T>(id: string): Promise<T | null> {
  const item = await getItem<CachedDataItem>(STORES.CACHED_DATA, id);
  if (!item) return null;
  
  if (Date.now() > item.expiresAt) {
    await deleteItem(STORES.CACHED_DATA, id);
    return null;
  }
  
  return item.data as T;
}

/**
 * Get all cached items (for display)
 */
export async function getAllCachedItems(): Promise<CachedDataItem[]> {
  return getAllItems<CachedDataItem>(STORES.CACHED_DATA);
}

/**
 * Clear expired cache entries
 */
export async function clearExpiredCache(): Promise<number> {
  const items = await getAllCachedItems();
  const now = Date.now();
  let removed = 0;
  
  for (const item of items) {
    if (now > item.expiresAt) {
      await deleteItem(STORES.CACHED_DATA, item.id);
      removed++;
    }
  }
  
  return removed;
}

// ============================================================================
// Storage Info
// ============================================================================

/**
 * Get storage usage information
 */
export async function getStorageInfo(): Promise<{
  used: number;
  available: number;
  quota: number;
  syncQueueSize: number;
  cachedItemsSize: number;
  documentsSize: number;
}> {
  let used = 0;
  let available = 0;
  let quota = 0;

  // Try to get storage estimate
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    used = estimate.usage || 0;
    quota = estimate.quota || 50 * 1024 * 1024; // Default 50MB
    available = quota - used;
  }

  // Get per-store sizes
  const syncItems = await getAllSyncItems();
  const cachedItems = await getAllCachedItems();
  const documents = await getAllItems<CachedDocument>(STORES.DOCUMENTS);

  const syncQueueSize = syncItems.reduce((acc, item) => acc + JSON.stringify(item).length, 0);
  const cachedItemsSize = cachedItems.reduce((acc, item) => acc + item.size, 0);
  const documentsSize = documents.reduce((acc, doc) => acc + doc.size, 0);

  return {
    used,
    available,
    quota,
    syncQueueSize,
    cachedItemsSize,
    documentsSize,
  };
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    console.log('[IndexedDB] Database closed');
  }
}
