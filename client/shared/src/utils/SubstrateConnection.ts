/**
 * WebSocket Connection Manager for Substrate Node
 * 
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Keep-alive pings to prevent carrier drops
 * - Connection state monitoring
 * - Message queue for pending sends
 * 
 * Usage:
 * ```typescript
 * const connection = new SubstrateConnection('ws://192.168.1.100:9944');
 * await connection.connect();
 * 
 * connection.onMessage((data) => {
 *   console.log('Received:', data);
 * });
 * 
 * connection.send({ jsonrpc: '2.0', method: 'chain_getHeader', params: [], id: 1 });
 * ```
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface SubstrateMessage {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params: unknown[];
  result?: unknown;
  error?: { code: number; message: string };
}

export interface ConnectionConfig {
  url: string;
  keepAliveInterval?: number;  // Milliseconds between pings (default: 30000)
  reconnectDelay?: number;     // Base delay for reconnect (default: 1000)
  maxReconnectDelay?: number;  // Max delay for reconnect (default: 30000)
  maxReconnectAttempts?: number; // Max reconnect attempts (default: Infinity)
}

export class SubstrateConnection {
  private ws: WebSocket | null = null;
  private url: string;
  private state: ConnectionState = 'disconnected';
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private messageQueue: SubstrateMessage[] = [];
  private messageListeners: Array<(data: SubstrateMessage) => void> = [];
  private stateListeners: Array<(state: ConnectionState) => void> = [];
  
  private config: Required<ConnectionConfig>;
  
  constructor(config: string | ConnectionConfig) {
    if (typeof config === 'string') {
      this.config = {
        url: config,
        keepAliveInterval: 30000,
        reconnectDelay: 1000,
        maxReconnectDelay: 30000,
        maxReconnectAttempts: Infinity
      };
    } else {
      this.config = {
        keepAliveInterval: 30000,
        reconnectDelay: 1000,
        maxReconnectDelay: 30000,
        maxReconnectAttempts: Infinity,
        ...config
      };
    }
    
    this.url = this.config.url;
  }
  
  /**
   * Connect to the Substrate node
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      console.log('[SubstrateWS] Already connected or connecting');
      return;
    }
    
    this.setState('connecting');
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        
        const connectionTimeout = setTimeout(() => {
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }, 10000);
        
        this.ws.onopen = () => {
          clearTimeout(connectionTimeout);
          console.log('[SubstrateWS] Connected to', this.url);
          this.setState('connected');
          this.reconnectAttempts = 0;
          this.startKeepAlive();
          this.flushMessageQueue();
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as SubstrateMessage;
            this.messageListeners.forEach(listener => listener(data));
          } catch (error) {
            console.error('[SubstrateWS] Failed to parse message:', error);
          }
        };
        
        this.ws.onerror = (error) => {
          clearTimeout(connectionTimeout);
          console.error('[SubstrateWS] WebSocket error:', error);
          reject(error);
        };
        
        this.ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          console.log('[SubstrateWS] Connection closed:', event.code, event.reason);
          this.handleDisconnect();
        };
        
      } catch (error) {
        console.error('[SubstrateWS] Connection error:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Disconnect from the Substrate node
   */
  disconnect(): void {
    this.stopKeepAlive();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.setState('disconnected');
  }
  
  /**
   * Send a JSON-RPC message to the node
   */
  send(message: SubstrateMessage): void {
    if (this.state !== 'connected' || !this.ws) {
      console.log('[SubstrateWS] Not connected, queueing message');
      this.messageQueue.push(message);
      return;
    }
    
    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[SubstrateWS] Failed to send message:', error);
      this.messageQueue.push(message);
    }
  }
  
  /**
   * Register a message listener
   */
  onMessage(listener: (data: SubstrateMessage) => void): () => void {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter(l => l !== listener);
    };
  }
  
  /**
   * Register a state change listener
   */
  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== listener);
    };
  }
  
  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }
  
  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected';
  }
  
  // Private methods
  
  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.stateListeners.forEach(listener => listener(newState));
    }
  }
  
  private startKeepAlive(): void {
    this.stopKeepAlive();
    
    this.keepAliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Send system_health ping to keep connection alive
        this.send({
          jsonrpc: '2.0',
          id: `keepalive_${Date.now()}`,
          method: 'system_health',
          params: []
        });
      }
    }, this.config.keepAliveInterval);
  }
  
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }
  
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }
  
  private handleDisconnect(): void {
    this.stopKeepAlive();
    this.setState('disconnected');
    
    // Attempt reconnection
    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      console.error('[SubstrateWS] Max reconnection attempts reached');
    }
  }
  
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    
    // Exponential backoff with jitter
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1) + Math.random() * 1000,
      this.config.maxReconnectDelay
    );
    
    console.log(`[SubstrateWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.setState('reconnecting');
    
    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch(error => {
        console.error('[SubstrateWS] Reconnection failed:', error);
      });
    }, delay);
  }
}

/**
 * Helper function to test WebSocket connectivity
 */
export async function testSubstrateConnection(url: string, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timeoutId = setTimeout(() => {
      ws.close();
      resolve(false);
    }, timeout);
    
    ws.onopen = () => {
      // Send test RPC
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'chain_getHeader',
        params: []
      }));
    };
    
    ws.onmessage = () => {
      clearTimeout(timeoutId);
      ws.close();
      resolve(true);
    };
    
    ws.onerror = () => {
      clearTimeout(timeoutId);
      resolve(false);
    };
  });
}
