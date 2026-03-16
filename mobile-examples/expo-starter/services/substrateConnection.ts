/**
 * Substrate WebSocket Connection Manager with Keep-Alive
 * 
 * Maintains a persistent WebSocket connection to the Substrate node
 * with automatic reconnection and keep-alive pings.
 * 
 * @see COMPREHENSIVE_CONNECTION_ANALYSIS.md Section 3.2
 */

/**
 * Configuration for SubstrateConnection
 */
export interface SubstrateConnectionConfig {
  /** WebSocket URL (e.g., ws://192.168.1.100:9944 or wss://node.medichain.app) */
  wsUrl: string;
  /** Keep-alive ping interval in milliseconds (default: 25000 - most timeouts are 30s) */
  pingInterval?: number;
  /** Maximum reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Base delay for reconnection backoff in ms (default: 1000) */
  reconnectBaseDelay?: number;
  /** Maximum delay for reconnection backoff in ms (default: 30000) */
  reconnectMaxDelay?: number;
  /** Callback when connection is established */
  onConnect?: () => void;
  /** Callback when connection is lost */
  onDisconnect?: (reason: string) => void;
  /** Callback when a message is received */
  onMessage?: (data: unknown) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
}

/**
 * Connection state enum
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
}

/**
 * SubstrateConnection - Manages WebSocket connection to Substrate node
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Keep-alive pings to prevent connection drops
 * - Connection state tracking
 * - Message queuing during reconnection
 * 
 * @example
 * ```typescript
 * const connection = new SubstrateConnection({
 *   wsUrl: 'ws://192.168.1.100:9944',
 *   onConnect: () => console.log('Connected!'),
 *   onDisconnect: (reason) => console.log('Disconnected:', reason),
 *   onMessage: (data) => console.log('Message:', data),
 * });
 * 
 * await connection.connect();
 * 
 * // Send a request
 * const result = await connection.request('chain_getHeader', []);
 * ```
 */
export class SubstrateConnection {
  private ws: WebSocket | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private requestId = 0;
  private messageQueue: string[] = [];
  private _state: ConnectionState = ConnectionState.DISCONNECTED;
  
  private config: Required<SubstrateConnectionConfig>;

  constructor(config: SubstrateConnectionConfig) {
    this.config = {
      pingInterval: 25000,  // 25 seconds (most timeouts are 30s)
      maxReconnectAttempts: 10,
      reconnectBaseDelay: 1000,
      reconnectMaxDelay: 30000,
      onConnect: () => {},
      onDisconnect: () => {},
      onMessage: () => {},
      onError: () => {},
      ...config,
    };
  }

  /**
   * Get current connection state
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this._state === ConnectionState.CONNECTED && 
           this.ws !== null && 
           this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to the Substrate node
   */
  async connect(): Promise<void> {
    if (this._state === ConnectionState.CONNECTED) {
      console.log('[SubstrateConnection] Already connected');
      return;
    }

    if (this._state === ConnectionState.CONNECTING) {
      console.log('[SubstrateConnection] Connection in progress');
      return;
    }

    this._state = ConnectionState.CONNECTING;
    
    return new Promise((resolve, reject) => {
      try {
        console.log(`[SubstrateConnection] Connecting to ${this.config.wsUrl}...`);
        
        this.ws = new WebSocket(this.config.wsUrl);

        // Connection timeout
        const connectTimeout = setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(connectTimeout);
          console.log('[SubstrateConnection] Connected');
          this._state = ConnectionState.CONNECTED;
          this.reconnectAttempts = 0;
          this.startKeepAlive();
          this.flushMessageQueue();
          this.config.onConnect();
          resolve();
        };

        this.ws.onclose = (event) => {
          clearTimeout(connectTimeout);
          const reason = event.reason || `Code ${event.code}`;
          console.log(`[SubstrateConnection] Disconnected: ${reason}`);
          this.handleDisconnect(reason);
        };

        this.ws.onerror = (error) => {
          console.error('[SubstrateConnection] Error:', error);
          this.config.onError(new Error('WebSocket error'));
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        this._state = ConnectionState.DISCONNECTED;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the node
   */
  disconnect(): void {
    console.log('[SubstrateConnection] Disconnecting...');
    this.stopKeepAlive();
    this.clearReconnectTimeout();
    
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    if (this.ws) {
      this.ws.close(1000, 'Intentional disconnect');
      this.ws = null;
    }

    this._state = ConnectionState.DISCONNECTED;
    this.config.onDisconnect('Intentional disconnect');
  }

  /**
   * Send a JSON-RPC request
   */
  async request<T = unknown>(method: string, params: unknown[] = [], timeoutMs = 30000): Promise<T> {
    const id = ++this.requestId;
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      // Send or queue
      if (this.isConnected) {
        this.ws!.send(message);
      } else {
        console.log(`[SubstrateConnection] Queuing message: ${method}`);
        this.messageQueue.push(message);
        
        // Try to connect if disconnected
        if (this._state === ConnectionState.DISCONNECTED) {
          this.connect().catch(err => {
            console.error('[SubstrateConnection] Failed to connect:', err);
          });
        }
      }
    });
  }

  /**
   * Subscribe to a runtime event
   */
  async subscribe(
    subscribeMethod: string,
    unsubscribeMethod: string,
    params: unknown[],
    callback: (data: unknown) => void
  ): Promise<() => Promise<void>> {
    const subscriptionId = await this.request<string>(subscribeMethod, params);
    
    // Store callback for this subscription
    // Note: This is simplified - a full implementation would track subscription callbacks
    const originalOnMessage = this.config.onMessage;
    this.config.onMessage = (data) => {
      originalOnMessage(data);
      // Check if this message is for our subscription
      if (typeof data === 'object' && data !== null && 
          'params' in data && 
          (data as { params?: { subscription?: string } }).params?.subscription === subscriptionId) {
        callback((data as { params: { result: unknown } }).params.result);
      }
    };

    // Return unsubscribe function
    return async () => {
      await this.request(unsubscribeMethod, [subscriptionId]);
      this.config.onMessage = originalOnMessage;
    };
  }

  /**
   * Start keep-alive pings
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();
    
    this.keepAliveInterval = setInterval(() => {
      if (this.isConnected) {
        // Send a lightweight request to keep connection alive
        this.request('system_health', []).catch(err => {
          console.warn('[SubstrateConnection] Keep-alive failed:', err);
        });
      }
    }, this.config.pingInterval);
  }

  /**
   * Stop keep-alive pings
   */
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(data: string): void {
    try {
      const parsed = JSON.parse(data);
      
      // Check if this is a response to a pending request
      if (typeof parsed.id === 'number' && this.pendingRequests.has(parsed.id)) {
        const pending = this.pendingRequests.get(parsed.id)!;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(parsed.id);

        if (parsed.error) {
          pending.reject(new Error(parsed.error.message || 'RPC Error'));
        } else {
          pending.resolve(parsed.result);
        }
      } else {
        // Subscription notification or other message
        this.config.onMessage(parsed);
      }
    } catch (error) {
      console.error('[SubstrateConnection] Failed to parse message:', error);
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnect(reason: string): void {
    this.stopKeepAlive();
    
    // Don't reconnect if intentionally disconnected
    if (this._state === ConnectionState.DISCONNECTED) {
      return;
    }

    this._state = ConnectionState.RECONNECTING;
    this.config.onDisconnect(reason);

    // Attempt reconnection with exponential backoff
    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      const delay = Math.min(
        this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
        this.config.reconnectMaxDelay
      );
      
      console.log(`[SubstrateConnection] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.config.maxReconnectAttempts})...`);
      
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectAttempts++;
        this.connect().catch(err => {
          console.error('[SubstrateConnection] Reconnection failed:', err);
        });
      }, delay);
    } else {
      console.error('[SubstrateConnection] Max reconnection attempts reached');
      this._state = ConnectionState.DISCONNECTED;
      
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Connection lost - max reconnection attempts reached'));
      }
      this.pendingRequests.clear();
    }
  }

  /**
   * Clear reconnect timeout
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    if (!this.isConnected) return;

    console.log(`[SubstrateConnection] Flushing ${this.messageQueue.length} queued messages`);
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      this.ws!.send(message);
    }
  }
}

// Singleton instance
let connectionInstance: SubstrateConnection | null = null;

/**
 * Get or create the singleton SubstrateConnection instance
 */
export function getSubstrateConnection(config?: SubstrateConnectionConfig): SubstrateConnection {
  if (!connectionInstance && config) {
    connectionInstance = new SubstrateConnection(config);
  }
  if (!connectionInstance) {
    throw new Error('SubstrateConnection not initialized. Call with config first.');
  }
  return connectionInstance;
}
