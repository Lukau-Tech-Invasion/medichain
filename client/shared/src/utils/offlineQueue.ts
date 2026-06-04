/**
 * Offline Queue for Pending Operations
 * Implements Section 8.3 from COMPREHENSIVE_CONNECTION_ANALYSIS.md
 */

export interface QueuedOperation {
  id: string;
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  timestamp: number;
  retries: number;
}

export interface OfflineQueueConfig {
  maxRetries?: number;
  baseDelay?: number;
  storageKey?: string;
}

/**
 * OfflineQueue - Handles queuing API operations when offline
 * Automatically processes queue when connection is restored
 */
export class OfflineQueue {
  private queue: QueuedOperation[] = [];
  private isProcessing = false;
  private config: Required<OfflineQueueConfig>;
  private storage: Storage | null = null;

  constructor(config: OfflineQueueConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      baseDelay: config.baseDelay ?? 1000,
      storageKey: config.storageKey ?? 'medichain_offline_queue',
    };

    // Try to use localStorage if available (web), otherwise in-memory
    if (typeof window !== 'undefined' && window.localStorage) {
      this.storage = window.localStorage;
      this.loadFromStorage();
    }
  }

  /**
   * Add operation to queue
   */
  async enqueue(operation: Omit<QueuedOperation, 'id' | 'timestamp' | 'retries'>): Promise<void> {
    const op: QueuedOperation = {
      ...operation,
      id: `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      retries: 0
    };

    this.queue.push(op);
    await this.persist();

    console.log(`[OfflineQueue] Enqueued: ${op.method} ${op.path}`);

    // Try to process immediately
    this.processQueue();
  }

  /**
   * Process all queued operations
   */
  async processQueue(apiClient?: { request: (method: string, path: string, body?: unknown) => Promise<unknown> }): Promise<void> {
    if (this.isProcessing) {
      console.log('[OfflineQueue] Already processing');
      return;
    }

    if (this.queue.length === 0) {
      console.log('[OfflineQueue] Queue is empty');
      return;
    }

    console.log(`[OfflineQueue] Processing ${this.queue.length} operations...`);
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const op = this.queue[0];

      try {
        console.log(`[OfflineQueue] Processing: ${op.method} ${op.path} (attempt ${op.retries + 1}/${this.config.maxRetries})`);

        if (apiClient) {
          // Use provided API client
          await apiClient.request(op.method, op.path, op.body);
        } else {
          // Fallback to fetch (requires global API URL)
          const apiUrl = (globalThis as { __MEDICHAIN_API_URL__?: string }).__MEDICHAIN_API_URL__ || 'http://localhost:8080';
          const response = await fetch(`${apiUrl}${op.path}`, {
            method: op.method,
            headers: {
              'Content-Type': 'application/json',
            },
            body: op.body ? JSON.stringify(op.body) : undefined
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        }

        // Success - remove from queue
        console.log(`[OfflineQueue] Success: ${op.method} ${op.path}`);
        this.queue.shift();
        await this.persist();

      } catch (error) {
        console.error(`[OfflineQueue] Failed: ${op.method} ${op.path}`, error);
        op.retries++;

        if (op.retries >= this.config.maxRetries) {
          // Max retries - move to failed queue
          console.error(`[OfflineQueue] Max retries reached for: ${op.method} ${op.path}`);
          await this.handleFailedOperation(op);
          this.queue.shift();
          await this.persist();
        } else {
          // Exponential backoff
          const delay = this.config.baseDelay * Math.pow(2, op.retries);
          console.log(`[OfflineQueue] Retrying after ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    this.isProcessing = false;
    console.log('[OfflineQueue] Processing complete');
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear all queued operations
   */
  async clear(): Promise<void> {
    this.queue = [];
    await this.persist();
    console.log('[OfflineQueue] Queue cleared');
  }

  /**
   * Get all queued operations (for debugging)
   */
  getQueue(): QueuedOperation[] {
    return [...this.queue];
  }

  /**
   * Persist queue to storage
   */
  private async persist(): Promise<void> {
    if (this.storage) {
      try {
        this.storage.setItem(this.config.storageKey, JSON.stringify(this.queue));
      } catch (error) {
        console.error('[OfflineQueue] Failed to persist:', error);
      }
    }
  }

  /**
   * Load queue from storage
   */
  private loadFromStorage(): void {
    if (this.storage) {
      try {
        const stored = this.storage.getItem(this.config.storageKey);
        if (stored) {
          this.queue = JSON.parse(stored);
          console.log(`[OfflineQueue] Loaded ${this.queue.length} operations from storage`);
        }
      } catch (error) {
        console.error('[OfflineQueue] Failed to load from storage:', error);
      }
    }
  }

  /**
   * Handle operation that failed after max retries
   */
  private async handleFailedOperation(op: QueuedOperation): Promise<void> {
    console.error('[OfflineQueue] Operation failed after max retries:', {
      id: op.id,
      method: op.method,
      path: op.path,
      retries: op.retries,
      timestamp: new Date(op.timestamp).toISOString()
    });

    // Store in failed operations list
    if (this.storage) {
      try {
        const failedKey = `${this.config.storageKey}_failed`;
        const existingFailed = this.storage.getItem(failedKey);
        const failed = existingFailed ? JSON.parse(existingFailed) : [];
        failed.push(op);
        this.storage.setItem(failedKey, JSON.stringify(failed));
      } catch (error) {
        console.error('[OfflineQueue] Failed to store failed operation:', error);
      }
    }
  }
}
