/**
 * Offline Queue Service for MediChain Mobile
 * 
 * Queues operations when offline and automatically retries when connection is restored.
 * Persists queue to AsyncStorage for durability across app restarts.
 * 
 * @see COMPREHENSIVE_CONNECTION_ANALYSIS.md Section 8.3
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

/**
 * Represents a queued operation waiting to be executed
 */
export interface QueuedOperation {
  /** Unique identifier for this operation */
  id: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** API endpoint path */
  endpoint: string;
  /** Request body (for POST/PUT/PATCH) */
  body?: unknown;
  /** When the operation was queued */
  timestamp: number;
  /** Number of retry attempts */
  retries: number;
  /** Maximum retries before giving up */
  maxRetries: number;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Human-readable description */
  description?: string;
}

/**
 * Configuration for the offline queue
 */
export interface OfflineQueueConfig {
  /** Storage key for persisting queue */
  storageKey?: string;
  /** Maximum operations in queue */
  maxQueueSize?: number;
  /** Maximum retries per operation */
  defaultMaxRetries?: number;
  /** Delay between processing operations (ms) */
  processDelay?: number;
  /** API base URL */
  apiBaseUrl: string;
  /** Function to get auth headers */
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const DEFAULT_CONFIG: Partial<OfflineQueueConfig> = {
  storageKey: 'medichain_offline_queue',
  maxQueueSize: 100,
  defaultMaxRetries: 3,
  processDelay: 1000,
};

/**
 * Offline Queue Manager
 * 
 * Handles queuing, persisting, and retrying API operations when offline.
 * 
 * @example
 * ```typescript
 * const queue = new OfflineQueue({
 *   apiBaseUrl: 'http://192.168.1.100:8080',
 *   getAuthHeaders: async () => ({
 *     'X-User-Id': await SecureStore.getItemAsync('user_id') || ''
 *   })
 * });
 * 
 * await queue.initialize();
 * 
 * // Queue an operation
 * await queue.enqueue({
 *   method: 'POST',
 *   endpoint: '/api/patients',
 *   body: { name: 'John Doe' },
 *   description: 'Register new patient'
 * });
 * ```
 */
export class OfflineQueue {
  private queue: QueuedOperation[] = [];
  private isProcessing = false;
  private isOnline = true;
  private unsubscribeNetInfo: (() => void) | null = null;
  private config: Required<OfflineQueueConfig>;

  constructor(config: OfflineQueueConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<OfflineQueueConfig>;
  }

  /**
   * Initialize the queue - must be called before use
   * Loads persisted queue and starts network monitoring
   */
  async initialize(): Promise<void> {
    // Load persisted queue
    await this.loadQueue();

    // Start network monitoring
    this.unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected ?? false;

      console.log(`[OfflineQueue] Network state changed: ${this.isOnline ? 'online' : 'offline'}`);

      // If we just came online, process the queue
      if (wasOffline && this.isOnline) {
        console.log('[OfflineQueue] Connection restored, processing queue...');
        this.processQueue();
      }
    });

    // Check initial state
    const initialState = await NetInfo.fetch();
    this.isOnline = initialState.isConnected ?? false;

    // Process any pending operations if online
    if (this.isOnline && this.queue.length > 0) {
      this.processQueue();
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }
  }

  /**
   * Add an operation to the queue
   */
  async enqueue(operation: Omit<QueuedOperation, 'id' | 'timestamp' | 'retries' | 'maxRetries'> & { maxRetries?: number }): Promise<string> {
    const id = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const queuedOp: QueuedOperation = {
      id,
      method: operation.method,
      endpoint: operation.endpoint,
      body: operation.body,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: operation.maxRetries ?? this.config.defaultMaxRetries,
      priority: operation.priority ?? 5,
      description: operation.description,
    };

    // Check queue size limit
    if (this.queue.length >= this.config.maxQueueSize) {
      console.warn('[OfflineQueue] Queue full, removing oldest operation');
      this.queue.shift();
    }

    // Add to queue sorted by priority
    this.queue.push(queuedOp);
    this.queue.sort((a, b) => a.priority - b.priority);

    // Persist
    await this.saveQueue();

    console.log(`[OfflineQueue] Enqueued: ${operation.description || operation.endpoint} (${id})`);

    // Try to process immediately if online
    if (this.isOnline && !this.isProcessing) {
      this.processQueue();
    }

    return id;
  }

  /**
   * Remove an operation from the queue
   */
  async dequeue(id: string): Promise<boolean> {
    const index = this.queue.findIndex(op => op.id === id);
    if (index === -1) return false;

    this.queue.splice(index, 1);
    await this.saveQueue();
    return true;
  }

  /**
   * Get all pending operations
   */
  getPendingOperations(): QueuedOperation[] {
    return [...this.queue];
  }

  /**
   * Get queue statistics
   */
  getStats(): { pending: number; isProcessing: boolean; isOnline: boolean } {
    return {
      pending: this.queue.length,
      isProcessing: this.isProcessing,
      isOnline: this.isOnline,
    };
  }

  /**
   * Clear all pending operations
   */
  async clear(): Promise<void> {
    this.queue = [];
    await this.saveQueue();
    console.log('[OfflineQueue] Queue cleared');
  }

  /**
   * Process all queued operations
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || !this.isOnline || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    console.log(`[OfflineQueue] Processing ${this.queue.length} operations...`);

    while (this.queue.length > 0 && this.isOnline) {
      const operation = this.queue[0];

      try {
        await this.executeOperation(operation);
        
        // Success - remove from queue
        this.queue.shift();
        await this.saveQueue();
        console.log(`[OfflineQueue] Completed: ${operation.description || operation.endpoint}`);
      } catch (error) {
        operation.retries++;

        if (operation.retries >= operation.maxRetries) {
          // Max retries exceeded - remove and log failure
          this.queue.shift();
          await this.saveQueue();
          console.error(`[OfflineQueue] Failed after ${operation.retries} retries:`, operation.description || operation.endpoint);
          
          // You could emit an event or call a callback here for failed operations
        } else {
          // Move to end of queue for retry
          this.queue.shift();
          this.queue.push(operation);
          await this.saveQueue();
          console.warn(`[OfflineQueue] Retry ${operation.retries}/${operation.maxRetries}: ${operation.description || operation.endpoint}`);
        }
      }

      // Delay between operations
      await this.delay(this.config.processDelay);
    }

    this.isProcessing = false;
  }

  /**
   * Execute a single operation
   */
  private async executeOperation(operation: QueuedOperation): Promise<void> {
    const url = `${this.config.apiBaseUrl}${operation.endpoint}`;
    const headers = await this.config.getAuthHeaders();

    const response = await fetch(url, {
      method: operation.method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: operation.body ? JSON.stringify(operation.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  /**
   * Load queue from persistent storage
   */
  private async loadQueue(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(this.config.storageKey);
      if (stored) {
        this.queue = JSON.parse(stored);
        console.log(`[OfflineQueue] Loaded ${this.queue.length} pending operations`);
      }
    } catch (error) {
      console.error('[OfflineQueue] Failed to load queue:', error);
      this.queue = [];
    }
  }

  /**
   * Save queue to persistent storage
   */
  private async saveQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(this.config.storageKey, JSON.stringify(this.queue));
    } catch (error) {
      console.error('[OfflineQueue] Failed to save queue:', error);
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let queueInstance: OfflineQueue | null = null;

/**
 * Get or create the singleton OfflineQueue instance
 */
export function getOfflineQueue(config?: OfflineQueueConfig): OfflineQueue {
  if (!queueInstance && config) {
    queueInstance = new OfflineQueue(config);
  }
  if (!queueInstance) {
    throw new Error('OfflineQueue not initialized. Call with config first.');
  }
  return queueInstance;
}
