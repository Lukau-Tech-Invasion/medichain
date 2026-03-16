/**
 * WebSocket Connection Manager with Keep-Alive
 * Implements Section 3.2 from COMPREHENSIVE_CONNECTION_ANALYSIS.md
 */

export interface SubstrateConnectionConfig {
  url: string;
  keepAliveInterval?: number;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export class SubstrateWebSocket {
  private ws: WebSocket | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private config: Required<SubstrateConnectionConfig>;
  private isIntentionallyClosed = false;

  constructor(config: SubstrateConnectionConfig) {
    this.config = {
      url: config.url,
      keepAliveInterval: config.keepAliveInterval ?? 30000,
      reconnectDelay: config.reconnectDelay ?? 3000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
    };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isIntentionallyClosed = false;
      
      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          console.log('[SubstrateWS] Connected to', this.config.url);
          this.reconnectAttempts = 0;
          this.startKeepAlive();
          resolve();
        };

        this.ws.onmessage = (event) => {
          // Handle incoming messages
          try {
            const data = JSON.parse(event.data);
            console.log('[SubstrateWS] Message:', data);
          } catch (e) {
            console.warn('[SubstrateWS] Non-JSON message:', event.data);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[SubstrateWS] Error:', error);
          reject(error);
        };

        this.ws.onclose = (event) => {
          console.log('[SubstrateWS] Closed:', event.code, event.reason);
          this.stopKeepAlive();

          // Auto-reconnect if not intentionally closed
          if (!this.isIntentionallyClosed && this.reconnectAttempts < this.config.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[SubstrateWS] Reconnecting (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})...`);
            setTimeout(() => this.connect(), this.config.reconnectDelay);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private startKeepAlive(): void {
    this.keepAliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Send system_health ping to keep connection alive
        this.ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'system_health',
          params: []
        }));
      }
    }, this.config.keepAliveInterval);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[SubstrateWS] Cannot send - connection not open');
    }
  }

  close(): void {
    this.isIntentionallyClosed = true;
    this.stopKeepAlive();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Test WebSocket connectivity
 * Implements diagnostic function from Section 3.2
 */
export async function testSubstrateWs(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 5000);

    ws.onopen = () => {
      // Send a test RPC
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'chain_getHeader',
        params: []
      }));
    };

    ws.onmessage = (msg) => {
      console.log('[SubstrateWS Test] Success:', msg.data.substring(0, 100));
      clearTimeout(timeout);
      ws.close();
      resolve(true);
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      resolve(false);
    };
  });
}
