/**
 * Connection Health Monitor for MediChain Mobile
 * 
 * Monitors the health of API and WebSocket connections,
 * provides reactive updates, and triggers reconnection when needed.
 * 
 * @see COMPREHENSIVE_CONNECTION_ANALYSIS.md Section 3 & 10
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export type ConnectionHealth = 'healthy' | 'degraded' | 'offline' | 'unknown';

export interface HealthStatus {
  overall: ConnectionHealth;
  api: ConnectionHealth;
  websocket: ConnectionHealth;
  network: boolean;
  lastCheck: number;
  latency?: number;
}

export interface ConnectionHealthConfig {
  apiUrl: string;
  wsUrl: string;
  checkInterval?: number;  // Milliseconds between health checks (default: 30000)
  timeout?: number;        // Timeout for health check (default: 5000)
  onStatusChange?: (status: HealthStatus) => void;
}

/**
 * Connection Health Monitor
 * 
 * Usage:
 * ```typescript
 * const monitor = new ConnectionHealthMonitor({
 *   apiUrl: 'http://192.168.1.100:8080',
 *   wsUrl: 'ws://192.168.1.100:9944',
 *   onStatusChange: (status) => {
 *     if (status.overall === 'offline') {
 *       showOfflineBanner();
 *     }
 *   }
 * });
 * 
 * await monitor.start();
 * 
 * // Later...
 * monitor.stop();
 * ```
 */
export class ConnectionHealthMonitor {
  private config: Required<ConnectionHealthConfig>;
  private checkIntervalId: ReturnType<typeof setInterval> | null = null;
  private unsubscribeNetInfo: (() => void) | null = null;
  private currentStatus: HealthStatus = {
    overall: 'unknown',
    api: 'unknown',
    websocket: 'unknown',
    network: true,
    lastCheck: 0
  };

  constructor(config: ConnectionHealthConfig) {
    this.config = {
      checkInterval: 30000,
      timeout: 5000,
      onStatusChange: () => {},
      ...config
    };
  }

  /**
   * Start monitoring connections
   */
  async start(): Promise<void> {
    // Subscribe to network state changes
    this.unsubscribeNetInfo = NetInfo.addEventListener(this.handleNetworkChange.bind(this));

    // Initial check
    await this.checkAll();

    // Start periodic checks
    this.checkIntervalId = setInterval(() => {
      this.checkAll();
    }, this.config.checkInterval);

    console.log('[ConnectionHealth] Started monitoring');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }

    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }

    console.log('[ConnectionHealth] Stopped monitoring');
  }

  /**
   * Get current status
   */
  getStatus(): HealthStatus {
    return { ...this.currentStatus };
  }

  /**
   * Force an immediate health check
   */
  async checkNow(): Promise<HealthStatus> {
    return this.checkAll();
  }

  /**
   * Handle network state changes
   */
  private handleNetworkChange(state: NetInfoState): void {
    const wasOnline = this.currentStatus.network;
    this.currentStatus.network = state.isConnected ?? false;

    if (!wasOnline && this.currentStatus.network) {
      // Network restored - trigger immediate check
      console.log('[ConnectionHealth] Network restored, checking connections...');
      this.checkAll();
    } else if (wasOnline && !this.currentStatus.network) {
      // Network lost
      console.log('[ConnectionHealth] Network lost');
      this.updateStatus({
        overall: 'offline',
        api: 'offline',
        websocket: 'offline',
        network: false,
        lastCheck: Date.now()
      });
    }
  }

  /**
   * Check all connections
   */
  private async checkAll(): Promise<HealthStatus> {
    const startTime = Date.now();

    // Check network first
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      return this.updateStatus({
        overall: 'offline',
        api: 'offline',
        websocket: 'offline',
        network: false,
        lastCheck: Date.now()
      });
    }

    // Check API health
    const apiHealth = await this.checkApiHealth();
    const latency = Date.now() - startTime;

    // Check WebSocket health
    const wsHealth = await this.checkWebSocketHealth();

    // Determine overall health
    let overall: ConnectionHealth = 'healthy';
    if (apiHealth === 'offline' || wsHealth === 'offline') {
      overall = 'offline';
    } else if (apiHealth === 'degraded' || wsHealth === 'degraded') {
      overall = 'degraded';
    }

    return this.updateStatus({
      overall,
      api: apiHealth,
      websocket: wsHealth,
      network: true,
      lastCheck: Date.now(),
      latency
    });
  }

  /**
   * Check API health
   */
  private async checkApiHealth(): Promise<ConnectionHealth> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.apiUrl}/api/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return 'healthy';
      } else if (response.status >= 500) {
        return 'degraded';
      } else {
        return 'degraded';
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[ConnectionHealth] API check timeout');
        return 'degraded';
      }
      console.log('[ConnectionHealth] API check failed:', error.message);
      return 'offline';
    }
  }

  /**
   * Check WebSocket health
   */
  private async checkWebSocketHealth(): Promise<ConnectionHealth> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(this.config.wsUrl);
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            ws.close();
            resolve('degraded');
          }
        }, this.config.timeout);

        ws.onopen = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve('healthy');
          }
        };

        ws.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve('offline');
          }
        };
      } catch {
        resolve('offline');
      }
    });
  }

  /**
   * Update status and notify listeners
   */
  private updateStatus(newStatus: HealthStatus): HealthStatus {
    const prevOverall = this.currentStatus.overall;
    this.currentStatus = newStatus;

    // Only notify if status changed
    if (prevOverall !== newStatus.overall) {
      console.log(`[ConnectionHealth] Status changed: ${prevOverall} → ${newStatus.overall}`);
      this.config.onStatusChange(newStatus);
    }

    return newStatus;
  }
}

/**
 * Singleton instance for app-wide usage
 */
let globalMonitor: ConnectionHealthMonitor | null = null;

export function getConnectionHealthMonitor(): ConnectionHealthMonitor | null {
  return globalMonitor;
}

export function initConnectionHealthMonitor(config: ConnectionHealthConfig): ConnectionHealthMonitor {
  if (globalMonitor) {
    globalMonitor.stop();
  }
  globalMonitor = new ConnectionHealthMonitor(config);
  return globalMonitor;
}
